"""Targeted regressions for proposed journal repair; no Mac hardware facts.
Run: MACDIAG_SRC=/path/to/source python test_review_journal.py -v
"""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import unittest
ROOT=Path(os.environ.get('MACDIAG_SRC') or Path(__file__).resolve().parents[2])
PROFILE=r'''profile_detect(){ KERNEL=Darwin;CPU=intel;ARCH=x86_64;MODEL=MacBookPro16,1;RAM_BYTES=68719476736;OS_KEY=catalina;OS_VERSION=10.15.7;OS_BUILD=QA;ENVIRONMENT=full;MODEL_PROFILE=auto;OS_PROFILE=auto;ENV_PROFILE=auto;RAM_BACKEND=native_candidate;PROFILE_ID=qa;PROFILE_POLICY=adaptive; }
selftest_main(){ passed TOOLKIT_CHECKED; };snapshot_main(){ result OBSERVED 5 X ru en; };power_main(){ result OBSERVED 5 X ru en; }
'''
class JournalTests(unittest.TestCase):
 def shell(self,code):
  return subprocess.run(['/bin/bash','-c',f'. "{ROOT}/diagnostics_v2/run.sh"; '+code],capture_output=True,text=True,timeout=8)
 def test_run_step_preserves_custom_traps(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.shell(f'''SESSION='{d}';STEP_DIR=$SESSION; : > "$SESSION/summary.tsv";
report_render(){{ :; }};next_step(){{ :; }};child(){{ passed OK; }};
trap 'printf CUSTOM_INT' INT;trap 'printf CUSTOM_TERM' TERM;
before=$(trap -p INT TERM);run_step TEST child;after=$(trap -p INT TERM);[ "$before" = "$after" ]''')
   self.assertEqual(p.returncode,0,p.stdout+p.stderr)
 def cancellation(self,sig):
  with tempfile.TemporaryDirectory() as d:
   code=f'''. "{ROOT}/diagnostics_v2/run.sh";export MACDIAG_REPORT_DIR='{d}';{PROFILE}
ram_main(){{ capture 5 /bin/bash -c 'echo ENGINE_RUNNING; sleep 0.5';passed MOCK_COMPLETED; }};
main acceptance;exit $?'''
   p=subprocess.Popen(['/bin/bash','-c',code],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
   lines=[]
   try:
    while True:
     ln=p.stdout.readline();lines.append(ln)
     if 'ENGINE_RUNNING' in ln:break
     if not ln:raise AssertionError('No marker: '+''.join(lines))
    p.send_signal(sig);tail,_=p.communicate(timeout=6);text=''.join(lines)+tail
    self.assertEqual(p.returncode,128+sig,text)
    session=next(Path(d).glob('macdiag-v2.*'))
    self.assertIn('RAM_QUICK\tINCONCLUSIVE\tINTERRUPTED\t',(session/'summary.tsv').read_text())
    self.assertNotIn('| RAM_QUICK | NOT_RUN |',(session/'REPORT_RU_EN.md').read_text())
   finally:
    if p.poll() is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
    if p.stdout:p.stdout.close()
 def test_parent_only_term_is_not_swallowed(self):self.cancellation(signal.SIGTERM)
 def test_parent_only_hup_is_not_swallowed(self):self.cancellation(signal.SIGHUP)
 def test_known_fail_and_interrupt_remain_separate(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.shell(f'''SESSION='{d}';MODE=acceptance;: > "$SESSION/profile.txt";
printf 'NETWORK\\tFAIL\\tHTTPS_TEST\\t{d}\\n' > "$SESSION/summary.tsv";session_exit 130''')
   self.assertEqual(p.returncode,130,p.stdout+p.stderr)
   report=Path(d,'REPORT_RU_EN.md').read_text()
   self.assertIn('State: **FAIL**',report)
   self.assertIn('Execution: **INTERRUPTED**',report)
 def test_aborted_stage_structured_fail_is_not_discarded(self):
  with tempfile.TemporaryDirectory() as d:
   stage=Path(d,'RAM_QUICK.test');stage.mkdir();(stage/'result.tsv').write_text('FAIL\t2\tRAM_DATA_MISMATCH\n')
   p=self.shell(f'''SESSION='{d}';ACTIVE_STAGE_NAME=RAM_QUICK;ACTIVE_STAGE_DIR='{stage}';
: > "$SESSION/summary.tsv";: > "$SESSION/profile.txt";session_exit 130''')
   self.assertEqual(p.returncode,130,p.stdout+p.stderr)
   self.assertIn('RAM_QUICK\tFAIL\tRAM_DATA_MISMATCH\t',Path(d,'summary.tsv').read_text())
 def test_finalize_only_once(self):
  with tempfile.TemporaryDirectory() as d:
   stage=Path(d,'RAM_QUICK.test');stage.mkdir()
   p=self.shell(f'''SESSION='{d}';ACTIVE_STAGE_NAME=RAM_QUICK;ACTIVE_STAGE_DIR='{stage}';
: > "$SESSION/summary.tsv";record_unfinished_stage 130;record_unfinished_stage 130''')
   self.assertEqual(p.returncode,0,p.stdout+p.stderr)
   self.assertEqual(len(Path(d,'summary.tsv').read_text().splitlines()),1)
 def test_missing_result_exit_zero_not_pass(self):
  with tempfile.TemporaryDirectory() as d:
   p=self.shell(f'''SESSION='{d}';: > "$SESSION/summary.tsv";report_render(){{ :; }};
child(){{ return 0; }};run_step TEST child;[ "$LAST_STATE" = INCONCLUSIVE ]''')
   self.assertEqual(p.returncode,0,p.stdout+p.stderr)
if __name__=='__main__':unittest.main()
