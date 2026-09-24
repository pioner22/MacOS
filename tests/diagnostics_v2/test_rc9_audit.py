"""Real small process/report regressions; Mac facts only are test doubles.

MACDIAG_TEST_BASH optionally selects a separately built developer Bash (not
an emulated BASH_VERSION). No disk devices or real hardware loads are used.
"""
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(os.environ.get('MACDIAG_SRC') or Path(__file__).resolve().parents[2]).resolve() / 'diagnostics_v2'
BASH = os.environ.get('MACDIAG_TEST_BASH', '/bin/bash')


def shell(code, **kwargs):
    return subprocess.run([BASH, '-c', '. ' + shlex.quote(str(ROOT / 'run.sh')) + '; ' + code],
                          capture_output=True, text=True, timeout=10, **kwargs)


def running(pid):
    p = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], text=True, capture_output=True)
    return bool(p.stdout.strip()) and not p.stdout.strip().startswith('Z')


class ProbeTreeTests(unittest.TestCase):
    def exercise(self, wait_parent=True, keep_pipe=True, ignore_term=False, cancel=None, function=False):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            worker = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)' if ignore_term else 'import time; time.sleep(30)'
            child = ('import os,subprocess,sys,time; from pathlib import Path; '
                     f'p=subprocess.Popen([sys.executable,"-c",{worker!r}]' +
                     ('); ' if keep_pipe else ',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); ') +
                     f'Path({str(d / "pids")!r}).write_text(str(os.getppid())+" "+str(os.getpid())+" "+str(p.pid)); '
                     'print("GenuineIntel",flush=True); ' + ('time.sleep(30)' if wait_parent else 'sys.exit(0)'))
            command = shlex.quote(sys.executable) + ' -c ' + shlex.quote(child)
            pre = '. ' + shlex.quote(str(ROOT / 'profile.sh')) + '; '
            if function:
                pre += 'probe_command(){ ' + command + '; }; '
                command = 'probe_command'
            pre += 'pf_read 1 ' + command
            p = subprocess.Popen([BASH, '-c', pre], text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, start_new_session=True)
            ids = []
            try:
                if cancel:
                    until = time.monotonic() + 3
                    while not (d / 'pids').exists() and time.monotonic() < until:
                        time.sleep(0.01)
                    ids = [int(x) for x in (d / 'pids').read_text().split()]
                    os.kill(ids[0], cancel)
                try:
                    out, err = p.communicate(timeout=6)
                except subprocess.TimeoutExpired:
                    self.fail('Probe exceeded deadline plus cleanup grace; a descendant kept its pipe open')
                ids = [int(x) for x in (d / 'pids').read_text().split()]
                self.assertEqual(out, '', out + err)
                self.assertEqual(p.returncode, 128 + cancel if cancel else (124 if wait_parent else 3), out + err)
                self.assertFalse(running(ids[-1]), 'Probe left a live descendant')
            finally:
                if not ids and (d / 'pids').exists():
                    ids = [int(x) for x in (d / 'pids').read_text().split()]
                for pid in reversed(ids):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                p.communicate(timeout=3)

    def test_timeout_cleans_descendant_holding_stdout(self):
        self.exercise()

    def test_timeout_kills_descendant_ignoring_term(self):
        self.exercise(ignore_term=True)

    def test_zero_parent_with_background_worker_is_not_success(self):
        self.exercise(wait_parent=False, keep_pipe=False)

    def test_shell_function_descendants_are_bounded(self):
        self.exercise(function=True)

    def test_term_cancels_probe_group(self):
        self.exercise(cancel=signal.SIGTERM)

    def test_hup_cancels_probe_group(self):
        self.exercise(cancel=signal.SIGHUP)

    def test_int_cancels_probe_group(self):
        self.exercise(cancel=signal.SIGINT)

    def test_log_failure_cannot_confirm_fact(self):
        # Existing directory makes the final log append fail, with stdout still valid.
        with tempfile.TemporaryDirectory() as td:
            p = shell('PF_LOG=' + shlex.quote(td) + '; pf_read 3 /bin/echo GenuineIntel')
            self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertEqual(p.stdout, '')

    def test_failed_final_log_write_cannot_confirm_fact(self):
        with tempfile.TemporaryDirectory() as td:
            p = shell('PF_LOG=' + shlex.quote(td + '/probes.log') +
                      '; printf(){ case "$1" in PROBE*)return 1;;*)builtin printf "$@";;esac; };'
                      'pf_read 3 /bin/echo GenuineIntel')
            self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertEqual(p.stdout, '')

    def test_unrelated_sibling_and_caller_trap_survive(self):
        p = shell(r'''trap 'echo CALLER_TERM' TERM; before=$(trap -p TERM);
sleep 20 >/dev/null 2>&1 & sibling=$!;
pf_read 1 /bin/sleep 20; rc=$?;
kill -0 "$sibling" || exit 98;
kill "$sibling";wait "$sibling" 2>/dev/null;
[ "$(trap -p TERM)" = "$before" ] || exit 99;exit "$rc"''')
        self.assertEqual(p.returncode, 124, p.stdout + p.stderr)
        self.assertNotIn('CALLER_TERM', p.stdout)


class ReportReadTests(unittest.TestCase):
    def exercise(self, fault, known_fail=False):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            state = 'FAIL' if known_fail else 'PASS'
            (d / 'summary.tsv').write_text(f'TOOLKIT\t{state}\tQA_RESULT\t{d}\n')
            (d / 'profile.txt').write_text('QA_PROFILE\n')
            (d / 'REPORT_RU_EN.md').write_text('previous RUNNING report')
            setup = ''
            if fault == 'missing_profile':
                (d / 'profile.txt').unlink()
            elif fault == 'profile_directory':
                (d / 'profile.txt').unlink()
                (d / 'profile.txt').mkdir()
            elif fault == 'missing_registry':
                (d / 'dispatch-plan.tsv').write_text('QA_PLAN\n')
                (d / 'tool-capabilities.tsv').write_text('QA_CAPS\n')
            elif fault == 'coverage_read':
                (d / 'coverage.tsv').write_text('QA_COVERAGE\n')
                setup = 'cat(){ case "$*" in *coverage.tsv*)return 1;;*)command cat "$@";;esac; };'
            elif fault == 'intermediate_write':
                setup = 'printf(){ case "$1" in *CLOCK_TRUST*)return 1;;*)builtin printf "$@";;esac; };'
            p = shell(f'SESSION={shlex.quote(td)};SESSION_FINAL_STATE=PASS;MODE=selftest;' + setup + 'session_exit 0')
            if fault == 'none':
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn('QA_PROFILE', (d / 'REPORT_RU_EN.md').read_text())
                return
            self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
            self.assertIn('FINAL_STATE=' + ('FAIL' if known_fail else 'INCONCLUSIVE'), p.stdout)
            self.assertIn('REPORT=UNAVAILABLE', p.stdout)
            self.assertFalse((d / 'REPORT_RU_EN.md').exists())
            self.assertTrue((d / 'REPORT_INCOMPLETE_RU_EN.md').exists())

    def test_missing_profile_never_yields_pass(self):
        self.exercise('missing_profile')

    def test_unreadable_profile_never_yields_pass(self):
        self.exercise('profile_directory')

    def test_missing_registry_selection_never_yields_pass(self):
        self.exercise('missing_registry')

    def test_coverage_read_failure_never_yields_pass(self):
        self.exercise('coverage_read')

    def test_intermediate_write_failure_never_yields_pass(self):
        self.exercise('intermediate_write')

    def test_report_read_failure_keeps_known_fault(self):
        self.exercise('missing_profile', known_fail=True)

    def test_complete_report_remains_successful(self):
        self.exercise('none')


class ProfilePersistenceTests(unittest.TestCase):
    def test_accepted_restriction_is_saved_before_menu_eof(self):
        from test_lifecycle_review import PRELUDE
        with tempfile.TemporaryDirectory() as td:
            (Path(td) / 'answers').write_text('15\n4\n0\n0\n')
            code = PRELUDE + '\n. ' + shlex.quote(str(ROOT / 'profile.sh'))
            # Restore only real profile_choose; retain controlled hardware inventory.
            start = PRELUDE.index('profile_detect(){')
            end = PRELUDE.index('\nqa_stage(){')
            code += '\n' + PRELUDE[start:end]
            code += '\nexec 9<' + shlex.quote(td + '/answers') + ';main menu;exit $?'
            p = shell(code, env=dict(os.environ, MACDIAG_REPORT_DIR=td, QA_DIR=td))
            self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
            s = next(Path(td).glob('macdiag-v2.*'))
            self.assertIn('POLICY=observe', (s / 'profile.txt').read_text())
            self.assertIn('POLICY=adaptive', (s / 'profile.initial.txt').read_text())
            self.assertIn('ram_backend\tunavailable', (s / 'environment.tsv').read_text())
            self.assertIn('POLICY=observe', (s / 'REPORT_RU_EN.md').read_text())


class ShellCompatibilityTests(unittest.TestCase):
    def test_runtime_files_parse_in_selected_real_shell(self):
        for source in [ROOT.parent / 'st.sh', *sorted(ROOT.glob('*.sh'))]:
            with self.subTest(file=source.name):
                p = subprocess.run([BASH, '-n', str(source)], capture_output=True, text=True)
                self.assertEqual(p.returncode, 0, p.stderr)

    def test_valid_readonly_disk_reaches_metadata_probe(self):
        with tempfile.TemporaryDirectory() as td:
            from test_readonly import XML
            xml = Path(td) / 'metadata.xml'
            xml.write_text(XML)
            p = shell('STEP_DIR=' + shlex.quote(td) + ';pf_read(){ cat ' + shlex.quote(str(xml)) + '; };'
                      'readonly_preflight disk2;rc=$?;[ "$rc" -ne 0 ] || printf "%s" "$RO_CONTRACT";exit "$rc"')
            self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            self.assertEqual(p.stdout, 'disk2\t1048576\t512')

    def test_invalid_disk_ids_never_reach_probe(self):
        for disk in ['disk00', 'disk2s1', 'disk99999', '/dev/disk2', 'disk2;id']:
            with self.subTest(disk=disk):
                p = shell('pf_read(){ echo UNEXPECTED_PROBE;return 3; };readonly_preflight ' + shlex.quote(disk))
                self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
                self.assertNotIn('UNEXPECTED_PROBE', p.stdout)


if __name__ == '__main__':
    unittest.main()
