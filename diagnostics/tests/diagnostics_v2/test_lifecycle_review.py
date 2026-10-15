"""Control-flow audit: real shell/results/reports; mocked hardware stages only.
No Mac hardware diagnosis, no real disk-device writes, no external downloads.
"""
import os
import re
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(os.environ.get('MACDIAG_SRC') or Path(__file__).resolve().parents[2]).resolve()
PRELUDE = r'''
profile_detect(){
 KERNEL=Darwin;CPU=intel;ARCH=x86_64;MODEL=MacBookPro16,1;RAM_BYTES=68719476736;
 OS_KEY=catalina;OS_VERSION=10.15.7;OS_BUILD=QA;ENVIRONMENT=${QA_ENV:-full};
 MODEL_PROFILE=auto;OS_PROFILE=auto;ENV_PROFILE=auto;CONSOLE=headless;
 RAM_BACKEND=${QA_BACKEND:-native_candidate};FILE_BACKEND=native_candidate;
 CPU_BACKEND=sha_path;GPU_BACKEND=metal_candidate;PROFILE_POLICY=adaptive;
 PROFILE_ID=qa;CAP_SUPERVISOR=yes;CAP_PERL=yes;CAP_CURL=yes;CAP_SHA=yes;CAP_NATIVE=candidate;
 CAP_ROWS='';PF_LOG='';
}
qa_stage(){
 printf '%s\n' "$1" >> "$QA_DIR/calls.txt"
 if [ "${QA_FAILURE_STAGE:-}" = "$1" ];then
  result "${QA_STATE:-INCONCLUSIVE}" "${QA_CODE:-3}" "${QA_REASON:-QA_INCOMPLETE}" 'Контролируемый исход' 'Controlled outcome';return $?
 fi
 passed QA_STAGE_COMPLETE
}
selftest_main(){ qa_stage TOOLKIT; }
snapshot_main(){ printf 'HARDWARE\n' >> "$QA_DIR/calls.txt"; result OBSERVED 5 INVENTORY_ONLY ru en; }
power_main(){ printf 'POWER\n' >> "$QA_DIR/calls.txt"; result OBSERVED 5 POWER_OBSERVATION_ONLY ru en; }
ram_main(){ case "$1" in quick) qa_stage RAM_QUICK;;full)qa_stage RAM_FULL;;map)qa_stage RAM_MAP;;esac; }
cpu_main(){ qa_stage CPU; }
gpu_main(){ qa_stage GPU; }
network_supervised(){ qa_stage NETWORK; }
download_supervised(){ qa_stage DOWNLOAD; }
file_main(){ qa_stage FILE; }
readonly_main(){ qa_stage STORAGE_READONLY; }
support_main(){ printf 'SUPPORT\n' >> "$QA_DIR/calls.txt";result OBSERVED 5 SUPPORT_SAVED_NOT_SENT ru en; }
profile_choose(){ printf 'PROFILE_EDIT\n' >> "$QA_DIR/calls.txt";return 0; }
read_reply(){ REPLY='';IFS= read -r REPLY <&9; }
'''

class LifecycleTests(unittest.TestCase):
 def launch(self, choice='14', extra='', inputs='', env=None):
  td=tempfile.TemporaryDirectory(prefix='lifecycle-');self.addCleanup(td.cleanup);d=Path(td.name)
  (d/'answers').write_text(str(choice)+'\n'+inputs)
  e=dict(os.environ,QA_DIR=str(d),MACDIAG_REPORT_DIR=str(d),**(env or {}))
  code=f'. {shlex.quote(str(ROOT/"diagnostics_v2/run.sh"))};\n'+PRELUDE+f'\nexec 9<{shlex.quote(str(d/"answers"))}\n'+extra+'\nmain menu;exit $?'
  p=subprocess.run(['/bin/bash','-c',code],cwd=ROOT,env=e,text=True,capture_output=True,timeout=15)
  sessions=list(d.glob('macdiag-v2.*'))
  self.assertEqual(len(sessions),1,p.stdout+p.stderr)
  s=sessions[0]
  report=(s/'REPORT_RU_EN.md').read_text() if (s/'REPORT_RU_EN.md').exists() else ''
  rows=(s/'summary.tsv').read_text()
  calls=(d/'calls.txt').read_text().splitlines() if (d/'calls.txt').exists() else []
  return p,rows,report,calls,s
 def test_all_menu_choices_have_declared_result_and_exit(self):
  plans={1:('BLOCKED',7),2:('PASS',0),3:('PASS',0),4:('PASS',0),5:('PASS',0),6:('PASS',0),7:('PENDING_MANUAL',6),8:('PASS',0),9:('PASS',0),10:('OBSERVED',5),11:('OBSERVED',5),12:('PENDING_MANUAL',6),13:('BLOCKED',7),14:('PASS',0),16:('INCONCLUSIVE',3),17:('INCONCLUSIVE',3),18:('INCONCLUSIVE',3),19:('OBSERVED',5),20:('PASS',0)}
  for n,(state,rc) in plans.items():
   with self.subTest(menu=n):
    p,rows,report,calls,s=self.launch(n,inputs='0\n')
    self.assertEqual(p.returncode,rc,p.stdout+p.stderr)
    self.assertIn(f'State: **{state}**',report)
    self.assertNotEqual(rows,'',p.stdout)
 def test_one_selection_exits_not_second_queued_test(self):
  p,rows,report,calls,s=self.launch('14',inputs='2\n')
  self.assertEqual(p.returncode,0);self.assertEqual(calls,['TOOLKIT'])
  self.assertNotIn('RAM_QUICK',rows)
 def test_invalid_input_reprompts_without_starting_a_stage(self):
  p,rows,report,calls,s=self.launch('invalid',inputs='14\n')
  self.assertEqual(p.returncode,0);self.assertEqual(calls,['TOOLKIT'])
  self.assertEqual(p.stdout.count('20  HDD/SSD READ ONLY'),2)
 def test_profile_edit_returns_to_menu(self):
  p,rows,report,calls,s=self.launch('15',inputs='14\n')
  self.assertEqual(calls,['PROFILE_EDIT','TOOLKIT']);self.assertEqual(p.returncode,0)
 def test_exit_zero_runs_no_hardware(self):
  p,rows,report,calls,s=self.launch('0')
  self.assertEqual(p.returncode,0);self.assertEqual(calls,[]);self.assertEqual(rows,'')
  self.assertIn('State: **OBSERVED**',report)
 def test_full_native_ram_failure_blocks_all_dependent_stages(self):
  p,rows,report,calls,s=self.launch('16',env={'QA_FAILURE_STAGE':'RAM_QUICK','QA_STATE':'FAIL','QA_CODE':'2'})
  self.assertEqual(p.returncode,2);self.assertNotIn('RAM_FULL',calls);self.assertNotIn('CPU',calls)
  self.assertIn('RAM_FULL\tNOT_RUN',rows)
 def test_full_native_ram_incomplete_blocks_dependencies(self):
  p,rows,report,calls,s=self.launch('16',env={'QA_FAILURE_STAGE':'RAM_QUICK'})
  self.assertEqual(p.returncode,3);self.assertNotIn('RAM_FULL',calls);self.assertNotIn('CPU',calls)
 def test_recovery_native_incomplete_does_not_start_full(self):
  p,rows,report,calls,s=self.launch('16',inputs='0\n',env={'QA_ENV':'recovery','QA_FAILURE_STAGE':'RAM_QUICK','QA_REASON':'RAM_INCOMPLETE_OR_RESOURCE_LIMIT'})
  self.assertEqual(p.returncode,3);self.assertNotIn('RAM_FULL',calls)
  self.assertNotIn('CPU',calls);self.assertIn('RAM_EXTENDED\tNOT_RUN',rows)
 def test_recovery_missing_perl_runtime_does_not_escalate(self):
  p,rows,report,calls,s=self.launch('16',inputs='0\n',env={'QA_ENV':'recovery','QA_BACKEND':'perl_screen','QA_FAILURE_STAGE':'RAM_QUICK','QA_REASON':'RECOVERY_RAM_RUNTIME_UNAVAILABLE'})
  self.assertEqual(p.returncode,3);self.assertNotIn('RAM_FULL',calls);self.assertNotIn('CPU',calls)
 def test_recovery_clean_limited_ram_may_continue_but_never_overall_pass(self):
  p,rows,report,calls,s=self.launch('12',env={'QA_ENV':'recovery','QA_BACKEND':'perl_screen','QA_FAILURE_STAGE':'RAM_QUICK','QA_REASON':'RAM_SCREEN_CLEAN_NATIVE_PENDING'})
  self.assertEqual(p.returncode,3);self.assertIn('CPU',calls);self.assertIn('NETWORK',calls)
 def test_recovery_cpu_incomplete_stops_download_and_write(self):
  p,rows,report,calls,s=self.launch('16',inputs='0\n',env={'QA_ENV':'recovery','QA_FAILURE_STAGE':'CPU','QA_REASON':'CPU_PROCESS_OR_RESOURCE_LIMIT'})
  self.assertEqual(p.returncode,3);self.assertNotIn('DOWNLOAD',calls);self.assertNotIn('FILE',calls)
 def test_gpu_runtime_incomplete_stops_suite(self):
  p,rows,report,calls,s=self.launch('16',inputs='0\n',env={'QA_FAILURE_STAGE':'GPU','QA_REASON':'GPU_INCOMPLETE_OR_TIMEOUT'})
  self.assertEqual(p.returncode,3);self.assertNotIn('DOWNLOAD',calls)
 def test_gpu_missing_toolchain_keeps_independent_checks_available(self):
  p,rows,report,calls,s=self.launch('12',env={'QA_FAILURE_STAGE':'GPU','QA_REASON':'GPU_REQUIRES_FULL_MACOS_AND_TOOLCHAIN'})
  self.assertEqual(p.returncode,3);self.assertIn('NETWORK',calls)
 def test_network_unavailable_does_not_become_hardware_fail(self):
  p,rows,report,calls,s=self.launch('12',env={'QA_FAILURE_STAGE':'NETWORK','QA_REASON':'HTTPS_REACHABILITY_UNAVAILABLE'})
  self.assertEqual(p.returncode,3);self.assertIn('DOWNLOAD',calls);self.assertNotIn('\tFAIL\t',rows)
 def test_download_mismatch_stops_storage(self):
  p,rows,report,calls,s=self.launch('16',inputs='0\n',env={'QA_FAILURE_STAGE':'DOWNLOAD','QA_STATE':'FAIL','QA_CODE':'2','QA_REASON':'DOWNLOAD_PATH_FAILURE'})
  self.assertEqual(p.returncode,2);self.assertNotIn('FILE',calls);self.assertIn('STORAGE_FILE\tNOT_RUN',rows)
 def test_final_state_printed_only_after_final_report_attempt(self):
  extra='report_render(){ [ "$1" = RUNNING ] && return 0; return 3; }'
  p,rows,report,calls,s=self.launch('14',extra=extra)
  self.assertEqual(p.returncode,3,p.stdout+p.stderr)
  self.assertNotIn('FINAL_STATE=PASS',p.stdout)
  self.assertEqual(len(re.findall(r'^FINAL_STATE=',p.stdout,re.M)),1)
 def test_no_stale_success_explanation_after_process_failure(self):
  extra='cpu_main(){ passed QA_DATA_COMPLETE;return 139; }'
  p,rows,report,calls,s=self.launch('5',extra=extra)
  self.assertEqual(p.returncode,3);self.assertIn('PROCESS_EXIT_WITHOUT_MATCHING_RESULT',rows)
  self.assertNotIn('The tested stage completed without detected errors',report)
 def test_cpu_count_from_failed_sysctl_not_accepted(self):
  with tempfile.TemporaryDirectory() as d:
   code=f'. {shlex.quote(str(ROOT/"diagnostics_v2/run.sh"))}; STEP_DIR={shlex.quote(d)}; ENVIRONMENT=full;sysctl(){{ echo 2;return 1; }};cpu_worker(){{ echo UNEXPECTED_CPU_START;return 0; }};cpu_stress'
   p=subprocess.run(['/bin/bash','-c',code],capture_output=True,text=True,timeout=10)
   self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertNotIn('UNEXPECTED_CPU_START',p.stdout)
 def test_report_next_action_does_not_claim_reads_before_refused_disk(self):
  p=subprocess.run(['/bin/bash','-c',f'. {shlex.quote(str(ROOT/"diagnostics_v2/run.sh"))};next_step READONLY_NOT_AUTHORIZED INCONCLUSIVE'],text=True,capture_output=True,timeout=5)
  self.assertNotIn('Only selected-range readability was tested',p.stdout)
  self.assertNotIn('Проверено только чтение выбранных диапазонов',p.stdout)

if __name__=='__main__':unittest.main(verbosity=2)
