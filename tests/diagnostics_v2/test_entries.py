"""Compatibility entries: isolated file transport; never contact GitHub."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
BASE=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('entries', BASE/'tools/build_diagnostics_v2_entries.py')
entries=importlib.util.module_from_spec(spec);spec.loader.exec_module(entries)
class EntryTests(unittest.TestCase):
    def test_generated_entries_match(self):
        for name,mode in entries.MODES.items():
            self.assertEqual((BASE/name).read_text(),entries.TEMPLATE.replace('REF',entries.REF).replace('SHA',entries.SHA).replace('MODE',mode))
    def test_all_entries_syntax(self):
        for name in [*entries.MODES,'ssd_test.sh','full_all_suite.sh']:
            p=subprocess.run(['/bin/bash','-n',str(BASE/name)],capture_output=True)
            self.assertEqual(p.returncode,0,(name,p.stderr))
    def test_raw_entries_are_blocked_without_network(self):
        for name in ['ssd_test.sh','full_all_suite.sh']:
            p=subprocess.run(['/bin/bash',str(BASE/name)],capture_output=True,text=True,timeout=5)
            self.assertEqual(p.returncode,7,p.stdout);self.assertIn('LEGACY_RAW_QUARANTINED',p.stdout)
    def test_bootstrap_alias_roundtrip_and_corruption(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d);curl=path/'curl'
            curl.write_text('''#!/usr/bin/env python3
import os,sys,shutil
from pathlib import Path
args=sys.argv[1:];out=Path(args[args.index('-o')+1]);url=next(x for x in args if x.startswith('https://'))
name=url.rsplit('/',1)[1];root=Path(os.environ['QA_ROOT']);source=root/name if name=='st.sh' else root/'diagnostics_v2'/name
shutil.copyfile(source,out)
if os.environ.get('QA_TAMPER') and name=='st.sh':out.write_bytes(out.read_bytes()+b'bad')
''');curl.chmod(0o755)
            env=dict(os.environ,QA_ROOT=str(BASE),PATH=d+os.pathsep+os.environ['PATH'])
            for tamper,rc in [('',0),('1',3)]:
                p=subprocess.run(['/bin/bash',str(BASE/'toolkit_selftest.sh')],env=dict(env,QA_TAMPER=tamper),capture_output=True,text=True,timeout=20)
                self.assertEqual(p.returncode,rc,p.stdout+p.stderr)
                if tamper:self.assertNotIn('SESSION_LOGS=',p.stdout)
                else:self.assertIn('TOOLKIT_CHECKED',p.stdout)
    def test_truncated_entry_does_not_execute(self):
        text=(BASE/'ram_full_test.sh').read_text();text=text[:text.index('  /bin/bash -n')]
        p=subprocess.run(['/bin/bash'],input=text,text=True,capture_output=True,timeout=5)
        self.assertNotEqual(p.returncode,0)
if __name__=='__main__':unittest.main()
