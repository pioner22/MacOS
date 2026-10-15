"""Second audit: runtime regressions on local files/processes, mocked Mac probes.
No real Mac, disk devices, remote servers or large hardware loads are exercised.
"""
import os, signal, subprocess, tempfile, time, unittest
from pathlib import Path
ROOT=Path(os.environ.get('MACDIAG_SRC') or Path(__file__).resolve().parents[2])/'diagnostics_v2'

def shell(code,timeout=15,env=None):
    return subprocess.run(['/bin/bash','-c',f'. "{ROOT}/run.sh"; '+code],capture_output=True,text=True,timeout=timeout,env=dict(os.environ,**(env or {})))

class ProfileFailureTests(unittest.TestCase):
    def run_profile(self,fail):
        # Commands emit realistic stdout followed by a failed exit: must not be trusted.
        return shell(r'''
uname(){ case "$1" in -s)echo Darwin;;*)echo x86_64;;esac; }
pf_path(){ case "$1" in /System/Installation/CDIS)return 0;;*)return 1;;esac; }
profile_capabilities(){ CAP_NATIVE=candidate;CAP_SUPERVISOR=yes;CAP_PERL=yes;CAP_FILE_PERL=yes;CAP_SHA=yes;CAP_METAL=present; }
pf_probe(){ shift;case "$*" in
 'sysctl -n hw.model')echo MacBookPro16,1;;
 'sysctl -n hw.memsize')echo 68719476736;;
 'sysctl -n machdep.cpu.vendor')echo GenuineIntel;;
 'sysctl -n hw.optional.arm64'|'sysctl -n sysctl.proc_translated')echo 0;;
 'sysctl -n hw.pagesize')echo 4096;;
 'sw_vers -productVersion')echo 10.15.7;;
 'sw_vers -buildVersion')echo 19H2026;;
 'diskutil info /')echo 'Volume Name: macOS Base System';;
 *)echo TestCPU;;esac
 [ "$*" != "$FAIL_PROBE" ]; }
unset MODEL_PROFILE OS_PROFILE ENV_PROFILE
profile_detect;profile_show
''',env={'FAIL_PROBE':fail})
    def test_failed_model_stdout_not_trusted(self):
        p=self.run_profile('sysctl -n hw.model');self.assertIn('MODEL=unknown',p.stdout)
    def test_failed_ram_stdout_not_trusted(self):
        p=self.run_profile('sysctl -n hw.memsize');self.assertIn('RAM_BYTES=0',p.stdout)
    def test_failed_root_probe_cannot_confirm_recovery(self):
        p=self.run_profile('diskutil info /');self.assertIn('ENVIRONMENT=installer_or_recovery',p.stdout)
    def test_failed_os_version_not_accepted(self):
        p=self.run_profile('sw_vers -productVersion');self.assertIn('RUNNING_OS=unknown',p.stdout)
    def test_failed_cpu_vendor_not_accepted(self):
        p=self.run_profile('sysctl -n machdep.cpu.vendor');self.assertIn('CPU=unknown',p.stdout)
    def test_successful_probes_remain_supported(self):
        p=self.run_profile('no such probe');self.assertIn('ENVIRONMENT=recovery',p.stdout);self.assertIn('MODEL=MacBookPro16,1',p.stdout)

class SupervisionTests(unittest.TestCase):
    def test_background_worker_without_pipe_is_not_pass(self):
        with tempfile.TemporaryDirectory() as d:
            pidfile=Path(d,'pid')
            p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'5',d+'/log','/bin/bash','-c',f'sleep 20 >/dev/null 2>&1 & echo $! > "{pidfile}"; echo PARENT_DONE; exit 0'],capture_output=True,text=True,timeout=8)
            self.assertEqual(p.returncode,3,p.stdout+p.stderr)
            self.assertIn('UNFINISHED_DESCENDANTS=1',p.stdout)
    def test_joined_worker_does_not_make_false_failure(self):
        with tempfile.TemporaryDirectory() as d:
            p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'5',d+'/log','/bin/bash','-c','sleep 0.1 >/dev/null 2>&1 & wait; echo DONE'],capture_output=True,text=True,timeout=8)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    def test_timeout_still_distinct(self):
        with tempfile.TemporaryDirectory() as d:
            p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'1',d+'/log','sleep','20'],capture_output=True,text=True,timeout=8)
            self.assertEqual(p.returncode,124,p.stdout+p.stderr)

class FinalizationTests(unittest.TestCase):
    def exercise(self,fail_stage=False,fail_report=False,exit_code=0):
        with tempfile.TemporaryDirectory() as d:
            row='RAM\tFAIL\tDATA_ERROR\t-\n' if fail_stage else 'TOOLKIT\tPASS\tTOOLKIT_CHECKED\t-\n'
            Path(d,'summary.tsv').write_text(row);Path(d,'profile.txt').write_text('TEST_ONLY\n')
            code=f'SESSION="{d}";SESSION_FINAL_STATE=PASS;MODE=selftest;'
            if fail_report:code+='report_render(){ return 3; };'
            p=shell(code+f'session_exit {exit_code}')
            return p,Path(d,'session.state').read_text(),Path(d,'execution.tsv').read_text()
    def test_report_failure_never_prints_final_pass(self):
        p,state,execution=self.exercise(fail_report=True)
        self.assertEqual(p.returncode,3);self.assertIn('FINAL_STATE=INCONCLUSIVE',p.stdout);self.assertNotIn('\tPASS\t0',state)
        self.assertIn('exit_code\t3',execution)
    def test_report_failure_does_not_claim_existing_report(self):
        p,_,_=self.exercise(fail_report=True);self.assertNotRegex(p.stdout,r'(?m)^REPORT=/');self.assertIn('REPORT=UNAVAILABLE',p.stdout)
    def test_unexpected_error_downgrades_stale_final_pass(self):
        p,state,_=self.exercise(exit_code=3);self.assertNotIn('\tPASS\t',state);self.assertIn('FINAL_STATE=INCONCLUSIVE',p.stdout)
    def test_report_failure_keeps_known_data_failure(self):
        p,state,_=self.exercise(fail_stage=True,fail_report=True)
        self.assertEqual(p.returncode,3);self.assertIn('FINAL_STATE=FAIL',p.stdout);self.assertIn('\tFAIL\t3',state)
    def test_actual_report_file_open_error_cannot_pass(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'summary.tsv').write_text('TOOLKIT\tPASS\tTOOLKIT_CHECKED\t-\n')
            Path(d,'profile.txt').write_text('QA\n')
            Path(d,'report.tmp').mkdir()
            p=shell(f'SESSION="{d}";SESSION_FINAL_STATE=PASS;MODE=selftest;session_exit 0')
            self.assertEqual(p.returncode,3,p.stdout+p.stderr)
            self.assertIn('FINAL_STATE=INCONCLUSIVE',p.stdout)
            self.assertIn('REPORT=UNAVAILABLE',p.stdout)
    def test_previous_report_marked_incomplete_after_failure(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'summary.tsv').write_text('TOOLKIT\tPASS\tTOOLKIT_CHECKED\t-\n')
            Path(d,'REPORT_RU_EN.md').write_text('RUNNING old report')
            p=shell(f'SESSION="{d}";SESSION_FINAL_STATE=PASS;report_render(){{ return 3; }};session_exit 0')
            self.assertEqual(p.returncode,3)
            self.assertFalse(Path(d,'REPORT_RU_EN.md').exists())
            self.assertEqual(Path(d,'REPORT_INCOMPLETE_RU_EN.md').read_text(),'RUNNING old report')
    def test_successful_selftest_remains_pass(self):
        p,state,execution=self.exercise();self.assertEqual(p.returncode,0);self.assertIn('\tPASS\t0',state)

class DownloadStopTests(unittest.TestCase):
    def run_download(self,rc,fallback=False):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'fixtures.txt').write_text('6 '+'a'*64+' test.bin 3\n')
            code=f'''ROOT="{d}";STEP_DIR="{d}";select_hash(){{ return 0; }};
curl(){{ printf '{404 if fallback else 200}'; }};
net_check(){{ echo CALLED >> '{d}/calls';NET_REASON={'SHA256_MISMATCH' if rc==2 else 'REMOTE_ASSET_UNAVAILABLE'};return {rc}; }};
download_main'''
            p=shell(code);calls=Path(d,'calls').read_text().splitlines();return p,len(calls)
    def test_first_fixture_integrity_error_stops_transfers(self):
        p,n=self.run_download(2);self.assertEqual(p.returncode,2);self.assertEqual(n,1,p.stdout)
    def test_first_fallback_integrity_error_stops_transfers(self):
        p,n=self.run_download(2,True);self.assertEqual(p.returncode,2);self.assertEqual(n,1,p.stdout)
    def test_unavailable_fixture_not_relabelled_hardware_fail(self):
        p,n=self.run_download(3);self.assertEqual(p.returncode,3)
    def test_download_failure_prevents_later_storage_stage(self):
        with tempfile.TemporaryDirectory() as d:
            p=shell(f'''SESSION="{d}";RAM_BACKEND=native_candidate;ENVIRONMENT=full;
run_step(){{ LAST_STATE=PASS;[ "$1" != DOWNLOAD ] || LAST_STATE=FAIL;echo "STAGE=$1"; }};
consent_files(){{ echo BAD_CONSENT_PROMPT;return 0; }};finish_suite(){{ return 2; }};acceptance_main acceptance''')
            self.assertNotIn('STAGE=STORAGE_FILE',p.stdout);self.assertNotIn('BAD_CONSENT_PROMPT',p.stdout)
    def test_recovery_download_failure_prevents_storage(self):
        with tempfile.TemporaryDirectory() as d:
            p=shell(f'''SESSION="{d}";run_step(){{ LAST_STATE=PASS;[ "$1" != DOWNLOAD ] || LAST_STATE=FAIL;echo "STAGE=$1"; }};
consent_files(){{ echo BAD_CONSENT_PROMPT;return 0; }};finish_suite(){{ return 2; }};recovery_suite acceptance''')
            self.assertNotIn('STAGE=STORAGE_FILE',p.stdout)

class BridgePreflightTests(unittest.TestCase):
    def bridge(self,metadata_rc):
        with tempfile.TemporaryDirectory() as d:
            p=shell(f'''STEP_DIR="{d}";BRIDGE_TARGET="{d}";RAM_BYTES=68719476736;FILE_BACKEND=native_candidate;FILE_CONSENT=TEST-FILES;ENVIRONMENT=full;
profile_validate(){{ return 0; }};native_budget(){{ echo 40960; }};
pf_probe(){{ shift;case "$1" in diskutil)printf 'Device Location: External\nMount Point: /\n';return {metadata_rc};;df)df -Pk '{d}';;esac; }};
compile_c(){{ echo UNSAFE_BUILD;return 3; }};file_main bridge''')
            return p
    def test_failed_metadata_cannot_authorize_bridge(self):
        p=self.bridge(1);self.assertEqual(p.returncode,3);self.assertNotIn('UNSAFE_BUILD',p.stdout);self.assertIn('EXTERNAL_TARGET_NOT_CONFIRMED',p.stdout)
    def test_valid_metadata_reaches_build(self):
        p=self.bridge(0);self.assertIn('UNSAFE_BUILD',p.stdout)

class DrainStressTests(unittest.TestCase):
    def test_repeated_short_processes_with_buffered_output(self):
        with tempfile.TemporaryDirectory() as d:
            for i in range(25):
                p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'5',d+'/log',
                                  'perl','-e','print "x" x 262144;'],capture_output=True,timeout=8)
                self.assertEqual(p.returncode,0,(i,p.stdout[-200:],p.stderr))
                self.assertTrue(p.stdout.startswith(b'x'*262144))

class SelftestPrerequisiteTests(unittest.TestCase):
    def test_missing_perl_modules_are_environment_limit(self):
        with tempfile.TemporaryDirectory() as d:
            p=shell(f'''STEP_DIR="{d}";
perl(){{ echo "Can't locate IO/Select.pm" >&2;return 2; }};
selftest_main''')
            self.assertEqual(p.returncode,3,p.stdout+p.stderr)
            self.assertIn('PERL_SELFTEST_DEPENDENCIES_UNAVAILABLE',p.stdout)

class PartialIOTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.d=Path(cls.tmp.name)
        # LD_PRELOAD validation is Linux-specific, never exported by the launcher.
        if os.uname().sysname!='Linux':raise unittest.SkipTest('Linux fault interposition only')
        shim=Path(__file__).with_name('io_fault_shim.c')
        subprocess.run(['cc','-shared','-fPIC','-O2','-Wall','-Wextra',str(shim),'-ldl','-o',str(cls.d/'shim.so')],check=True,capture_output=True)
        subprocess.run(['cc','-std=c11','-O2','-Wall','-Wextra','-Werror',str(ROOT/'storage_file.c'),'-o',str(cls.d/'file')],check=True,capture_output=True)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def check_io(self,mode,rc,completed=False):
        with tempfile.TemporaryDirectory() as d:
            user=Path(d,'untouched.txt');user.write_bytes(b'KEEP')
            p=subprocess.run([str(self.d/'file'),'storage','1','2',d,'10'],
                env=dict(os.environ,LD_PRELOAD=str(self.d/'shim.so'),QA_IO_FAULT=mode),
                capture_output=True,text=True,timeout=15)
            self.assertEqual(p.returncode,rc,p.stdout+p.stderr)
            self.assertEqual(user.read_bytes(),b'KEEP')
            self.assertEqual('ENGINE_COMPLETE=FILE_BYTES_VERIFIED' in p.stdout,completed)
            if rc==2:self.assertIn('FAILED_TEST_FILE_PRESERVED=',p.stdout)
    def test_short_reads_and_writes_complete_exactly(self):self.check_io('short',3,True)
    def test_eintr_read_and_write_are_retried(self):self.check_io('EINTR',3,True)
    def test_eio_is_observed_io_failure(self):self.check_io('EIO',2)
    def test_enospc_is_resource_limit(self):self.check_io('ENOSPC',3)
    def test_eacces_is_not_media_failure(self):self.check_io('EACCES',3)

if __name__=='__main__':unittest.main(verbosity=2)
