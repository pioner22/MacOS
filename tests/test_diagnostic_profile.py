#!/usr/bin/env python3
"""Mocked profile-policy tests. No hardware access, raw I/O, or network.
Run: python3 tests/test_diagnostic_profile.py
BASH_BIN may select a separately installed Bash 3.2 binary.
"""
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASH = os.environ.get('BASH_BIN', '/bin/bash')
MOCKS = r'''
uname(){ if [ "$1" = -s ]; then printf '%s' "$T_KERNEL"; else printf '%s' "$T_ARCH"; fi; }
sysctl(){
 case "$2" in
 hw.model) printf '%s' "$T_MODEL";; hw.memsize) printf 68719476736;;
 machdep.cpu.vendor) printf '%s' "$T_VENDOR";;
 hw.optional.arm64) printf '%s' "$T_ARM";;
 sysctl.proc_translated) printf '%s' "$T_ROSETTA";; *) return 1;;
 esac
}
sw_vers(){ if [ "$1" = -productVersion ]; then printf '%s' "$T_OS"; else printf 25G83; fi; }
diskutil(){ if [ "$T_ENV" = recovery ]; then printf 'Volume Name: macOS Base System\n'; else printf 'Volume Name: Macintosh HD\n'; fi; }
xcode-select(){ [ "$T_COMPILER" = yes ]; }
xcrun(){ [ "$T_COMPILER" = yes ]; }
dp_tool(){ if [ "$1" = perl ] && [ "$T_PERL" = no ]; then return 1; fi; return 0; }
dp_path_exists(){
 case "$1" in
 /System/Installation/CDIS) [ "$T_ENV" = recovery ] || [ "$T_ENV" = cdis_only ];;
 /System/Library/CoreServices/Finder.app|/var/db/.AppleSetupDone) [ "$T_ENV" = full ];;
 /System/Library/Frameworks/Metal.framework) [ "$T_METAL" = yes ];;
 *) return 1;;
 esac
}
dp_detect
'''
DEFAULT = dict(T_KERNEL='Darwin', T_ARCH='x86_64', T_MODEL='MacBookPro16,1',
               T_VENDOR='GenuineIntel', T_ARM='0', T_ROSETTA='', T_OS='10.15.7',
               T_ENV='recovery', T_COMPILER='no', T_PERL='yes', T_METAL='no')

class ProfileTests(unittest.TestCase):
    def run_case(self, code, expected=0, **changes):
        env = dict(os.environ, **DEFAULT)
        env.update(changes)
        result = subprocess.run([BASH, '-c', '. "$1"\n' + MOCKS + code,
                                 'profile-test', str(ROOT/'diagnostic_profile.sh')],
                                env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result.stdout

    def test_a2141_recovery_auto(self):
        self.run_case('dp_apply auto auto auto && [ "$DP_STORAGE" = candidate_only ] && [ "$DP_CPU" = intel ]')
    def test_second_a2141_identifier(self):
        self.run_case('dp_apply a2141 auto auto && [ "$DP_STORAGE" = candidate_only ]', T_MODEL='MacBookPro16,4')
    def test_manual_matching_catalina(self):
        self.run_case('dp_apply a2141 catalina recovery && dp_allow ram_quick_test.sh')
    def test_os_mismatch(self):
        self.run_case('dp_apply a2141 tahoe recovery', expected=3)
    def test_unknown_version_limited(self):
        self.run_case('dp_apply auto auto auto && dp_allow ssd_test.sh', expected=3, T_OS='99.1')
    def test_apple_silicon_cannot_claim_a2141(self):
        self.run_case('dp_apply a2141 auto auto', expected=3, T_ARCH='arm64', T_MODEL='Mac14,2', T_ARM='1', T_VENDOR='')
    def test_rosetta_is_not_intel(self):
        self.run_case('dp_apply auto auto auto && [ "$DP_CPU" = apple_silicon ] && dp_allow ssd_test.sh', expected=3,
                      T_ARCH='x86_64', T_MODEL='Mac14,2', T_ROSETTA='1', T_ARM='0')
    def test_apple_observation_allowed(self):
        self.run_case('dp_apply auto auto auto && dp_allow hardware_probe.sh',
                      T_ARCH='arm64', T_MODEL='Mac14,2', T_ARM='1', T_VENDOR='')
    def test_apple_ram_not_claimed_supported(self):
        self.run_case('dp_apply auto auto auto && dp_allow ram_full_test.sh', expected=3,
                      T_ARCH='arm64', T_MODEL='Mac14,2', T_ARM='1', T_VENDOR='')
    def test_generic_intel_no_raw(self):
        self.run_case('dp_apply auto auto auto && dp_allow ssd_test.sh', expected=3, T_MODEL='MacBookPro15,1')
    def test_manual_generic_restricts_real_a2141(self):
        self.run_case('dp_apply intel_generic auto auto && dp_allow ssd_test.sh', expected=3)
    def test_full_os_raw_denied(self):
        self.run_case('dp_apply auto auto auto && dp_allow ssd_test.sh', expected=3, T_ENV='full')
    def test_full_os_cannot_claim_recovery(self):
        self.run_case('dp_apply auto auto recovery', expected=3, T_ENV='full')
    def test_unknown_environment_cannot_elevate(self):
        self.run_case('dp_apply a2141 auto recovery && dp_allow ssd_test.sh', expected=3, T_ENV='unknown')
    def test_cdis_alone_is_insufficient(self):
        self.run_case('dp_apply auto auto auto && [ "$DP_ENV" = unknown ] && dp_allow ssd_test.sh', expected=3, T_ENV='cdis_only')
    def test_limited_profile_stops_ram(self):
        self.run_case('dp_apply limited auto auto && dp_allow ram_full_test.sh', expected=3)
    def test_missing_perl_is_environment_issue(self):
        self.run_case('dp_apply auto auto auto && dp_allow ram_quick_test.sh', expected=3, T_PERL='no')
    def test_no_full_gpu_without_real_compiler(self):
        self.run_case('dp_apply auto auto auto && [ "$DP_GPU" = probe_only ]', T_ENV='full', T_METAL='yes')
    def test_gpu_prerequisites_not_hardware_pass(self):
        self.run_case('dp_apply auto auto auto && [ "$DP_GPU" = prerequisites_present ]',
                      T_ENV='full', T_METAL='yes', T_COMPILER='yes', T_OS='26.6.2')
    def test_linux_not_mac(self):
        self.run_case('dp_apply auto auto auto && dp_allow ram_quick_test.sh', expected=3, T_KERNEL='Linux')
    def test_invalid_profile(self):
        self.run_case('dp_apply arbitrary auto auto', expected=3)
    def test_every_supported_os_family(self):
        for v, key in [('10.15.7','catalina'),('11.7','big_sur'),('12.7','monterey'),
                       ('13.7','ventura'),('14.8','sonoma'),('15.6','sequoia'),('26.0','tahoe')]:
            with self.subTest(v=v):
                self.run_case('dp_apply auto auto auto && [ "$DP_OS_KEY" = "$T_EXPECT" ]', T_OS=v, T_EXPECT=key)
    def test_no_unvalidated_script(self):
        self.run_case('dp_apply auto auto auto && dp_allow made_up.sh', expected=3)
    def test_whole_suite_obeys_storage_policy(self):
        self.run_case('dp_apply intel_generic auto auto && dp_allow full_all_suite.sh', expected=3)
    def test_no_tty_cannot_confirm(self):
        out=self.run_case('dp_apply auto auto auto; dp_read_reply(){ return 1; }; dp_choose', expected=3)
        self.assertIn('NO_INTERACTIVE_INPUT', out)
    def test_profile_report_distinguishes_runtime(self):
        out=self.run_case('dp_apply auto auto auto && dp_show')
        self.assertIn('RUNNING_MACOS=10.15.7', out)
        self.assertIn('RU:', out)
        self.assertIn('EN:', out)

if __name__ == '__main__':
    unittest.main(verbosity=2)
