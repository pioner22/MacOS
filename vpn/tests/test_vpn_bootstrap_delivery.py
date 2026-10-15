#!/usr/bin/env python3
"""Offline delivery regressions. No live VPN, network or macOS mutation.

The source file must be the exact Git blob referenced by the bootstrap.
Existing permission tests separately exercise real user-owned directories.
"""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOOT = (ROOT / 'vpn.sh').read_text(encoding='utf-8')
SOURCE = ROOT / 'vpn-runtime.py'
SPEC = importlib.util.spec_from_file_location('vpn_delivery', SOURCE)
VPN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VPN)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def field(name):
    match = re.search(r'^  local ' + name + r'=([0-9a-f]+)$', BOOT, re.M)
    if not match:
        raise AssertionError('Missing immutable bootstrap field: ' + name)
    return match.group(1)


def runner_source():
    match = re.search(r"^  runner='(.*?)\n'\n", BOOT, re.M | re.S)
    if not match:
        raise AssertionError('Privileged verification runner not found')
    return match.group(1)


class DeliveryTests(unittest.TestCase):
    def test_01_exact_runtime_hash_not_a_version_label(self):
        self.assertEqual(field('runtime_sha'), sha(SOURCE.read_bytes()),
                         'Bootstrap rejects its own pinned runtime: wrong SHA-256')

    def test_02_refs_are_immutable_commits(self):
        for name in ('runtime_ref', 'profile_ref'):
            self.assertRegex(field(name), r'^[0-9a-f]{40}$')
        for name in ('runtime_sha', 'profile_sha'):
            self.assertRegex(field(name), r'^[0-9a-f]{64}$')

    def test_03_downloads_verified_before_privilege_elevation(self):
        for name, filename in (('runtime', 'vpn-runtime.py'), ('profile', 'vpn-profile.json')):
            instruction = ('  fetch_checked "https://raw.githubusercontent.com/pioner22/MacOS/'
                           '$%s_ref/%s" "$work/%s" "$%s_sha"' %
                           (name, filename, filename, name))
            self.assertEqual(BOOT.count(instruction), 1)
            self.assertLess(BOOT.index(instruction), BOOT.index('  runner='))
        self.assertIn('/usr/bin/shasum -a 256 -c -', BOOT)

    def test_04_exec_uses_the_verified_bytes(self):
        code = runner_source()
        self.assertIn('payload = stream.read(2097153)', code)
        self.assertIn('hashlib.sha256(payload).hexdigest() != expected', code)
        self.assertIn('exec(compile(verified[0][1], script, "exec"), scope)', code)
        self.assertLess(code.index('verified.append'), code.index('exec(compile'))

    def test_05_bootstrap_bash_syntax(self):
        p = subprocess.run(['/bin/bash', '-n', str(ROOT / 'vpn.sh')], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_06_missing_final_invocation_does_not_install(self):
        marker = '\nbigsur_vpn_bootstrap "$@"'
        self.assertTrue(BOOT.rstrip().endswith(marker.strip()))
        definitions = BOOT.rsplit(marker, 1)[0] + '\n'
        p = subprocess.run(['/bin/bash'], input=definitions.encode(), capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, b'')
        self.assertEqual(p.stderr, b'')

    def test_07_runtime_version_help_still_executes(self):
        p = subprocess.run([sys.executable, '-B', str(SOURCE), '--version'], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.decode().strip(), 'BigSurVPN ' + VPN.VERSION)

    def test_08_socks_choice_does_not_need_stdin_pipe(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(VPN.choose_backend({'socks5': True}, io.StringIO('2\n')), 'socks5')

    def test_09_xray_choice_preserved(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(VPN.choose_backend({'socks5': True}, io.StringIO('1\n')), 'xray')

    def test_10_cancel_choice_preserved(self):
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(KeyboardInterrupt):
            VPN.choose_backend({'socks5': True}, io.StringIO('0\n'))


@unittest.skipUnless(os.geteuid() == 0, 'isolated root subprocess checks')
class PrivilegedDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vpn-delivery-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.good_script = b"print('VERIFIED_TEST_RUNTIME')\n"
        self.good_profile = b'{"fixture":true}\n'
        self.script = self.root / 'vpn-runtime.py'
        self.profile = self.root / 'vpn-profile.json'
        self.script.write_bytes(self.good_script)
        self.profile.write_bytes(self.good_profile)
        # Only the macOS temp base is redirected into the test's isolated tree.
        code = runner_source()
        old = 'dir="/private/var/tmp"'
        self.assertEqual(code.count(old), 1)
        self.runner = code.replace(old, 'dir=' + repr(str(self.root)))

    def run_fixture(self, script_hash=None, profile_hash=None):
        return subprocess.run([sys.executable, '-B', '-c', self.runner,
            str(self.script), script_hash or sha(self.good_script),
            str(self.profile), profile_hash or sha(self.good_profile)],
            capture_output=True, timeout=10)

    def assert_rejected(self, p):
        self.assertNotEqual(p.returncode, 0)
        self.assertNotIn(b'VERIFIED_TEST_RUNTIME', p.stdout)
        self.assertIn(b'SHA-256 verification failed', p.stderr)
        self.assertFalse(list(self.root.glob('bigsur-vpn-root-*')))

    def test_11_verified_payload_runs_once_and_cleans_up(self):
        p = self.run_fixture()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, b'VERIFIED_TEST_RUNTIME\n')
        self.assertFalse(list(self.root.glob('bigsur-vpn-root-*')))

    def test_12_wrong_runtime_hash_stops_before_execution(self):
        self.assert_rejected(self.run_fixture(script_hash='0' * 64))

    def test_13_wrong_profile_hash_stops_before_execution(self):
        self.assert_rejected(self.run_fixture(profile_hash='0' * 64))

    def test_14_runtime_changed_after_initial_check_is_rejected(self):
        self.script.write_bytes(self.good_script + b'# changed\n')
        self.assert_rejected(self.run_fixture())

    def test_15_profile_changed_after_initial_check_is_rejected(self):
        self.profile.write_bytes(self.good_profile + b' ')
        self.assert_rejected(self.run_fixture())

    def test_16_oversized_runtime_even_with_matching_hash_is_rejected(self):
        oversized = b'#' * 2097153
        self.script.write_bytes(oversized)
        self.assert_rejected(self.run_fixture(script_hash=sha(oversized)))

    def test_17_interrupted_download_is_rejected(self):
        self.script.write_bytes(self.good_script[:10])
        self.assert_rejected(self.run_fixture())

    def test_18_runtime_failure_still_cleans_temp_tree(self):
        failure = b'import sys\nsys.exit(7)\n'
        self.script.write_bytes(failure)
        p = self.run_fixture(script_hash=sha(failure))
        self.assertEqual(p.returncode, 7)
        self.assertFalse(list(self.root.glob('bigsur-vpn-root-*')))

    def test_19_no_nonroot_execution(self):
        def drop():
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
        p = subprocess.run([sys.executable, '-B', '-c', self.runner],
                           preexec_fn=drop, capture_output=True, cwd='/', timeout=10)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn(b'Administrator privileges are required.', p.stderr)
        self.assertNotIn(b'VERIFIED_TEST_RUNTIME', p.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
