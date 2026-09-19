"""External-review regression: mock transport, actual bootstrap and failure paths.
No network or hardware writes; curl inputs/attempts and stderr are inspected.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[2]

class ReviewBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='macdiag-review-test-')
        self.root = Path(self.tmp.name)
        self.mock = self.root / 'curl'
        self.mock.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
args=sys.argv[1:];url=next(x for x in args if x.startswith('https://'));name=urlsplit(url).path.rsplit('/',1)[1]
out=Path(args[args.index('-o')+1]);state=Path(os.environ['QA_STATE']);calls=[]
if state.exists():calls=json.loads(state.read_text())
n=sum(x['name']==name for x in calls)
calls.append({'name':name,'url':url,'argv':args});state.write_text(json.dumps(calls))
if os.environ.get('QA_REQUIRE_FRESH') and out.exists():sys.exit(99)
target=os.environ.get('QA_TARGET','diagnostics-release.tsv')
if name==target and (n < int(os.environ.get('QA_FAIL_FIRST','0')) or os.environ.get('QA_ALWAYS_FAIL')):
    out.write_bytes(b'broken partial payload')
    if '-w' in args:print(os.environ.get('QA_HTTP','000'),end='')
    print('MOCK_CURL_ORIGINAL_ERROR',file=sys.stderr);sys.exit(int(os.environ.get('QA_RC','28')))
root=Path(os.environ['QA_PACKAGE']);source=root/name if name=='diagnostics-release.tsv' else root/'diagnostics_v2'/name
data=source.read_bytes()
if name==target and os.environ.get('QA_DATA'):data=os.environ['QA_DATA'].encode()
if name==target and os.environ.get('QA_GROW'):data=b'x'*int(os.environ['QA_GROW'])
out.write_bytes(data)
if '-w' in args:print('200',end='')
''')
        self.mock.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root)+os.pathsep+os.environ['PATH'],
                        QA_PACKAGE=str(BASE), QA_STATE=str(self.root/'calls.json'))

    def tearDown(self):
        self.tmp.cleanup()

    def run_boot(self, **env):
        p = subprocess.run(['/bin/bash',os.environ.get('BOOT_SCRIPT', str(BASE/'st.sh')),'selftest'],
                           env=dict(self.env, **env), capture_output=True, text=True, timeout=25)
        paths=re.findall(r'BOOTSTRAP_LOG=(/tmp/macdiag-package\.[^\s]+/bootstrap\.log)',p.stdout)
        self.bootstrap_dir=Path(paths[-1]).parent if paths else None
        self.log=self.bootstrap_dir.joinpath('bootstrap.log').read_text() if self.bootstrap_dir else ''
        if self.bootstrap_dir:self.addCleanup(shutil.rmtree,self.bootstrap_dir,True)
        return p

    def calls(self, name):
        return [c for c in json.loads((self.root/'calls.json').read_text()) if c['name']==name]

    def failure(self, p, reason):
        self.assertEqual(p.returncode,3,p.stdout+p.stderr)
        self.assertIn('BOOTSTRAP_REASON='+reason,p.stderr)
        self.assertIn('RU:',p.stderr);self.assertIn('EN:',p.stderr)
        self.assertNotIn('SESSION_LOGS=',p.stdout)

    def test_release_transient_recovers(self):
        p=self.run_boot(QA_FAIL_FIRST='1',QA_REQUIRE_FRESH='1')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertEqual(len(self.calls('diagnostics-release.tsv')),2)
        self.assertIn('TOOLKIT_CHECKED',p.stdout)

    def test_manifest_transient_recovers(self):
        p=self.run_boot(QA_TARGET='manifest.tsv',QA_FAIL_FIRST='1',QA_REQUIRE_FRESH='1')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertEqual(len(self.calls('manifest.tsv')),2)

    def test_package_file_retry_uses_fresh_partial(self):
        p=self.run_boot(QA_TARGET='common.sh',QA_FAIL_FIRST='1',QA_REQUIRE_FRESH='1')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertEqual(len(self.calls('common.sh')),2)

    def test_retry_exhaustion_is_explained_and_bounded(self):
        p=self.run_boot(QA_ALWAYS_FAIL='1')
        self.failure(p,'FETCH_FAILED');self.assertEqual(len(self.calls('diagnostics-release.tsv')),3)
        self.assertIn('curl_rc=28',self.log)
        self.assertIn('MOCK_CURL_ORIGINAL_ERROR',self.log)
        self.assertEqual(list(self.bootstrap_dir.glob('*.incoming')),[])

    def test_http_503_retried(self):
        p=self.run_boot(QA_FAIL_FIRST='1',QA_RC='22',QA_HTTP='503')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertEqual(len(self.calls('diagnostics-release.tsv')),2)

    def test_http_404_not_retried(self):
        p=self.run_boot(QA_ALWAYS_FAIL='1',QA_RC='22',QA_HTTP='404')
        self.failure(p,'FETCH_FAILED');self.assertEqual(len(self.calls('diagnostics-release.tsv')),1)

    def test_tls_60_no_retry_no_insecure_with_time(self):
        p=self.run_boot(QA_ALWAYS_FAIL='1',QA_RC='60')
        self.failure(p,'TLS_VERIFY_FAILED');self.assertIn('UTC_NOW=',p.stderr)
        calls=self.calls('diagnostics-release.tsv');self.assertEqual(len(calls),1)
        self.assertNotIn('-k',calls[0]['argv']);self.assertNotIn('--insecure',calls[0]['argv'])
        self.assertIn('certificate chain',p.stderr)

    def test_local_write_error_not_retried(self):
        p=self.run_boot(QA_ALWAYS_FAIL='1',QA_RC='23')
        self.failure(p,'FETCH_FAILED');self.assertEqual(len(self.calls('diagnostics-release.tsv')),1)

    def test_multiline_descriptor_has_reason(self):
        p=self.run_boot(QA_DATA='broken\nbroken\n')
        self.failure(p,'DESCRIPTOR_ROW_COUNT')
        self.assertIn('DESCRIPTOR_ROW_COUNT',self.log)

    def test_invalid_descriptor_fields_have_reason(self):
        p=self.run_boot(QA_DATA='2.0.0-rc3\t123\tabc\n')
        self.failure(p,'DESCRIPTOR_FIELDS_INVALID')

    def test_manifest_hash_mismatch_not_retried(self):
        p=self.run_boot(QA_TARGET='manifest.tsv',QA_DATA='corrupt\n')
        self.failure(p,'MANIFEST_HASH_MISMATCH');self.assertEqual(len(self.calls('manifest.tsv')),1)

    def test_c_source_is_still_verified_without_compiler(self):
        p=self.run_boot(QA_TARGET='ram_native.c',QA_DATA='corrupt source\n')
        self.failure(p,'FILE_HASH_OR_SIZE_MISMATCH')

    def test_downloaded_size_verified_independently_of_curl(self):
        p=self.run_boot(QA_GROW='4097')
        self.failure(p,'FETCH_SIZE_INVALID')

    def test_old_curl_style_unbounded_body_hits_os_limit(self):
        p=self.run_boot(QA_GROW='10485760')
        self.failure(p,'FETCH_FAILED')
        self.assertEqual(len(self.calls('diagnostics-release.tsv')),1)
        self.assertEqual(list(self.bootstrap_dir.glob('*.incoming')),[])

    def test_descriptor_resolved_once_after_success(self):
        p=self.run_boot()
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertEqual(len(self.calls('diagnostics-release.tsv')),1)
        ref=(BASE/'diagnostics-release.tsv').read_text().split('\t')[1]
        calls=json.loads((self.root/'calls.json').read_text())
        for c in calls:
            if c['name']!='diagnostics-release.tsv':self.assertIn('/'+ref+'/',c['url'])

    def test_dead_tty_not_hardware_failure(self):
        # All subprocess runs above lack a controlling tty; explicit selftest works.
        p=self.run_boot();self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertNotIn('RESULT=FAIL',p.stdout)

if __name__=='__main__': unittest.main()
