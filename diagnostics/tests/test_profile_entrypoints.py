#!/usr/bin/env python3
"""Entry-point regression tests with fake profile responses; never runs disk I/O."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_diagnostic_profile import DEFAULT, MOCKS, ROOT, BASH

class EntryPointTests(unittest.TestCase):
    def run_entry(self, name, replies, expected, **changes):
        with tempfile.TemporaryDirectory(prefix='profile-integration-') as temp:
            tmp=Path(temp)
            state=tmp/'replies'
            state.write_text('\n'.join(replies)+'\n')
            # This mocked dependency is injected by fake curl; production code is unchanged.
            payload=(ROOT/'diagnostic_profile.sh').read_text()+ '\n' + MOCKS + r'''
dp_read_reply(){
  [ -s "$T_REPLIES" ] || return 1
  IFS= read -r DP_REPLY < "$T_REPLIES" || return 1
  sed '1d' "$T_REPLIES" > "$T_REPLIES.next"
  mv "$T_REPLIES.next" "$T_REPLIES"
  return 0
}
'''
            (tmp/'payload').write_text(payload)
            (tmp/'curl').write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$T_FETCHES"
out=''; url=''
while [ "$#" -gt 0 ]; do
 case "$1" in -o) out=$2; shift 2;; https://*) url=$1; shift;; *) shift;; esac
done
case "$url" in */diagnostic_profile.sh) cp "$T_PAYLOAD" "$out";; *) echo 'UNEXPECTED_DOWNLOAD' >&2; exit 88;; esac
''')
            (tmp/'curl').chmod(0o755)
            env=dict(os.environ, **DEFAULT)
            env.update(changes)
            env.update(PATH=str(tmp)+os.pathsep+os.environ['PATH'], T_PAYLOAD=str(tmp/'payload'),
                       T_FETCHES=str(tmp/'fetches'), T_REPLIES=str(state))
            run=subprocess.run([BASH, str(ROOT/name)], env=env, text=True, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, expected, run.stdout+run.stderr)
            calls=(tmp/'fetches').read_text()
            self.assertEqual(calls.count('https://'),1, calls)
            self.assertNotIn('UNEXPECTED_DOWNLOAD', run.stderr)
            return run.stdout
    def test_menu_exit_launches_no_test(self):
        self.run_entry('current.sh',['0'],0)
    def test_manual_profile_roundtrip_then_exit(self):
        out=self.run_entry('current.sh',['15','1','1','1','0'],0)
        self.assertIn('MODEL_PROFILE=a2141 OS_PROFILE=catalina ENV_PROFILE=recovery',out)
    def test_manual_os_mismatch_launches_no_test(self):
        out=self.run_entry('current.sh',['15','1','7','1'],3)
        self.assertIn('OS_VERSION_MISMATCH',out)
    def test_menu_ssd_on_full_os_blocked_before_fetch(self):
        self.run_entry('current.sh',['1'],3,T_ENV='full')
    def test_menu_whole_suite_wrong_model_blocked(self):
        self.run_entry('current.sh',['13'],3,T_MODEL='MacBookPro15,1')
    def test_direct_ssd_no_consent(self):
        out=self.run_entry('ssd_test.sh',['no'],3)
        self.assertIn('no_erase_consent',out)
    def test_direct_ssd_full_os_blocked(self):
        self.run_entry('ssd_test.sh',['ERASE-INTERNAL-SSD'],3,T_ENV='full')
    def test_direct_ssd_wrong_model_blocked(self):
        self.run_entry('ssd_test.sh',['ERASE-INTERNAL-SSD'],3,T_MODEL='MacBookPro15,1')
    def test_direct_ssd_eof_blocked(self):
        self.run_entry('ssd_test.sh',[],3)

if __name__=='__main__':
    unittest.main(verbosity=2)
