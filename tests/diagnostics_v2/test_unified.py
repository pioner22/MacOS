"""Unified entry/menu/report/signal regressions. No Mac hardware stress."""
import hashlib
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest
import pexpect

BASE=Path(__file__).resolve().parents[2]
ROOT=BASE/'diagnostics_v2'
MOCK='''profile_detect(){ KERNEL=Darwin;CPU=intel;ARCH=x86_64;MODEL=MacBookPro16,1;RAM_BYTES=68719476736;OS_KEY=catalina;OS_VERSION=10.15.7;OS_BUILD=QA;ENVIRONMENT=full;MODEL_PROFILE=auto;OS_PROFILE=auto;ENV_PROFILE=auto; }
'''
class UnifiedTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.d=Path(self.t.name)
        self.prefix=f'. "{ROOT}/run.sh"; '+MOCK+f'export MACDIAG_REPORT_DIR="{self.d}"; '
    def tearDown(self):self.t.cleanup()
    def shell(self,script):
        return subprocess.run(['/bin/bash','-c',self.prefix+script],capture_output=True,text=True,timeout=15)
    def report(self):
        return next(self.d.glob('macdiag-v2.*/REPORT_RU_EN.md')).read_text()
    def interactive(self,script):
        return pexpect.spawn('/bin/bash',['-c',self.prefix+script],encoding='utf-8',timeout=10)
    def test_version(self):
        p=self.shell('main --version');self.assertEqual(p.returncode,0);self.assertIn('2.0.0-rc4',p.stdout)
    def test_menu_exit_keeps_profile_without_test(self):
        p=self.interactive('main menu');p.expect('> ');p.sendline('0');p.expect(pexpect.EOF);p.close()
        self.assertEqual(p.exitstatus,0);self.assertTrue(list(self.d.glob('macdiag-v2.*/environment.tsv')));self.assertFalse(list(self.d.glob('macdiag-v2.*/*/engine.log')))
    def test_invalid_menu_reprompt(self):
        p=self.interactive('main menu');p.expect('> ');p.sendline('99');p.expect('UNKNOWN_SELECTION');p.expect('> ');p.sendline('0');p.expect(pexpect.EOF);p.close();self.assertEqual(p.exitstatus,0)
    def test_menu_routes_all_choices(self):
        modes={1:'raw',2:'ramquick',3:'ramfull',4:'rammap',5:'cpu',6:'gpu',7:'display',8:'network',9:'download',10:'power',11:'snapshot',12:'safe',13:'raw',14:'selftest',16:'acceptance',17:'storage',18:'bridge',19:'support'}
        for n,mode in modes.items():
            with self.subTest(n=n):
                p=self.interactive('profile_detect; menu; echo SELECTED=$MODE');p.expect('> ');p.sendline(str(n));p.expect('SELECTED='+mode);p.expect(pexpect.EOF);p.close();self.assertEqual(p.exitstatus,0)
    def test_profile_mismatch_does_not_launch_test(self):
        p=self.interactive('main menu');p.expect('> ');p.sendline('15');p.expect('MODEL /');p.sendline('1');p.expect('RUNNING OS /');p.sendline('7');p.expect('ENV /');p.sendline('2');p.expect('PROFILE_MISMATCH');p.expect('> ');p.sendline('0');p.expect(pexpect.EOF);p.close();self.assertEqual(p.exitstatus,0);self.assertTrue(list(self.d.glob('macdiag-v2.*/environment.tsv')));self.assertFalse(list(self.d.glob('macdiag-v2.*/*/engine.log')))
    def test_blank_consent_is_not_authorized(self):
        p=self.interactive('main storage');p.expect('> ');p.sendline(str(self.d));p.expect('> ');p.sendline('');p.expect(pexpect.EOF);p.close();self.assertEqual(p.exitstatus,3);self.assertIn('INCONCLUSIVE',self.report())
    def test_eof_consent_no_write(self):
        p=self.shell('read_reply(){ return 1; }; main storage');self.assertEqual(p.returncode,3);self.assertFalse(list(self.d.glob('**/.macdiag-test*.bin')))
    def test_standalone_pass_report(self):
        p=self.shell('selftest_main(){ passed TOOLKIT_CHECKED; };main selftest');self.assertEqual(p.returncode,0,p.stderr);r=self.report();self.assertIn('| TOOLKIT | PASS |',r);self.assertIn('State: **PASS**',r)
    def test_bad_hash_report_no_hardware_certificate(self):
        p=self.shell('download_supervised(){ fault DOWNLOAD_PATH_FAILURE; };main download');self.assertEqual(p.returncode,2);r=self.report();self.assertIn('State: **FAIL**',r);self.assertIn('not a specific component',r)
    def test_missing_result_no_pass(self):
        p=self.shell('ram_main(){ return 0; };main ramquick');self.assertEqual(p.returncode,3,p.stderr);r=self.report();self.assertIn('INCONCLUSIVE',r);self.assertNotIn('| RAM_QUICK | PASS |',r)
    def setup_suite(self):
        return '''selftest_main(){ passed TOOLKIT_CHECKED; };snapshot_main(){ result OBSERVED 5 INVENTORY_ONLY ru en; };power_main(){ result OBSERVED 5 POWER_ONLY ru en; };ram_main(){ passed RAM_OK; };cpu_main(){ passed CPU_OK; };gpu_main(){ passed GPU_OK; };network_supervised(){ passed HTTPS_OK; };download_supervised(){ passed DOWNLOAD_OK; };file_main(){ passed FILE_OK; };consent_files(){ return 0; };'''
    def test_acceptance_all_automatic_requires_manual(self):
        p=self.shell(self.setup_suite()+'main acceptance');self.assertEqual(p.returncode,6,p.stdout+p.stderr);r=self.report();self.assertIn('State: **PENDING_MANUAL**',r);self.assertNotIn('NOT_RUN',r.split('## Действия')[0]);self.assertIn('| STORAGE_FILE | PASS |',r)
    def test_ram_failure_blocks_later_stages_and_reports_not_run(self):
        p=self.shell(self.setup_suite()+'ram_main(){ fault RAM_DATA_MISMATCH; };main acceptance');self.assertEqual(p.returncode,2,p.stdout+p.stderr);r=self.report();self.assertIn('| CPU | NOT_RUN |',r);self.assertIn('| STORAGE_FILE | NOT_RUN |',r);self.assertIn('State: **FAIL**',r)
    def test_mlock_unavailable_no_dependent_stress(self):
        p=self.shell(self.setup_suite()+'ram_main(){ unknown MLOCK_REFUSED; };main acceptance');self.assertEqual(p.returncode,3);r=self.report();self.assertIn('| CPU | NOT_RUN |',r)
    def test_incomplete_download_not_erased_by_good_storage(self):
        p=self.shell(self.setup_suite()+'download_supervised(){ unknown DOWNLOAD_COVERAGE_INCOMPLETE; };main acceptance');self.assertEqual(p.returncode,3);r=self.report();self.assertIn('| STORAGE_FILE | PASS |',r);self.assertIn('State: **INCONCLUSIVE**',r)
    def test_gpu_failure_blocks_following_load(self):
        p=self.shell(self.setup_suite()+'gpu_main(){ fault GPU_ERROR; };main acceptance');self.assertEqual(p.returncode,2);self.assertIn('| NETWORK | NOT_RUN |',self.report())
    def test_ctrl_c_real_pty_stops_sleeping_child(self):
        pidfile=self.d/'child.pid'
        cmd=self.setup_suite()+f'''ram_main(){{ capture 30 /bin/bash -c 'echo $$ > "{pidfile}"; echo ENGINE_RUNNING; sleep 30'; return $?; }};main acceptance'''
        p=self.interactive(cmd);p.expect('ENGINE_RUNNING');start=time.monotonic();p.sendcontrol('c');p.expect(pexpect.EOF,timeout=8);p.close();self.assertEqual(p.exitstatus,130);self.assertLess(time.monotonic()-start,8)
        self.assertIn('State: **INTERRUPTED**',self.report());self.assertIn('| CPU | NOT_RUN |',self.report())
        pid=int(pidfile.read_text());probe=subprocess.run(['ps','-p',str(pid),'-o','stat='],capture_output=True,text=True);self.assertTrue(probe.returncode!=0 or probe.stdout.strip().startswith('Z'),probe.stdout)
    def test_supervisor_preserves_caller_trap(self):
        p=self.shell(f'STEP_DIR="{self.d}";trap "echo CALLER_TRAP" INT; supervise 5 /bin/true;trap -p INT');self.assertEqual(p.returncode,0);self.assertIn('CALLER_TRAP',p.stdout)
    def test_supervisor_term_child_group(self):
        log=self.d/'engine.log';pidfile=self.d/'child.pid'
        p=subprocess.Popen(['perl',str(ROOT/'supervise.pl'),'30',str(log),'/bin/bash','-c',f'echo $$ > "{pidfile}";sleep 30'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        for _ in range(100):
            if pidfile.exists():break
            time.sleep(.02)
        p.terminate();out,_=p.communicate(timeout=8);self.assertEqual(p.returncode,143,out)
    def test_supervisor_log_open_failure_no_execution(self):
        sentinel=self.d/'ran';p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'1',str(self.d/'missing'/'log'),'/usr/bin/touch',str(sentinel)],capture_output=True,text=True,timeout=5)
        self.assertEqual(p.returncode,3);self.assertFalse(sentinel.exists())
    def test_gpu_managed_sync_present(self):
        s=(ROOT/'metal_vram.m').read_text();self.assertIn('MTLResourceStorageModeManaged',s);self.assertIn('synchronizeResource:readback',s)
    def test_offline_latest_descriptor_selftest(self):
        p=subprocess.run(['/bin/bash',str(BASE/'st.sh'),'--offline','selftest'],capture_output=True,text=True,timeout=10,env=dict(os.environ,MACDIAG_REPORT_DIR=str(self.d)))
        self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn('RELEASE_VERSION=2.0.0-rc4',p.stdout);self.assertIn('REPORT=',p.stdout)
    def test_offline_corrupted_package_stops(self):
        import shutil
        copy=self.d/'package';shutil.copytree(BASE,copy);(copy/'diagnostics_v2'/'run.sh').write_text('echo SHOULD_NOT_RUN\n')
        p=subprocess.run(['/bin/bash',str(copy/'st.sh'),'--offline','selftest'],capture_output=True,text=True,timeout=10)
        self.assertEqual(p.returncode,3,p.stdout);self.assertNotIn('SHOULD_NOT_RUN',p.stdout)

if __name__=='__main__':unittest.main()
