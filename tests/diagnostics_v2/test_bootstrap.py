"""Bootstrapping integration with a file-copy mock, not a real GitHub transfer."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
BASE=Path(__file__).resolve().parents[2]
class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.d=Path(self.t.name)
        c=self.d/'curl'
        c.write_text('''#!/usr/bin/env python3
import os,sys,shutil
from pathlib import Path
args=sys.argv[1:];out=Path(args[args.index('-o')+1]);url=next(x for x in args if x.startswith('https://'))
name=url.rsplit('/',1)[1]
if name==os.environ.get('MOCK_MISSING'):sys.exit(22)
source=Path(os.environ['PACKAGE_DIR'])/name
if not source.is_file():sys.exit(22)
shutil.copyfile(source,out)
if name==os.environ.get('MOCK_CORRUPT'):out.write_bytes(out.read_bytes()+b'bad')
''');c.chmod(0o755)
        self.env=dict(os.environ,PATH=str(self.d)+os.pathsep+os.environ['PATH'],PACKAGE_DIR=str(BASE/'diagnostics_v2'))
    def tearDown(self):self.t.cleanup()
    def run_boot(self,**extra):
        return subprocess.run(['/bin/bash',str(BASE/'st.sh'),'selftest'],env=dict(self.env,**extra),capture_output=True,text=True,timeout=20)
    def test_bootstrap_valid_package(self):
        p=self.run_boot();self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn('TOOLKIT_CHECKED',p.stdout)
    def test_manifest_corruption_blocks_execution(self):
        p=self.run_boot(MOCK_CORRUPT='manifest.tsv');self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertNotIn('SESSION_LOGS=',p.stdout)
    def test_payload_corruption_blocks_execution(self):
        p=self.run_boot(MOCK_CORRUPT='run.sh');self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertNotIn('SESSION_LOGS=',p.stdout)
    def test_missing_payload_blocks_execution(self):
        p=self.run_boot(MOCK_MISSING='ram_native.c');self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertNotIn('SESSION_LOGS=',p.stdout)
    def test_truncated_bootstrap_never_executes(self):
        text=(BASE/'st.sh').read_text();cut=text.index('export MACDIAG_CODE_REF')
        p=subprocess.run(['/bin/bash'],input=text[:cut],env=self.env,capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0);self.assertNotIn('MACDIAG_PACKAGE_REF=',p.stdout)
    def test_bootstrap_syntax(self):
        p=subprocess.run(['/bin/bash','-n',str(BASE/'st.sh')],capture_output=True)
        self.assertEqual(p.returncode,0,p.stderr)
if __name__=='__main__':unittest.main()
