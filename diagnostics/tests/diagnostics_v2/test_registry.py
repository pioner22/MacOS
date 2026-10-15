"""Compatibility registry: real shell/parser/probes; simulated Mac facts explicitly.
No network requests or raw-disk access. Plans are not hardware test results.
"""
import importlib.util,json,os,shlex,shutil,subprocess,tempfile,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[2];ROOT=BASE/'diagnostics_v2'
FACTS='''
KERNEL=Darwin;CPU=intel;ARCH=x86_64;HW_PROFILE=a2141;MODEL=MacBookPro16,1
RAM_BYTES=68719476736;OS_KEY=catalina;OS_BUILD=19H2026;ENVIRONMENT=recovery;CONSOLE=tty
MODEL_PROFILE=auto;ENV_PROFILE=auto;OS_PROFILE=auto;REGISTRY_SHELL=bash32
CAP_PERL=yes;CAP_SUPERVISOR=yes;CAP_SHA=yes;CAP_CURL=yes;CAP_FILE_PERL=yes
CAP_NATIVE=no;CAP_CLANG=;CAP_METAL=present;REGISTRY_STATUS=VALID
REGISTRY_CAPS=''
for c in bash_runtime bash_system awk tee perl perl_supervisor perl_file perl64 sha256 curl diskutil;do rg_add "$c" VERIFIED /mock/tool unknown QA CONTROLLED;done
'''
def sh(code,timeout=20):
    return subprocess.run(['/bin/bash','-c',f'. {shlex.quote(str(ROOT/"run.sh"))};\n'+code],text=True,capture_output=True,timeout=timeout)
class RegistryTests(unittest.TestCase):
    def run_code(self,code,expected=0):
        p=sh(code);self.assertEqual(p.returncode,expected,p.stdout+p.stderr);return p.stdout
    def tables(self):
        td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup);p=Path(td.name)
        for f in ROOT.glob('registry_*.tsv'):shutil.copyfile(f,p/f.name)
        return p
    def test_generated_tables_match(self):
        p=subprocess.run(['python3',str(BASE/'tools/build_diagnostics_registry.py'),'--check'],capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    def test_runtime_validator(self):self.run_code('rg_validate')
    def test_missing_table_rejected(self):
        p=self.tables();(p/'registry_tools.tsv').unlink();self.run_code(f'ROOT={shlex.quote(str(p))};rg_validate',3)
    def test_symlink_table_rejected(self):
        p=self.tables();f=p/'registry_tools.tsv';f.unlink();f.symlink_to(ROOT/'registry_tools.tsv');self.run_code(f'ROOT={p};rg_validate',3)
    def test_no_terminal_newline_rejected(self):
        p=self.tables();f=p/'registry_profiles.tsv';f.write_bytes(f.read_bytes().rstrip(b'\n'));self.run_code(f'ROOT={p};rg_validate',3)
    def test_duplicate_profile_rejected(self):
        p=self.tables();f=p/'registry_profiles.tsv';f.write_text(f.read_text()+f.read_text().splitlines()[0]+'\n');self.run_code(f'ROOT={p};rg_validate',3)
    def test_empty_field_rejected(self):
        p=self.tables();f=p/'registry_profiles.tsv';f.write_text(f.read_text().replace('\t500\t','\t\t',1));self.run_code(f'ROOT={p};rg_validate',3)
    def test_shell_injection_is_data_and_rejected(self):
        p=self.tables();marker=p/'OWNED';f=p/'registry_profiles.tsv';f.write_text(f.read_text().replace('safe-mode',f'$(touch {marker})',1));self.run_code(f'ROOT={p};rg_validate',3);self.assertFalse(marker.exists())
    def test_equal_priority_conflict_blocks_native(self):
        p=self.tables();f=p/'registry_profiles.tsv';f.write_text(f.read_text()+'same-priority\t400\ta2141\trecovery\tany\tany\tany\tadaptive\n')
        out=self.run_code(FACTS+f'ROOT={p};registry_resolve;echo "$REGISTRY_SELECTION $PROFILE_POLICY $RAM_BACKEND"')
        self.assertIn('AMBIGUOUS_OR_MISSING observe unavailable',out)
    def test_exact_build_restriction_precedence(self):
        p=self.tables();f=p/'registry_profiles.tsv';f.write_text(f.read_text()+'known-build-deny\t900\ta2141\trecovery\tcatalina\t19H2026\tbash32\tobserve\n')
        out=self.run_code(FACTS+f'ROOT={p};registry_resolve;echo "$PROFILE_TEMPLATE $PROFILE_POLICY $RAM_BACKEND"');self.assertIn('known-build-deny observe unavailable',out)
    def test_different_build_does_not_inherit_restriction(self):
        p=self.tables();f=p/'registry_profiles.tsv';f.write_text(f.read_text()+'other-build\t900\ta2141\trecovery\tcatalina\t19HOTHER\tbash32\tobserve\n')
        self.assertIn('a2141-recovery adaptive',self.run_code(FACTS+f'ROOT={p};registry_resolve;echo "$PROFILE_TEMPLATE $PROFILE_POLICY"'))
    def test_recovery_without_compiler_limited_not_pass(self):
        out=self.run_code(FACTS+'registry_resolve;registry_decision RAM_FULL;echo "$RAM_BACKEND $REGISTRY_DECISION $REGISTRY_REASON"')
        self.assertIn('perl_screen LIMITED SCREENING_NOT_HARDWARE_ACCEPTANCE',out)
    def test_full_intel_toolchain_is_candidate_not_certification(self):
        out=self.run_code(FACTS+'ENVIRONMENT=full;CAP_NATIVE=candidate;rg_add compiler CANDIDATE /mock/clang unknown QA BUILD_PENDING;registry_resolve;registry_decision RAM_QUICK;echo "$RAM_BACKEND $REGISTRY_DECISION $PROFILE_VALIDATION"')
        self.assertIn('native_candidate READY SOFTWARE_TESTED_REAL_HARDWARE_PENDING',out)
    def test_recovery_never_enables_metal(self):
        out=self.run_code(FACTS+'CAP_NATIVE=candidate;rg_add compiler CANDIDATE /mock/clang unknown QA BUILD_PENDING;registry_resolve;echo "$GPU_BACKEND"');self.assertEqual(out.strip(),'inventory')
    def test_apple_silicon_not_native_intel(self):
        out=self.run_code(FACTS+'CPU=apple_silicon;HW_PROFILE=apple_silicon;MODEL=MacBookPro18,1;ARCH=x86_64;CAP_NATIVE=candidate;registry_resolve;echo "$RAM_BACKEND $GPU_BACKEND"');self.assertIn('perl_screen inventory',out)
    def test_unknown_environment_observation_only(self):
        out=self.run_code(FACTS+'ENVIRONMENT=unknown;registry_resolve;echo "$PROFILE_POLICY $RAM_BACKEND"');self.assertIn('observe unavailable',out)
    def test_manual_limit_cannot_elevate(self):
        out=self.run_code(FACTS+'MODEL_PROFILE=limited;registry_resolve;echo "$PROFILE_POLICY $RAM_BACKEND"');self.assertIn('observe unavailable',out)
    def test_other_os_selection_restricts(self):
        self.assertIn('observe',self.run_code(FACTS+'OS_PROFILE=other;registry_resolve;echo "$PROFILE_POLICY"'))
    def test_unknown_bash_disables_load(self):
        code=FACTS+'REGISTRY_CAPS=$(printf "%s" "$REGISTRY_CAPS" | grep -v "^bash_runtime");registry_resolve;echo "$PROFILE_POLICY $RAM_BACKEND"'
        self.assertIn('observe unavailable',self.run_code(code))
    def test_no_perl_still_allows_explicit_https_probe(self):
        code=FACTS+'CAP_PERL=no;CAP_SUPERVISOR=no;REGISTRY_CAPS=$(printf "%s" "$REGISTRY_CAPS" | grep -v "^perl");registry_resolve;registry_decision DOWNLOAD;echo "DOWNLOAD=$REGISTRY_DECISION";registry_decision NETWORK;echo "NETWORK=$REGISTRY_DECISION"'
        out=self.run_code(code);self.assertIn('DOWNLOAD=UNAVAILABLE',out);self.assertIn('NETWORK=READY',out)
    def test_disk_requires_64_bit_offsets(self):
        code=FACTS+'REGISTRY_CAPS=$(printf "%s" "$REGISTRY_CAPS" | grep -v "^perl64");registry_resolve;registry_decision STORAGE_READONLY;echo "$REGISTRY_DECISION $REGISTRY_REASON"'
        self.assertIn('UNAVAILABLE CAPABILITY_UNAVAILABLE_PERL64',self.run_code(code))
    def test_map_is_not_perl_quick(self):
        self.assertIn('UNAVAILABLE RAM_MAP_REQUIRES_NATIVE',self.run_code(FACTS+'registry_resolve;registry_decision RAM_MAP;echo "$REGISTRY_DECISION $REGISTRY_REASON"'))
    def test_raw_quarantine_result_preserved(self):
        p=sh(FACTS+'registry_resolve;registry_gate RAW');self.assertEqual(p.returncode,7);self.assertIn('RESULT=BLOCKED',p.stdout)
    def test_unavailable_stage_never_executes_body(self):
        td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup);d=Path(td.name)
        code=FACTS+f'SESSION={d};: > "$SESSION/summary.tsv";unset -f report_render;registry_resolve;work(){{ touch "{d}/BAD";passed BAD;}};run_step RAM_MAP work;cat "$SESSION/summary.tsv"'
        out=self.run_code(code);self.assertFalse((d/'BAD').exists());self.assertIn('INCONCLUSIVE',out)
    def test_same_model_does_not_guess_year(self):
        out=self.run_code(FACTS+'MODEL=MacBookPro11,2;registry_show');self.assertIn('year=2013',out);self.assertIn('year=2014',out);self.assertIn('DEVICE_YEAR=AMBIGUOUS',out)
    def test_new_model_does_not_guess_details(self):
        self.assertIn('DEVICE_REFERENCE=UNKNOWN',self.run_code(FACTS+'MODEL=Mac999,9;registry_show'))
    def test_version_comparison_numeric(self):
        for a,b,yes in [('8.10.1','8.4.0',True),('7.88.1','8.4.0',False),('8.4.0','8.4.0',True),('8.3.99','8.4.0',False),('garbage','8.4.0',False)]:
            with self.subTest(a=a):self.assertEqual(sh(f'rg_version_ge {shlex.quote(a)} {b}').returncode,0 if yes else 1)
    def test_shell_family_not_from_os_or_model(self):
        out=self.run_code('rg_shell_family 3.2.57;echo;rg_shell_family 5.2.37;echo;rg_shell_family 2.05;echo;rg_shell_family 6.0;echo')
        self.assertEqual(out.splitlines(),['bash32','bash4plus','unknown','unknown'])
    def test_real_local_capability_probes_no_network(self):
        out=self.run_code('profile_detect;printf "%s" "$REGISTRY_CAPS"')
        for cap in ['bash_runtime','bash_system','awk','tee','perl','perl64','sha256']:
            self.assertIn(cap+'\tVERIFIED\t',out)
        self.assertIn('CURL_STREAM_CAP_EXPECTED_EXTERNAL_CAP_RETAINED',out)
    def test_curl_version_success_options_failure_is_unusable(self):
        code='''
KERNEL=Linux;CAP_NATIVE=no;rg_probe(){ case "$*" in *'curl -q --version')printf 'curl 8.10.1\nProtocols: http https\n';;*'curl '*--help*)return 2;;*)pf_read "$@";;esac; }
registry_collect;echo "CURL=$CAP_CURL";printf '%s' "$REGISTRY_CAPS"
'''
        out=self.run_code(code);self.assertIn('CURL=no',out);self.assertIn('curl\tUNUSABLE',out)
    def test_missing_tool_cannot_reuse_optimistic_flag(self):
        out=self.run_code('KERNEL=Linux;CAP_CURL=yes;CAP_NATIVE=no;rg_path(){ return 1; };registry_collect;echo "$CAP_CURL $CAP_PERL $CAP_SHA"')
        self.assertIn('no no no',out)
    def test_failed_registry_is_not_legacy_fallback(self):
        p=self.tables();(p/'registry_tools.tsv').unlink()
        out=self.run_code(FACTS+f'ROOT={p};registry_collect;registry_resolve;echo "$REGISTRY_STATUS $PROFILE_POLICY $RAM_BACKEND"')
        self.assertIn('INVALID observe unavailable',out)
    def test_registry_reports_have_hashes_and_no_fake_health(self):
        td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup);d=Path(td.name)
        self.run_code(f'profile_detect;SESSION={d};registry_save')
        self.assertEqual(len((d/'registry-hashes.tsv').read_text().splitlines()),4)
        self.assertIn('REGISTRY_REVISION=',(d/'registry-selection.txt').read_text())
        self.assertNotIn('\tPASS\t',(d/'dispatch-plan.tsv').read_text())
    def test_standalone_profile_exits_observed(self):
        td=tempfile.TemporaryDirectory();self.addCleanup(td.cleanup)
        p=subprocess.run(['/bin/bash',str(ROOT/'run.sh'),'profile'],env=dict(os.environ,MACDIAG_REPORT_DIR=td.name),capture_output=True,text=True,timeout=20)
        self.assertEqual(p.returncode,5,p.stdout+p.stderr)
        s=next(Path(td.name).glob('macdiag-v2.*'))
        self.assertIn('State: **OBSERVED**',(s/'REPORT_RU_EN.md').read_text());self.assertTrue((s/'dispatch-plan.tsv').exists())
    def test_no_registry_eval_or_shell_templates(self):
        text=(ROOT/'registry.sh').read_text();self.assertNotIn('eval ',text);self.assertNotIn('source "$',text)
    def test_compiler_not_proven_by_version(self):
        out=self.run_code('KERNEL=Linux;CAP_NATIVE=candidate;CAP_CLANG=/mock/clang;registry_collect;printf "%s" "$REGISTRY_CAPS"')
        self.assertIn('compiler\tCANDIDATE',out);self.assertIn('BUILD_AND_MLOCK_NOT_PROBED',out)
    def test_raw_tool_paths_not_in_shared_exports(self):
        text=(ROOT/'recovery.sh').read_text().split('support_export(){',1)[1]
        self.assertNotIn('cp "$source/tool-capabilities.tsv"',text)
    def test_new_files_required_by_bootstrap(self):
        text=(BASE/'st.sh').read_text()
        for n in ['registry.sh','registry_devices.tsv','registry_profiles.tsv','registry_tools.tsv','registry_tests.tsv']:self.assertIn(n,text)
    def test_actual_tool_paths_can_contain_spaces_without_eval(self):
        d=self.tables();tool=d/'odd path';tool.write_text('#!/bin/sh\nprintf hello');tool.chmod(0o700)
        self.assertEqual(self.run_code(f'rg_probe 3 {shlex.quote(str(tool))}').strip(),'hello')
    def test_registry_syntax(self):self.assertEqual(subprocess.run(['/bin/bash','-n',str(ROOT/'registry.sh')]).returncode,0)
if __name__=='__main__':unittest.main()
