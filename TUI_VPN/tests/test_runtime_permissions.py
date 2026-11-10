import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError
from tui_vpn import runtime_permissions as permissions


class RuntimePermissionTests(unittest.TestCase):
    def test_installer_public_defaults_do_not_inherit_the_private_extraction_mask(self):
        with tempfile.TemporaryDirectory() as folder:
            previous = os.umask(0o077)
            try:
                with mock.patch.object(permissions.sys, 'platform', 'darwin'), \
                        mock.patch.object(permissions.os, 'geteuid', return_value=0), \
                        mock.patch.object(permissions, 'installer_python_path', return_value=Path(folder)), \
                        mock.patch.object(permissions, 'normalize_public_runtime'):
                    permissions.prepare_installer_runtime(['_install', '--python-tree', folder])
                public = Path(folder) / 'public-program-file'
                public.write_text('fixture')
                self.assertEqual(stat.S_IMODE(public.stat().st_mode), 0o644)
            finally:
                os.umask(previous)

    def test_private_extraction_becomes_public_without_exposing_other_data(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve()
            runtime = base / 'runtime'
            (runtime / 'bin').mkdir(parents=True)
            (runtime / 'lib').mkdir()
            program, library, private = runtime / 'bin/python3.12', runtime / 'lib/module.py', base / 'secret'
            for path in (program, library, private):
                path.write_bytes(b'fixture; never executed')
            program.chmod(0o700)
            library.chmod(0o600)
            private.chmod(0o600)
            (runtime / 'bin/python3').symlink_to('python3.12')
            for path in (runtime, runtime / 'bin', runtime / 'lib'):
                path.chmod(0o700)
            permissions.normalize_public_runtime(runtime)
            for path in (runtime, runtime / 'bin', runtime / 'lib', program):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE(library.stat().st_mode), 0o644)
            self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o600)
            if sys.platform == 'darwin':
                self.assertEqual(stat.S_IMODE((runtime / 'bin/python3').lstat().st_mode), 0o755)

    def test_an_escaping_link_blocks_before_any_permissions_change(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve()
            runtime = base / 'runtime'
            runtime.mkdir(mode=0o700)
            secret = base / 'secret'
            secret.write_text('fixture')
            secret.chmod(0o600)
            (runtime / 'link').symlink_to(secret)
            with self.assertRaises(AppError):
                permissions.normalize_public_runtime(runtime)
            self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(secret.stat().st_mode), 0o600)

    def test_a_foreign_installation_path_cannot_change_permissions_or_umask(self):
        with mock.patch.object(permissions.sys, 'platform', 'darwin'), \
                mock.patch.object(permissions.os, 'geteuid', return_value=0), \
                mock.patch.object(permissions.os, 'umask') as umask, \
                mock.patch.object(permissions, 'normalize_public_runtime') as normalize:
            with self.assertRaises(AppError):
                permissions.prepare_installer_runtime(['_install', '--python-tree', '/etc'])
            normalize.assert_not_called()
            umask.assert_not_called()

    def test_normal_service_and_client_commands_never_change_umask(self):
        for command in ('tui', '_daemon', '_fetch', 'on', 'off', '_maintain'):
            with mock.patch.object(permissions.os, 'umask') as umask:
                permissions.prepare_installer_runtime([command])
                umask.assert_not_called()

    def test_nonroot_installer_is_rejected_before_path_access(self):
        with mock.patch.object(permissions.sys, 'platform', 'darwin'), \
                mock.patch.object(permissions.os, 'geteuid', return_value=501):
            with self.assertRaises(AppError):
                permissions.prepare_installer_runtime(['_install', '--python-tree', '/etc'])
