#!/usr/bin/env python3
"""Shared-PATH regressions. Local files/UIDs are real; no network or live VPN.

Run as root only in an isolated test environment to exercise ownership cases.
No test writes /usr/local or /Library; all filesystem paths are temporary.
"""
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vpn-runtime.py'
spec = importlib.util.spec_from_file_location('vpn_shared_paths', str(SOURCE))
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


@unittest.skipUnless(os.geteuid() == 0, 'real ownership tests require root in isolated environment')
class SharedPathTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='vpn-shared-path-'))
        self.root.chmod(0o755)
        self.addCleanup(shutil.rmtree, self.root)
        self.prefix = self.root / 'local'
        self.bindir = self.prefix / 'bin'
        self.bindir.mkdir(parents=True)
        self.prefix.chmod(0o755)
        self.bindir.chmod(0o755)
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.mask = os.umask(0o077)
        self.addCleanup(os.umask, self.mask)

    @staticmethod
    def snapshot(path):
        entry = path.lstat()
        return entry.st_uid, entry.st_gid, stat.S_IMODE(entry.st_mode), entry.st_ino

    def prepare(self):
        v.prepare_command_dir(str(self.prefix))

    def install_layout(self):
        library = self.root / 'Library'
        library.mkdir()
        library.chmod(0o755)
        base = library / 'BigSurVPN'
        for key, value in {
            'BASE': str(base), 'PRIVATE': str(base / 'private'),
            'CURRENT': str(base / 'current'),
            'COMMAND_LINK': str(self.bindir / 'vpn-bigsur'),
        }.items():
            self.stack.enter_context(mock.patch.object(v, key, value))
        v.prepare_dirs()
        # Only rebind the default location; execute the real directory check.
        prepare = v.prepare_command_dir
        self.stack.enter_context(mock.patch.object(v, 'prepare_command_dir',
                                                   side_effect=lambda: prepare(str(self.prefix))))
        return base

    def test_group_writable_path_reproduces_previous_predicate(self):
        self.bindir.chmod(0o775)
        self.assertTrue(self.bindir.lstat().st_mode & 0o022)
        self.assertFalse(self.bindir.lstat().st_mode & 0o002)
        self.prepare()
        self.assertEqual(stat.S_IMODE(self.bindir.stat().st_mode), 0o775)

    def test_both_group_writable_dirs_no_chmod_or_chown(self):
        self.prefix.chmod(0o2775)
        self.bindir.chmod(0o775)
        with mock.patch.object(v.os, 'chmod', side_effect=AssertionError('chmod')), \
             mock.patch.object(v.os, 'chown', side_effect=AssertionError('chown')):
            self.prepare()

    def test_missing_bin_in_shared_prefix_gets_0755(self):
        self.bindir.rmdir()
        self.prefix.chmod(0o775)
        self.prepare()
        self.assertEqual(stat.S_IMODE(self.bindir.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(self.prefix.stat().st_mode), 0o775)
        self.assertEqual(os.umask(0o077), 0o077)

    def test_regular_file_is_not_directory_with_specific_diagnostic(self):
        self.bindir.rmdir()
        self.bindir.write_text('do not change')
        before = self.snapshot(self.bindir)
        with self.assertRaises(v.VPNError) as caught:
            self.prepare()
        self.assertIn('type=not-directory', str(caught.exception))
        self.assertIn('uid=', str(caught.exception))
        self.assertEqual(self.snapshot(self.bindir), before)
        self.assertEqual(self.bindir.read_text(), 'do not change')

    def test_symlink_target_not_traversed_or_modified(self):
        self.bindir.rmdir()
        target = self.root / 'other'
        target.mkdir()
        target.chmod(0o775)
        self.bindir.symlink_to(target, target_is_directory=True)
        before = self.snapshot(target)
        with self.assertRaises(v.VPNError) as caught:
            self.prepare()
        self.assertIn('type=symlink', str(caught.exception))
        self.assertEqual(self.snapshot(target), before)
        self.assertEqual(list(target.iterdir()), [])

    def test_broken_symlink_rejected(self):
        self.bindir.rmdir()
        self.bindir.symlink_to(self.root / 'missing')
        with self.assertRaises(v.VPNError) as caught:
            self.prepare()
        self.assertIn('type=symlink', str(caught.exception))
        self.assertFalse((self.root / 'missing').exists())

    def test_fifo_rejected_without_opening(self):
        self.bindir.rmdir()
        os.mkfifo(self.bindir)
        with self.assertRaises(v.VPNError) as caught:
            self.prepare()
        self.assertIn('type=not-directory', str(caught.exception))

    def test_nontraversable_user_dir_unchanged_and_diagnosed(self):
        os.chown(self.bindir, 65534, 65534)
        self.bindir.chmod(0o770)
        before = self.snapshot(self.bindir)
        with self.assertRaises(v.VPNError) as caught:
            self.prepare()
        self.assertIn('mode=0770', str(caught.exception))
        self.assertEqual(self.snapshot(self.bindir), before)

    def test_real_preflight_accepts_shared_path_and_owned_shortcut(self):
        base = self.install_layout()
        self.bindir.chmod(0o775)
        wrapper = base / 'vpn-bigsur.sh'
        v.atomic_bytes(str(wrapper), v.b(v.CLI), 0o755)
        (self.bindir / 'vpn-bigsur').symlink_to(wrapper)
        self.assertEqual(v.check_activation_paths(), str(self.bindir / 'vpn-bigsur'))

    def test_preflight_rejects_foreign_shortcut_without_overwrite(self):
        self.install_layout()
        self.bindir.chmod(0o775)
        path = self.bindir / 'vpn-bigsur'
        path.write_text('foreign file')
        with self.assertRaises(v.VPNError):
            v.check_activation_paths()
        self.assertEqual(path.read_text(), 'foreign file')

    def test_preflight_does_not_trust_wrong_symlink_target(self):
        self.install_layout()
        self.bindir.chmod(0o775)
        path = self.bindir / 'vpn-bigsur'
        path.symlink_to('/not-the-managed-wrapper')
        with self.assertRaises(v.VPNError):
            v.check_activation_paths()
        self.assertEqual(os.readlink(path), '/not-the-managed-wrapper')

    def test_group_write_in_privileged_base_still_rejected(self):
        base = self.install_layout()
        base.chmod(0o775)
        with self.assertRaises(v.VPNError):
            v.prepare_dirs()
        self.assertEqual(stat.S_IMODE(base.stat().st_mode), 0o775)

    def test_group_write_in_private_directory_still_rejected(self):
        base = self.install_layout()
        (base / 'private').chmod(0o770)
        with self.assertRaises(v.VPNError):
            v.prepare_dirs()

    def test_group_write_in_privileged_wrapper_still_rejected(self):
        base = self.install_layout()
        v.atomic_bytes(str(base / 'vpn-bigsur.sh'), v.b(v.CLI), 0o775)
        with self.assertRaises(v.VPNError):
            v.check_activation_paths()

    def test_setup_reaches_menu_with_0775_then_cancel_changes_no_network(self):
        self.install_layout()
        self.prefix.chmod(0o775)
        self.bindir.chmod(0o775)
        profile = self.root / 'profile.json'
        profile.write_text(json.dumps({
            'schema': 'bigsur-vpn-profile-v2', 'subscription': 'https://example.com/sub',
            'bootstrap': ['trojan://fixture@example.com:443?security=tls&type=tcp'],
            'socks5': {'server': '192.0.2.100', 'port': 1080,
                       'username': 'fixture', 'password': 'fixture-only'},
        }))
        choose = v.choose_backend
        report = mock.Mock()
        report.data = {}
        with mock.patch.object(v, 'choose_backend', side_effect=lambda state:
                               choose(state, io.StringIO('0\n'))) as menu, \
             mock.patch.object(v, 'run', side_effect=AssertionError('external process')), \
             mock.patch.object(v, 'info', side_effect=AssertionError('launchd')), \
             mock.patch.object(v, 'http', side_effect=AssertionError('network')), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(KeyboardInterrupt):
                v.setup(str(profile), report)
            menu.assert_called_once()
        self.assertIn('SOCKS5', output.getvalue())
        self.assertEqual(stat.S_IMODE(self.bindir.stat().st_mode), 0o775)

    def test_unprivileged_shortcut_runs_and_private_secret_stays_unreadable(self):
        base = self.install_layout()
        self.prefix.chmod(0o775)
        self.bindir.chmod(0o2775)
        v.atomic_bytes(str(base / 'vpn-bigsur.sh'), v.b(v.CLI), 0o755)
        path = self.bindir / 'vpn-bigsur'
        path.symlink_to(base / 'vpn-bigsur.sh')
        secret = base / 'private' / 'config.json'
        v.atomic_json(str(secret), {'password': 'fixture-only'})
        nobody = pwd.getpwnam('nobody')
        def drop():
            os.setgroups([])
            os.setgid(nobody.pw_gid)
            os.setuid(nobody.pw_uid)
        for option in ('--help', '--version'):
            result = subprocess.run([str(path), option], capture_output=True,
                                    preexec_fn=drop, cwd='/', timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(v.VERSION.encode(), result.stdout)
        result = subprocess.run(['/bin/cat', str(secret)], capture_output=True,
                                preexec_fn=drop, cwd='/', timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'')


def add_mode_case(mode, uid, location):
    def check(self):
        path = self.prefix if location == 'prefix' else self.bindir
        os.chown(path, uid, 65534 if uid else 0)
        path.chmod(mode)
        before = self.snapshot(path)
        self.prepare()
        self.prepare()
        self.assertEqual(self.snapshot(path), before)
    setattr(SharedPathTests, 'test_accept_%04o_uid%d_%s' % (mode, uid, location), check)

for _mode in (0o775, 0o2775, 0o1775):
    for _uid in (0, 65534):
        for _location in ('prefix', 'bin'):
            add_mode_case(_mode, _uid, _location)


def add_rejection_case(mode, location):
    def check(self):
        path = self.prefix if location == 'prefix' else self.bindir
        path.chmod(mode)
        before = self.snapshot(path)
        with self.assertRaises(v.VPNError) as caught:
            self.prepare()
        self.assertIn('mode=%04o' % mode, str(caught.exception))
        self.assertIn('type=directory', str(caught.exception))
        self.assertIn('gid=', str(caught.exception))
        self.assertEqual(self.snapshot(path), before)
    setattr(SharedPathTests, 'test_reject_world_write_%04o_%s' % (mode, location), check)

for _mode in (0o777, 0o2777, 0o757, 0o1777):
    for _location in ('prefix', 'bin'):
        add_rejection_case(_mode, _location)


class DeliveryTests(unittest.TestCase):
    def test_pinned_runtime_matches_local_bytes(self):
        text = (ROOT / 'vpn.sh').read_text()
        expected = re.search(r'local runtime_sha=([0-9a-f]{64})', text).group(1)
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), expected)

    def test_bootstrap_runtime_versions_match(self):
        text = (ROOT / 'vpn.sh').read_text()
        self.assertEqual(set(re.findall(r'BigSurVPN (\d+\.\d+\.\d+)', text)), {v.VERSION})
        self.assertEqual(v.VERSION, '2.1.3')

    def test_shell_syntax(self):
        result = subprocess.run(['/bin/bash', '-n', str(ROOT / 'vpn.sh')], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_elevation_never_runs_shared_shortcut(self):
        self.assertIn('exec /usr/bin/sudo /bin/bash /Library/BigSurVPN/vpn-bigsur.sh', v.CLI)
        self.assertNotIn('/usr/local', v.CLI)
        tree = ast.parse(SOURCE.read_text())
        for name in ('serve', 'write_plist', 'probe'):
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertNotIn('/usr/local', ast.get_source_segment(SOURCE.read_text(), node))

if __name__ == '__main__':
    unittest.main(verbosity=2)
