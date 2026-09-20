"""Recovery contracts tested with controlled host probes; no real Mac is implied."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]/'diagnostics_v2'

def bash(code, timeout=15):
    return subprocess.run(['/bin/bash','-c',f'. "{ROOT}/run.sh"; '+code],capture_output=True,text=True,timeout=timeout)

class ProfileTests(unittest.TestCase):
    def detect(self, arch='x86_64', model='MacBookPro16,1', osver='10.15.7', env='recovery', perl=True, native=False, translated='0', con='headless'):
        code=f'''
        uname(){{ case "$1" in -s)echo Darwin;;*)echo {arch};;esac; }}
        pf_probe(){{ shift; case "$*" in
          'sysctl -n hw.model')echo {model};;'sysctl -n hw.memsize')echo 68719476736;;
          'sysctl -n sysctl.proc_translated')echo {translated};;'sysctl -n hw.optional.arm64')echo {'1' if arch=='arm64' or translated=='1' else '0'};;
          'sysctl -n machdep.cpu.vendor')echo GenuineIntel;;'sysctl -n machdep.cpu.brand_string')echo TestCPU;;
          'sysctl -n hw.pagesize')echo 4096;;'sysctl -n kern.safeboot')echo {'1' if env=='safe' else '0'};;
          'sw_vers -productVersion')echo {osver};;'sw_vers -buildVersion')echo 19H2026;;
          'diskutil info /')echo '{'macOS Base System' if env=='recovery' else 'Other volume'}';;*)return 1;;esac; }}
        pf_path(){{ case "$1" in
          /System/Installation/CDIS) [ {env} = recovery ] || [ {env} = installer ];;
          /System/Library/CoreServices/Finder.app|/var/db/.AppleSetupDone) [ {env} = full ] || [ {env} = safe ];;*)return 1;;esac; }}
        profile_capabilities(){{ CAP_PERL={'yes' if perl else 'no'};CAP_SUPERVISOR={'yes' if perl else 'no'};CAP_NATIVE={'candidate' if native else 'no'};CAP_FILE_PERL={'yes' if perl else 'no'};CAP_SHA=yes;CAP_METAL=present;CAP_CURL=yes; }}
        registry_collect(){{ unset REGISTRY_STATUS; }} # isolated legacy fact derivation
        unset MODEL_PROFILE OS_PROFILE ENV_PROFILE SSH_CONNECTION SSH_TTY
        profile_detect;profile_show
        '''
        p=bash(code);self.assertEqual(p.returncode,0,p.stdout+p.stderr);return p.stdout
    def test_catalina_recovery_no_compiler_screen(self):
        out=self.detect();self.assertIn('ENVIRONMENT=recovery',out);self.assertIn('ram=perl_screen',out);self.assertIn('a2141-recovery.catalina',out)
    def test_full_native_retains_strict_engine(self):
        out=self.detect(env='full',native=True);self.assertIn('ram=native_candidate',out);self.assertIn('gpu=metal_candidate',out)
    def test_recovery_native_when_real_toolchain_candidate(self):
        out=self.detect(native=True);self.assertIn('ram=native_candidate',out);self.assertIn('gpu=inventory',out)
    def test_full_without_compiler_uses_screen(self):
        self.assertIn('ram=perl_screen',self.detect(env='full'))
    def test_no_perl_no_native_never_stress(self):
        out=self.detect(perl=False);self.assertIn('ram=unavailable',out)
    def test_rosetta_not_intel(self):
        out=self.detect(arch='x86_64',model='Mac14,9',translated='1',env='full',native=True)
        self.assertIn('CPU=apple_silicon',out);self.assertIn('ram=perl_screen',out)
    def test_apple_recovery_separate_profile(self):
        out=self.detect(arch='arm64',model='Mac14,9',osver='15.5');self.assertIn('apple-recovery.sequoia',out)
    def test_unknown_environment_observe_only(self):
        self.assertIn('ram=unavailable',self.detect(env='unknown',native=True))
    def test_installer_ambiguous_is_not_full(self):
        out=self.detect(env='installer');self.assertIn('ENVIRONMENT=installer_or_recovery',out)
    def test_safe_mode_graphics_not_enabled(self):
        out=self.detect(env='safe',native=True);self.assertIn('ENVIRONMENT=safe',out);self.assertIn('gpu=inventory',out)
    def test_os_recognition(self):
        for version,key in [('10.13.6','high_sierra'),('10.14.6','mojave'),('10.15.7','catalina'),('11.7','big_sur'),('12.7','monterey'),('13.7','ventura'),('14.7','sonoma'),('15.6','sequoia'),('26.0','tahoe'),('99.2','other')]:
            with self.subTest(version=version):self.assertEqual(bash(f'pf_os_key {version}').stdout,key)
    def test_bounded_probe_timeout(self):
        self.assertNotEqual(bash('pf_probe 1 sleep 10',timeout=4).returncode,0)
    def test_native_budget_is_capped_by_available_memory(self):
        p=bash("RAM_BYTES=68719476736;pf_probe(){ printf 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 4194304.\n'; };native_budget 49152")
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout.strip(),'8192')
    def test_native_budget_unknown_not_large_allocation(self):
        p=bash('RAM_BYTES=68719476736;pf_probe(){ return 1; };native_budget 49152');self.assertEqual(p.returncode,3)
    def test_real_perl_probe(self):
        p=bash('KERNEL=Linux;profile_capabilities;echo "$CAP_PERL $CAP_SUPERVISOR"');self.assertIn('yes yes',p.stdout)
    def test_profile_registry_not_eval(self):
        text=(ROOT/'profile.sh').read_text();self.assertNotIn('eval ',text);self.assertNotIn('. "$table"',text)

class ScreenTests(unittest.TestCase):
    def test_ram_tiny_actual_screen(self):
        p=subprocess.run(['perl',str(ROOT/'recovery_ram.pl'),'1','1'],capture_output=True,text=True,timeout=15)
        self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn('RAM_SCREEN_CLEAN',p.stdout);self.assertIn('NOT_ESTABLISHED',p.stdout)
    def test_ram_injected_corruption_detected(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d,'screen.pl');text=(ROOT/'recovery_ram.pl').read_text()
            text=text.replace('  sleep 1;', '  substr($buf[0],13,1,chr(ord(substr($buf[0],13,1))^1));')
            f.write_text(text)
            p=subprocess.run(['perl',str(f),'1','1'],capture_output=True,text=True,timeout=10)
            self.assertEqual(p.returncode,2,p.stdout+p.stderr);self.assertIn('RAM_SCREEN_MISMATCH',p.stdout)
    def test_file_injected_corruption_retained(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d,'file.pl');text=(ROOT/'recovery_file.pl').read_text()
            text=text.replace(' for my $pass(1..2){', ' sysopen(my $bad,$name,O_RDWR) or die;sysseek($bad,13,0);sysread($bad,my $v,1);sysseek($bad,13,0);syswrite($bad,chr(ord($v)^1));close $bad;\n for my $pass(1..2){')
            f.write_text(text)
            p=subprocess.run(['perl',str(f),d,'1'],capture_output=True,text=True,timeout=10)
            self.assertEqual(p.returncode,2,p.stdout+p.stderr);self.assertIn('EVIDENCE_FILE_RETAINED',p.stdout)
    def test_ram_limit_rejected(self):
        p=subprocess.run(['perl',str(ROOT/'recovery_ram.pl'),'40960','1']);self.assertEqual(p.returncode,3)
    def test_file_tiny_actual_screen_and_user_file(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'user.txt').write_text('important')
            p=subprocess.run(['perl',str(ROOT/'recovery_file.pl'),d,'1'],capture_output=True,text=True,timeout=15)
            self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn('FILE_SCREEN_CLEAN',p.stdout)
            self.assertEqual(Path(d,'user.txt').read_text(),'important');self.assertEqual(len(list(Path(d).iterdir())),1)
    def test_device_directory_refused(self):
        p=subprocess.run(['perl',str(ROOT/'recovery_file.pl'),'/dev','1']);self.assertEqual(p.returncode,3)
    def test_clean_screen_wrapper_is_not_pass(self):
        with tempfile.TemporaryDirectory() as d:
            p=bash(f'''STEP_DIR='{d}';RAM_BYTES=134217728;RAM_BACKEND=perl_screen;
            capture(){{ printf 'ENGINE_COMPLETE=RAM_SCREEN_CLEAN
' > "$STEP_DIR/engine.log";return 0; }}
            recovery_ram_main quick''')
            self.assertEqual(p.returncode,3,p.stdout);self.assertIn('RESULT=INCONCLUSIVE',p.stdout)
    def test_fault_wrapper_is_fail(self):
        with tempfile.TemporaryDirectory() as d:
            p=bash(f'''STEP_DIR='{d}';RAM_BYTES=134217728;RAM_BACKEND=perl_screen;capture(){{ return 2; }};recovery_ram_main quick''')
            self.assertEqual(p.returncode,2,p.stdout);self.assertIn('RESULT=FAIL',p.stdout)
    def test_recovery_safe_plan_never_offers_storage_or_large_ram(self):
        with tempfile.TemporaryDirectory() as d:
            p=bash(f'''SESSION="{d}";run_step(){{ LAST_STATE=PASS;echo "STAGE=$1"; }};finish_suite(){{ return 3; }};consent_files(){{ echo UNEXPECTED_CONSENT;return 0; }};recovery_suite safe''')
            self.assertEqual(p.returncode,3);self.assertNotIn('UNEXPECTED_CONSENT',p.stdout);self.assertNotIn('STORAGE_FILE',Path(d,'plan.txt').read_text());self.assertNotIn('RAM_EXTENDED',p.stdout)
    def test_recovery_mismatch_stops_before_network(self):
        with tempfile.TemporaryDirectory() as d:
            p=bash(f'''SESSION="{d}";run_step(){{ LAST_STATE=PASS;[ "$1" != RAM_SCREEN ] || LAST_STATE=FAIL;echo "STAGE=$1"; }};finish_suite(){{ return 2; }};recovery_suite acceptance''')
            self.assertEqual(p.returncode,2);self.assertNotIn('STAGE=NETWORK',p.stdout)
    def test_recovery_file_no_implicit_home(self):
        p=bash('ENVIRONMENT=recovery;read_reply(){ REPLY="";return 0; };consent_files');self.assertEqual(p.returncode,3)
    def test_early_probe_before_menu(self):
        t=(ROOT/'run.sh').read_text();part=t[t.index('main(){',t.index('engine_main(){')+1):]
        self.assertLess(part.index('profile_detect'),part.index('menu ||'))
        self.assertLess(part.index('environment_record >'),part.index('menu ||'))

class SupportTests(unittest.TestCase):
    def test_export_excludes_private_raw_paths_and_tokens(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'environment.tsv').write_text('schema\t1\nversion\t2.0.0-rc3\nmodel\tMacBookPro16,1\nserial\tSECRET_SERIAL\nip\t192.168.1.8\n')
            (p/'summary.tsv').write_text('RAM\tINCONCLUSIVE\tRAM_SCREEN_CLEAN_NATIVE_PENDING\t/Users/dima/private\n')
            (p/'engine.log').write_text('Authorization: Bearer TOP_SECRET')
            r=bash(f'STEP_DIR="{d}";support_export "{d}"');self.assertEqual(r.returncode,5,r.stdout+r.stderr)
            out=next(p.glob('support-review.*/ISSUE_DRAFT.md')).read_text()
            for v in ['SECRET_SERIAL','192.168','/Users/dima','TOP_SECRET']:self.assertNotIn(v,out)
            self.assertIn('RAM_SCREEN_CLEAN',out);self.assertIn('REVIEW REQUIRED',out)
    def test_symlink_source_refused(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'environment.tsv').symlink_to('/etc/passwd');Path(d,'summary.tsv').write_text('')
            self.assertEqual(bash(f'support_export "{d}"').returncode,3)
    def test_no_upload_code_in_export(self):
        t=(ROOT/'recovery.sh').read_text().split('support_export(){',1)[1];self.assertNotRegex(t,r'(?m)^\s*(?:curl|gh)\s')

if __name__=='__main__':unittest.main()
