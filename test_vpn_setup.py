"""Offline tests of setup orchestration; never run sudo or change real routes.
Python 3 is required for the test runner, not for the macOS installer.
"""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
SCRIPT = (ROOT / 'vpn-bigsur.sh').read_text()
BOOT = (ROOT / 'vpn.sh').read_text()
FUNCTIONS = SCRIPT.split('CMD=${1:-help}', 1)[0]
DUMMY_KEY = '0123456789abcdef' * 2

class SetupTests(unittest.TestCase):
    def shell(self, text, data=None, env=None):
        return subprocess.run(['bash', '-c', text], input=data, text=True,
                              capture_output=True, env=env, timeout=10)

    def test_installer_syntax(self):
        subprocess.run(['bash','-n',str(ROOT/'vpn-bigsur.sh')],check=True)

    def test_bootstrap_syntax(self):
        subprocess.run(['bash','-n',str(ROOT/'vpn.sh')],check=True)

    def test_pinned_installer_hash(self):
        self.assertIn(hashlib.sha256((ROOT/'vpn-bigsur.sh').read_bytes()).hexdigest(),BOOT)

    def test_bootstrap_only_invoked_at_end(self):
        self.assertTrue(BOOT.rstrip().endswith('bigsur_vpn_bootstrap "$@"'))
        self.assertEqual(BOOT.count('bigsur_vpn_bootstrap "$@"'),1)

    def test_bootstrap_removes_secret_environment_before_download(self):
        self.assertLess(BOOT.index('unset VPN_INSTALL_KEY'),BOOT.index('/usr/bin/curl'))
        self.assertIn('setup --key-stdin',BOOT)
        self.assertNotIn('sudo -E', re.sub(r'(?m)^\s*#.*$', '', BOOT))

    def test_missing_key_not_embedded(self):
        self.assertNotIn(DUMMY_KEY,SCRIPT+BOOT)
        self.assertNotRegex(SCRIPT+BOOT,r'VPN_INSTALL_KEY=[\'\"][0-9a-f]{32}')

    def test_linux_rejected_before_network(self):
        if sys.platform != 'linux': self.skipTest('Linux-specific platform guard')
        r=subprocess.run(['bash',str(ROOT/'vpn.sh')],capture_output=True,text=True)
        self.assertNotEqual(r.returncode,0)
        self.assertIn('Big Sur',r.stderr)

    def unlock(self, key):
        with tempfile.TemporaryDirectory() as d:
            stub=Path(d)/'controller.py'
            stub.write_text('import getpass, pathlib, sys\n'
                            'key=getpass.getpass("MUST NOT PROMPT")\n'
                            'pathlib.Path(sys.argv[3]).write_text(key)\n')
            out=Path(d)/'out'
            cmd=FUNCTIONS+'\nKEY_STDIN=1\nPYTHON='+repr(sys.executable)+'\nunlock_profile '+repr(str(stub))+' ignored '+repr(str(out))+'\n'
            r=self.shell(cmd,key+'\n')
            return r,out.read_text() if out.exists() else None

    def test_unlock_key_from_stdin_without_prompt(self):
        r,out=self.unlock(DUMMY_KEY)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(out,DUMMY_KEY)
        self.assertNotIn(DUMMY_KEY,r.stdout+r.stderr)
        self.assertNotIn('MUST NOT PROMPT',r.stdout+r.stderr)

    def test_unlock_empty_key_rejected_without_prompt(self):
        r,out=self.unlock('')
        self.assertNotEqual(r.returncode,0)
        self.assertIsNone(out)
        self.assertIn('PERSONAL one-command',r.stderr)

    def test_unlock_invalid_key_rejected_without_disclosure(self):
        key='invalid-secret-do-not-log'
        r,out=self.unlock(key)
        self.assertNotEqual(r.returncode,0)
        self.assertIsNone(out)
        self.assertNotIn(key,r.stdout+r.stderr)

    def workflow(self, installed=False, install_rc=0, on_rc=0, test_rc=0, bad_helper=False):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)/'install'; base.mkdir(); (base/'private').mkdir()
            log=Path(d)/'calls'
            if installed:
                for name in ['VERSION','vpn-bigsur.py','sing-box','private/profiles.json']:
                    p=base/name; p.write_text('mock'); p.chmod(0o700)
            mock=Path(d)/'python'
            mock.write_text('#!/bin/bash\ncmd="${@: -1}"\nprintf "%s\\n" "$cmd" >> "$CALLS"\n'
                            'case "$cmd" in on) exit "$ON_RC";; test) exit "$TEST_RC";; esac\n')
            mock.chmod(0o700)
            env=dict(os.environ,CALLS=str(log),ON_RC=str(on_rc),TEST_RC=str(test_rc))
            cmd=(FUNCTIONS+'\nBASE='+repr(str(base))+'\nPYTHON='+repr(str(mock))+'\n'
                 'owned_dir() { :; }\n'
                 'sha256() { printf "%s\\n" '+('bad' if bad_helper else '"$HELPER_SHA"')+'; }\n'
                 'install_vpn() { printf "install\\n" >> "$CALLS"; return '+str(install_rc)+'; }\n'
                 'setup_vpn\n')
            r=self.shell(cmd,env=env)
            return r,log.read_text().splitlines() if log.exists() else []

    def test_fresh_install_connect_verify_in_order(self):
        r,calls=self.workflow()
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(calls,['install','on','test'])
        self.assertIn('ГОТОВО:',r.stdout)

    def test_existing_profile_reused_without_install(self):
        r,calls=self.workflow(installed=True)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(calls,['on','test'])

    def test_install_failure_never_connects(self):
        r,calls=self.workflow(install_rc=4)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(calls,['install'])
        self.assertNotIn('ГОТОВО:',r.stdout)

    def test_connection_failure_stops_own_vpn(self):
        r,calls=self.workflow(on_rc=1)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(calls,['install','on','off'])
        self.assertNotIn('ГОТОВО:',r.stdout)

    def test_verification_failure_stops_own_vpn(self):
        r,calls=self.workflow(test_rc=1)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(calls,['install','on','test','off'])
        self.assertNotIn('ГОТОВО:',r.stdout)

    def test_modified_installed_helper_rejected(self):
        r,calls=self.workflow(installed=True,bad_helper=True)
        self.assertNotEqual(r.returncode,0)
        self.assertEqual(calls,[])

if __name__=='__main__':
    unittest.main(verbosity=2)
