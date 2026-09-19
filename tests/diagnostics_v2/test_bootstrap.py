"""Bootstrap regression tests; controlled curl transports, never public network."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
BASH=os.environ.get('TEST_BASH','/bin/bash')

class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.p=Path(self.temp.name)
        self.bin=self.p/'bin';self.bin.mkdir()
        self.env=dict(os.environ,PATH=str(self.bin)+os.pathsep+os.environ['PATH'],MACDIAG_REPORT_DIR=str(self.p/'reports'),FIX_ROOT=str(ROOT))
        mock=self.bin/'curl'
        mock.write_text('''#!/bin/bash
out='';url=''
while [ "$#" -gt 0 ];do case "$1" in -o) out=$2;shift 2;;https://*) url=$1;shift;;*) shift;;esac;done
path=${url#*/MacOS/};path=${path#*/}
case "${FAIL_MODE:-}:$path" in
 manifest:*/package.tsv) exit 28;;
 truncated:*/core.sh) printf partial > "$out";exit 0;;
 failed:*/core.sh) printf 'echo EXECUTED_PARTIAL_BAD' > "$out";exit 18;;
 tampered:*/package.tsv) printf 'not a manifest' > "$out";exit 0;;
esac
cp "$FIX_ROOT/$path" "$out"
''');mock.chmod(0o755)

    def tearDown(self):self.temp.cleanup()

    def run_boot(self,mode='',args=('--run','selftest')):
        return subprocess.run([BASH,str(ROOT/'st.sh'),*args],env=dict(self.env,FAIL_MODE=mode),capture_output=True,text=True,timeout=30)

    def test_complete_snapshot_executes_selftest(self):
        r=self.run_boot();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIn('PACKAGE_VERIFIED',r.stdout)

    def test_manifest_fetch_failure_no_execution(self):
        r=self.run_boot('manifest');self.assertEqual(r.returncode,3);self.assertNotIn('TOOLKIT_VERSION=',r.stdout)

    def test_truncated_module_no_execution(self):
        r=self.run_boot('truncated');self.assertEqual(r.returncode,3);self.assertNotIn('TOOLKIT_VERSION=',r.stdout)

    def test_partial_failed_fetch_not_executed(self):
        r=self.run_boot('failed');self.assertEqual(r.returncode,3);self.assertNotIn('EXECUTED_PARTIAL_BAD',r.stdout)

    def test_manifest_tampering_rejected(self):
        r=self.run_boot('tampered');self.assertEqual(r.returncode,3);self.assertNotIn('TOOLKIT_VERSION=',r.stdout)

    def test_offline_selftest(self):
        r=self.run_boot(args=('--offline','--run','selftest'));self.assertEqual(r.returncode,0,r.stdout+r.stderr)

    def test_failed_fetch_cleans_private_package(self):
        before=set(Path('/tmp').glob('macdiag-package.*'))
        r=self.run_boot('failed');self.assertEqual(r.returncode,3)
        self.assertEqual(set(Path('/tmp').glob('macdiag-package.*')),before)

    def test_bootstrap_syntax(self):
        r=subprocess.run([BASH,'-n',str(ROOT/'st.sh')]);self.assertEqual(r.returncode,0)

    def test_damaged_offline_module(self):
        target=self.p/'copy';shutil.copytree(ROOT/'diagnostics',target/'diagnostics');shutil.copy(ROOT/'st.sh',target/'st.sh')
        (target/'diagnostics/v2/core.sh').write_text('bad')
        r=subprocess.run([BASH,str(target/'st.sh'),'--offline','--run','selftest'],env=self.env,capture_output=True,text=True)
        self.assertEqual(r.returncode,3)

if __name__=='__main__':unittest.main(verbosity=2)
