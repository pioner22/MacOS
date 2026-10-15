"""Bootstrap tests substitute only its download executable; no real networking."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'macdiag-core.sh'

class Bootstrap(unittest.TestCase):
    def test_bash_syntax(self):
        subprocess.run(['/bin/bash','-n',str(SOURCE)],check=True)

    def test_manifest_matches_local_bytes(self):
        text=SOURCE.read_text()
        rows=text.split("done <<'MANIFEST'\n",1)[1].split('\nMANIFEST',1)[0].splitlines()
        self.assertEqual(len(rows),7)
        for row in rows:
            path,want=row.split()
            self.assertEqual(hashlib.sha256((ROOT/'macdiag_core'/path).read_bytes()).hexdigest(),want,path)
        self.assertIn('ref=5b2eecc9613c34f4844ced1b73d5650731d2ec2e',text)

    def test_truncated_no_execution(self):
        text=SOURCE.read_text().rsplit('macdiag_core_bootstrap "$@"',1)[0]
        r=subprocess.run(['/bin/bash'],input=text,text=True,capture_output=True,timeout=5)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout+r.stderr,'')

    def harness(self,args=(),fault=None):
        temp=tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        root=pathlib.Path(temp.name)
        transport=root/'transport.py'
        transport.write_text('''#!/usr/bin/python3
import pathlib,sys
source=pathlib.Path(%r)
args=sys.argv[1:]
url=[x for x in args if x.startswith('https://')][0]
name=url.split('/macdiag_core/',1)[1]
payload=(source/'macdiag_core'/name).read_bytes()
fault=%r
if fault=='download' and name=='bin/macdiag.pl':sys.exit(22)
if fault=='hash' and name=='bin/macdiag.pl':payload+=b'CORRUPTION'
pathlib.Path(args[args.index('-o')+1]).write_bytes(payload)
''' % (str(ROOT),fault))
        transport.chmod(0o755)
        script=SOURCE.read_text().replace('/usr/bin/curl -q',str(transport)+' -q')
        r=subprocess.run(['/bin/bash','-s','--',*args],input=script,capture_output=True,text=True,timeout=30,cwd=root)
        return r,root

    def test_full_profile_pipeline(self):
        r,_=self.harness(('profile','collect','--format','json'))
        self.assertEqual(r.returncode,0,r.stderr)
        value=json.loads(r.stdout)
        self.assertEqual(value['schema'],'macdiag.profile.v1')
        self.assertEqual(value['privacy']['upload'],'NONE')

    def test_default_is_observation(self):
        r,_=self.harness()
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('паспорт окружения',r.stdout)

    def test_corruption_blocks_execution(self):
        r,_=self.harness(fault='hash')
        self.assertNotEqual(r.returncode,0)
        self.assertIn('SHA-256',r.stderr)
        self.assertEqual(r.stdout,'')

    def test_failed_download_blocks_execution(self):
        r,_=self.harness(fault='download')
        self.assertNotEqual(r.returncode,0)
        self.assertIn('загрузка не завершена',r.stderr)
        self.assertEqual(r.stdout,'')

    def test_relative_output_survives_cleanup(self):
        r,root=self.harness(('profile','collect','--output','report.json'))
        self.assertEqual(r.returncode,0,r.stderr)
        p=root/'report.json'
        self.assertTrue(p.is_file())
        self.assertEqual(p.stat().st_mode & 0o777,0o600)

if __name__=='__main__': unittest.main(verbosity=2)
