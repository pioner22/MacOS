"""Actual small processes: a timed-out probe must never confirm a Mac fact.

Python is only a developer-test helper. No Mac hardware or external network.
"""
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2] / 'diagnostics_v2'


class ProbeTimeoutTests(unittest.TestCase):
    def command(self, output='GenuineIntel', handler='exit_zero'):
        action = 'lambda *_: sys.exit(0)' if handler == 'exit_zero' else 'signal.SIG_IGN'
        code = ('import signal, sys, time; '
                f'signal.signal(signal.SIGTERM, {action}); '
                f'print({output!r}, flush=True); time.sleep(30)')
        return f'{shlex.quote(sys.executable)} -c {shlex.quote(code)}'

    def shell(self, code, timeout=10, env=None):
        return subprocess.run(
            ['/bin/bash', '-c', f'. {shlex.quote(str(ROOT / "run.sh"))}; ' + code],
            text=True, capture_output=True, timeout=timeout,
            env=dict(os.environ, **(env or {})))

    def test_term_handler_exit_zero_cannot_pass_probe(self):
        p = self.shell('pf_probe 1 ' + self.command())
        self.assertEqual(p.returncode, 124, p.stdout + p.stderr)

    def test_timed_out_stdout_is_not_an_observed_fact(self):
        p = self.shell('pf_read 1 ' + self.command())
        self.assertEqual(p.returncode, 124, p.stdout + p.stderr)
        self.assertEqual(p.stdout, '')

    def test_registry_probe_rejects_timed_out_capability(self):
        p = self.shell('rg_probe 1 ' + self.command('AWK_TSV_OK'))
        self.assertEqual(p.returncode, 124, p.stdout + p.stderr)
        self.assertEqual(p.stdout, '')

    def test_default_signal_exit_is_reported_as_timeout(self):
        p = self.shell('pf_read 1 /bin/sleep 30')
        self.assertEqual(p.returncode, 124, p.stdout + p.stderr)
        self.assertEqual(p.stdout, '')

    def test_ignored_term_is_killed_and_cannot_pass(self):
        p = self.shell('pf_read 1 ' + self.command(handler='ignore'))
        self.assertEqual(p.returncode, 124, p.stdout + p.stderr)
        self.assertEqual(p.stdout, '')

    def test_probe_log_distinguishes_timeout_from_child_exit_zero(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'probes.log'
            p = self.shell(f'PF_LOG={shlex.quote(str(log))}; pf_read 1 ' + self.command())
            self.assertEqual(p.returncode, 124, p.stdout + p.stderr)
            text = log.read_text()
            self.assertIn('rc=124 child_rc=0 timeout=1', text)

    def test_successful_fact_is_retained_without_timeout(self):
        p = self.shell("pf_read 3 /bin/bash -c 'printf GenuineIntel'")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(p.stdout, 'GenuineIntel\n')

    def test_ordinary_failure_code_is_retained_and_stdout_discarded(self):
        p = self.shell("pf_read 3 /bin/bash -c 'printf GenuineIntel; exit 7'")
        self.assertEqual(p.returncode, 7, p.stdout + p.stderr)
        self.assertEqual(p.stdout, '')

    def test_memory_budget_rejects_timed_out_vm_statistics(self):
        with tempfile.TemporaryDirectory() as d:
            tool = Path(d) / 'vm_stat'
            stats = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 4194304.'
            tool.write_text('#!/bin/bash\nexec ' + self.command(stats) + '\n')
            tool.chmod(0o700)
            p = self.shell('RAM_BYTES=68719476736; native_budget 49152',
                           env={'PATH': d + os.pathsep + os.environ['PATH']})
            self.assertEqual(p.returncode, 3, p.stdout + p.stderr)
            self.assertEqual(p.stdout, '')


if __name__ == '__main__':
    unittest.main()
