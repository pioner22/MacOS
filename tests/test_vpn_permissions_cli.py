#!/usr/bin/env python3
"""Offline regressions for BigSurVPN 2.0.3; no VPN/network/service is started.
Run: python3 -m unittest discover -s tests -p 'test_vpn_permissions_cli.py' -v
Root-only cases use temporary directories and unprivileged subprocesses.
"""
import ast
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vpn-runtime.py'
spec = importlib.util.spec_from_file_location('vpn_permissions_runtime', str(SOURCE))
vpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn)


class CommandTests(unittest.TestCase):
    def test_default_command(self):
        self.assertEqual(vpn.parse_command([]), ('status', []))

    def test_internal_serve_only_exact(self):
        self.assertEqual(vpn.parse_command(['_serve']), ('_serve', []))
        for argv in (['--_serve'], ['_serve', 'extra']):
            with self.assertRaises(vpn.UsageError):
                vpn.parse_command(argv)

    def test_preserve_argument_boundaries(self):
        self.assertEqual(vpn.parse_command(['--setup', '/tmp/a b.json']),
                         ('setup', ['/tmp/a b.json']))

    def test_help_and_version_do_not_touch_state(self):
        for arg in ('help', '--help', '-h', 'version', '--version', '-V'):
            with mock.patch.object(sys, 'argv', ['runtime', arg]), \
                 mock.patch.object(vpn, 'prepare_dirs', side_effect=AssertionError('dirs')), \
                 mock.patch.object(vpn, 'run', side_effect=AssertionError('subprocess')), \
                 mock.patch.object(vpn.os, 'geteuid', side_effect=AssertionError('euid')), \
                 mock.patch.object(vpn.os, 'umask', side_effect=AssertionError('umask')), \
                 mock.patch.object(vpn.signal, 'signal', side_effect=AssertionError('signal')), \
                 contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(vpn.main(), 0)
                self.assertIn(vpn.VERSION, out.getvalue())

    def test_invalid_command_precedes_platform_check(self):
        with mock.patch.object(sys, 'argv', ['runtime', '--unknown']), \
             mock.patch.object(vpn, 'prepare_dirs', side_effect=AssertionError('dirs')):
            with self.assertRaises(vpn.UsageError):
                vpn.main()

    def test_runtime_usage_exit_code(self):
        p = subprocess.run([sys.executable, str(SOURCE), '--unknown'], capture_output=True)
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)

    def test_runtime_help_subprocess(self):
        p = subprocess.run([sys.executable, str(SOURCE), '--help'], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn(b'2.0.3', p.stdout)

    def test_shell_syntax(self):
        p = subprocess.run(['/bin/bash', '-n'], input=vpn.CLI.encode(), capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn('@HELP@', vpn.CLI)
        self.assertNotIn('@VERSION@', vpn.CLI)

    def test_shell_argument_forwarding_as_root(self):
        if os.geteuid() != 0:
            self.skipTest('root branch of wrapper')
        marker = 'exec /usr/bin/python -E -s -B /Library/BigSurVPN/current/vpn-runtime.py'
        text = vpn.CLI.replace(marker, "printf '<%s>\n'")
        for args, expected in (([], '<status>\n'), (['--status'], '<status>\n'),
                               (['setup', '/tmp/a b.json'], '<setup>\n</tmp/a b.json>\n'),
                               (['--select', '2'], '<select>\n<2>\n')):
            p = subprocess.run(['/bin/bash', '-c', text, 'test'] + args, capture_output=True)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(p.stdout.decode(), expected)

    def test_shell_preserves_empty_argument(self):
        p = subprocess.run(['/bin/bash', '-c', vpn.CLI, 'test', ''], capture_output=True)
        self.assertEqual(p.returncode, 2)

    def test_shell_rejects_internal_entry(self):
        p = subprocess.run(['/bin/bash', '-c', vpn.CLI, 'test', '_serve'], capture_output=True)
        self.assertEqual(p.returncode, 2)

    def test_setup_preflights_before_any_network_or_stop(self):
        with mock.patch.object(vpn, 'read_json', return_value={}), \
             mock.patch.object(vpn, 'validate_profile'), \
             mock.patch.object(vpn, 'check_activation_paths', side_effect=vpn.VPNError('unsafe')), \
             mock.patch.object(vpn, 'stop', side_effect=AssertionError('stop')), \
             mock.patch.object(vpn, 'info', side_effect=AssertionError('launchd')), \
             mock.patch.object(vpn, 'stage_install', side_effect=AssertionError('download')):
            with self.assertRaises(vpn.VPNError):
                vpn.setup('profile.json', None)


def add_command_case(command):
    def case(self):
        args = ['2'] * vpn.COMMAND_ARITIES[command]
        for name in (command, '--' + command):
            self.assertEqual(vpn.parse_command([name] + args), (command, args))
        with self.assertRaises(vpn.UsageError):
            vpn.parse_command([command] + args + ['extra'])
        if args:
            with self.assertRaises(vpn.UsageError):
                vpn.parse_command([command])
    setattr(CommandTests, 'test_parse_' + command, case)
for _command in vpn.COMMAND_ARITIES:
    add_command_case(_command)


@unittest.skipUnless(os.geteuid() == 0, 'real uid/mode regressions require root in an isolated test environment')
class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='vpn-permissions-'))
        os.chmod(self.temp, 0o755)
        self.library = self.temp / 'Library'
        self.library.mkdir(mode=0o755)
        os.chmod(self.library, 0o755)
        self.base = self.library / 'BigSurVPN'
        self.private = self.base / 'private'
        self.patches = [mock.patch.object(vpn, 'BASE', str(self.base)),
                        mock.patch.object(vpn, 'PRIVATE', str(self.private))]
        for p in self.patches:
            p.start()
        self.mask = os.umask(0o077)
        try:
            self.nobody = pwd.getpwnam('nobody')
        except KeyError:
            self.nobody = None

    def tearDown(self):
        os.umask(self.mask)
        for p in reversed(self.patches):
            p.stop()
        shutil.rmtree(self.temp)

    def mode(self, path):
        return stat.S_IMODE(os.lstat(path).st_mode)

    def make_old(self):
        self.base.mkdir(mode=0o755)
        self.private.mkdir(mode=0o700)
        (self.base / 'releases').mkdir(mode=0o755)

    def as_nobody(self, command):
        if self.nobody is None:
            self.skipTest('nobody account missing')
        uid, gid = self.nobody.pw_uid, self.nobody.pw_gid
        def drop():
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)
        return subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              preexec_fn=drop, cwd='/', env={'PATH':'/usr/bin:/bin', 'LC_ALL':'C'})

    def test_regression_reproduction_then_repair(self):
        self.make_old()
        wrapper = self.base / 'vpn-bigsur.sh'
        wrapper.write_text(vpn.CLI)
        wrapper.chmod(0o755)
        self.assertEqual(self.mode(self.base), 0o700)
        p = self.as_nobody(['/bin/bash', str(wrapper), '--help'])
        self.assertNotEqual(p.returncode, 0)
        vpn.prepare_dirs()
        p = self.as_nobody([str(wrapper), '--help'])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn(b'2.0.3', p.stdout)

    def test_idempotent_and_private_bytes_unchanged(self):
        self.make_old()
        secret = self.private / 'config.json'
        secret.write_bytes(b'{"secret":"not-public"}\n')
        before = hashlib.sha256(secret.read_bytes()).hexdigest()
        vpn.prepare_dirs()
        vpn.prepare_dirs()
        self.assertEqual(hashlib.sha256(secret.read_bytes()).hexdigest(), before)
        self.assertEqual(self.mode(secret), 0o600)
        self.assertEqual(self.mode(self.private), 0o700)
        p = self.as_nobody(['/bin/cat', str(secret)])
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(p.stdout, b'')

    def test_world_readable_private_rejected_before_opening_parent(self):
        self.make_old()
        self.private.chmod(0o755)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertEqual(self.mode(self.base), 0o700)

    def test_private_file_hardlinks_rejected(self):
        self.make_old()
        f = self.private / 'config.json'
        f.write_text('{}')
        os.link(str(f), str(self.private / 'alias'))
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertEqual(self.mode(self.base), 0o700)

    def test_private_file_insecure_mode_rejected(self):
        self.make_old()
        f = self.private / 'config.json'
        f.write_text('{}')
        f.chmod(0o644)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertEqual(self.mode(self.base), 0o700)

    def test_private_file_symlink_rejected(self):
        self.make_old()
        target = self.temp / 'unchanged'
        target.write_text('secret')
        target.chmod(0o600)
        os.symlink(str(target), str(self.private / 'config.json'))
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertEqual(self.mode(target), 0o600)
        self.assertEqual(self.mode(self.base), 0o700)

    def test_foreign_owner_rejected(self):
        self.make_old()
        os.chown(str(self.base), 65534, -1)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertEqual(self.mode(self.base), 0o700)

    def test_writable_parent_rejected(self):
        self.library.chmod(0o777)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertFalse(self.base.exists())

    def test_shared_directories_created_under_umask(self):
        prefix = self.temp / 'local'
        vpn.prepare_command_dir(str(prefix))
        self.assertEqual(self.mode(prefix), 0o755)
        self.assertEqual(self.mode(prefix / 'bin'), 0o755)

    def test_shared_directories_old_0700_repaired(self):
        prefix = self.temp / 'local'
        (prefix / 'bin').mkdir(parents=True)
        vpn.prepare_command_dir(str(prefix))
        self.assertEqual(self.mode(prefix), 0o755)
        self.assertEqual(self.mode(prefix / 'bin'), 0o755)

    def test_existing_shared_0711_not_changed(self):
        prefix = self.temp / 'local'
        (prefix / 'bin').mkdir(parents=True)
        prefix.chmod(0o711)
        (prefix / 'bin').chmod(0o711)
        vpn.prepare_command_dir(str(prefix))
        self.assertEqual(self.mode(prefix), 0o711)
        self.assertEqual(self.mode(prefix / 'bin'), 0o711)

    def test_user_owned_shared_dir_not_chowned(self):
        prefix = self.temp / 'local'
        prefix.mkdir()
        os.chown(str(prefix), 65534, -1)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_command_dir(str(prefix))
        self.assertEqual(prefix.stat().st_uid, 65534)
        self.assertEqual(self.mode(prefix), 0o700)

    def test_shared_symlink_rejected_without_chmod_target(self):
        target = self.temp / 'other'
        target.mkdir()
        prefix = self.temp / 'local'
        prefix.symlink_to(target, target_is_directory=True)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_command_dir(str(prefix))
        self.assertEqual(self.mode(target), 0o700)

    def test_shared_nonstandard_inaccessible_mode_rejected(self):
        prefix = self.temp / 'local'
        prefix.mkdir()
        prefix.chmod(0o750)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_command_dir(str(prefix))
        self.assertEqual(self.mode(prefix), 0o750)

    def test_unprivileged_help_version_and_errors_never_call_sudo(self):
        vpn.prepare_dirs()
        path = self.base / 'vpn-bigsur.sh'
        # The marker makes an accidental sudo call observable, not interactive.
        script = vpn.CLI.replace('/usr/bin/sudo', '/definitely-not-called-sudo')
        path.write_text(script)
        path.chmod(0o755)
        for name in ('help', '--help', '-h', 'version', '--version', '-V'):
            p = self.as_nobody([str(path), name])
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertIn(b'2.0.3', p.stdout)
        for args in (['--unknown'], ['status', 'extra'], ['--help', 'extra'],
                     ['select'], [''], ['_serve']):
            p = self.as_nobody([str(path)] + args)
            self.assertEqual(p.returncode, 2, p.stderr)
            self.assertNotIn(b'definitely-not-called-sudo', p.stderr)

    def test_unprivileged_management_requires_sudo(self):
        vpn.prepare_dirs()
        path = self.base / 'vpn-bigsur.sh'
        path.write_text(vpn.CLI.replace('/usr/bin/sudo', '/definitely-required-sudo'))
        path.chmod(0o755)
        for args in ([], ['status'], ['--status'], ['--on'], ['--off']):
            p = self.as_nobody([str(path)] + args)
            self.assertEqual(p.returncode, 127, p.stderr)
            self.assertIn(b'definitely-required-sudo', p.stderr)

    def test_safe_private_atomic_file_mode(self):
        vpn.prepare_dirs()
        f = self.private / 'secret.json'
        vpn.atomic_json(str(f), {'token': 'private'})
        self.assertEqual(self.mode(f), 0o600)
        public = self.base / 'vpn-bigsur.sh'
        vpn.atomic_bytes(str(public), vpn.CLI.encode(), 0o755)
        self.assertEqual(self.mode(public), 0o755)


def mask_case(mask):
    def case(self):
        os.umask(mask)
        vpn.prepare_dirs()
        self.assertEqual(self.mode(self.base), 0o755)
        self.assertEqual(self.mode(self.base / 'releases'), 0o755)
        self.assertEqual(self.mode(self.private), 0o700)
        self.assertEqual(os.umask(mask), mask)  # prepare_dirs never relaxes umask
    setattr(PermissionTests, 'test_umask_%03o' % mask, case)
for _mask in (0o077, 0o022, 0o027, 0o777, 0o007):
    mask_case(_mask)


def symlink_case(name):
    def case(self):
        self.make_old()
        path = self.base if name == 'base' else self.base / name
        shutil.rmtree(path)
        target = self.temp / 'other'
        target.mkdir()
        path.symlink_to(target, target_is_directory=True)
        with self.assertRaises(vpn.VPNError):
            vpn.prepare_dirs()
        self.assertEqual(self.mode(target), 0o700)
    setattr(PermissionTests, 'test_symlink_' + name, case)
for _name in ('base', 'private', 'releases'):
    symlink_case(_name)

if __name__ == '__main__':
    unittest.main(verbosity=2)
