import io
import os
import plistlib
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT))
import build_packages
from tui_vpn.common import AppError, Paths, verify_source
from tui_vpn.common import read_json, digest
from tui_vpn.catalog import Catalog
from tui_vpn.installation import install, maintain, unit, switch
from tui_vpn.ui import clipped, human, spark
from test_data import URI
from tui_vpn.profiles import parse_uri


class Host:
    def __init__(self):
        self.starts, self.stops, self.fail = 0, 0, False
        self.commands = []

    def command(self, args, allowed=(0,)):
        self.commands.append((args, allowed))

    def start(self):
        self.starts += 1
        return True

    def stop(self):
        self.stops += 1

    def verify(self):
        if self.fail:
            raise AppError('synthetic service start failed')


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / 'source'
        shutil.copytree(ROOT, self.source, ignore=shutil.ignore_patterns('dist', '__pycache__', '_build'))
        build_packages.manifest(self.source)
        self.core = self.root / 'fixture-core'
        self.core.write_bytes(b'synthetic core; never executed')
        self.paths = Paths(system='linux', base=self.root / 'installation')
        self.host = Host()
        self.check = mock.patch('tui_vpn.installation.Engine.check')
        self.check.start()
        self.addCleanup(self.check.stop)
        self.version = mock.patch('tui_vpn.installation.subprocess.run', return_value=SimpleNamespace(
            returncode=0, stdout=b'sing-box version 1.14.0', stderr=b''))
        self.version.start()
        self.addCleanup(self.version.stop)

    def do_install(self):
        install(self.source, None, self.core, self.paths, self.host)

    def upgrade_source(self):
        (self.source / 'VERSION').write_text('0.1.1\n')
        build_packages.manifest(self.source)

    def test_first_install_is_independent_and_off(self):
        self.do_install()
        self.assertEqual(self.paths.current.resolve().parent, self.paths.releases)
        self.assertTrue(self.paths.launcher.is_file())
        self.assertTrue(self.paths.shortcut.is_file())
        self.assertFalse(Catalog(self.paths).state['enabled'])
        verify_source(self.paths.current / 'app')

    def test_private_installer_umask_keeps_program_accessible_and_data_private(self):
        previous = os.umask(0o077)
        try:
            self.do_install()
        finally:
            os.umask(previous)
        release = self.paths.current.resolve()
        public = [self.paths.base, self.paths.releases, release,
                  self.paths.launcher.parent, self.paths.shortcut.parent]
        public += [p for p in release.rglob('*') if p.is_dir()]
        for directory in public:
            self.assertEqual(directory.stat().st_mode & 0o777, 0o755, str(directory))
        self.assertEqual(self.paths.private.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.paths.private / 'catalog.sqlite3').stat().st_mode & 0o777, 0o600)

    def test_release_switch_resolves_both_sides_of_a_parent_alias(self):
        real = self.root / 'real' / 'nested'
        target = real / 'releases' / 'fixture'
        target.mkdir(parents=True)
        alias = self.root / 'alias'
        alias.symlink_to(real, target_is_directory=True)
        switch(alias / 'current', target)
        self.assertEqual((alias / 'current').resolve(), target.resolve())
        self.assertTrue((alias / 'current').is_dir())

    def test_upgrade_and_rollback_preserve_current_profiles_and_manual_off(self):
        self.do_install()
        old = self.paths.current.resolve()
        catalog = Catalog(self.paths)
        catalog.commit(catalog.candidate([parse_uri(URI)], 'private fixture'))
        catalog.enable(False)
        before = Catalog(self.paths).data
        self.upgrade_source()
        self.do_install()
        self.assertNotEqual(self.paths.current.resolve(), old)
        self.assertEqual(Catalog(self.paths).data, before)
        maintain('rollback', self.paths, self.host)
        self.assertEqual(self.paths.current.resolve(), old)
        self.assertEqual(Catalog(self.paths).data, before)
        self.assertFalse(Catalog(self.paths).state['enabled'])

    def test_upgrade_does_not_silently_disable_requested_on(self):
        self.do_install()
        Catalog(self.paths).enable(True)
        self.upgrade_source()
        self.do_install()
        self.assertTrue(Catalog(self.paths).state['enabled'])

    def test_failed_start_restores_exact_old_link_and_system_files(self):
        self.do_install()
        old = self.paths.current.resolve()
        old_launcher = self.paths.launcher.read_bytes()
        self.upgrade_source()
        self.host.fail = True
        with self.assertRaises(AppError):
            self.do_install()
        self.assertEqual(self.paths.current.resolve(), old)
        self.assertEqual(self.paths.launcher.read_bytes(), old_launcher)

    def test_foreign_launcher_blocks_before_stopping_the_working_service(self):
        self.do_install()
        before = self.host.stops
        self.paths.launcher.write_text('foreign data')
        self.upgrade_source()
        with self.assertRaises(AppError):
            self.do_install()
        self.assertEqual(self.host.stops, before)
        self.assertEqual(self.paths.launcher.read_text(), 'foreign data')

    def test_uninstall_preserves_data_and_reinstall_stays_off(self):
        self.do_install()
        catalog = Catalog(self.paths)
        catalog.commit(catalog.candidate([parse_uri(URI)], 'preserve fixture'))
        catalog.enable(True)
        before = Catalog(self.paths).data
        maintain('uninstall', self.paths, self.host)
        self.assertFalse(self.paths.launcher.exists())
        self.assertFalse(self.paths.unit.exists())
        self.assertEqual(Catalog(self.paths).data, before)
        self.do_install()
        self.assertFalse(Catalog(self.paths).state['enabled'])

    def test_user_profiles_are_not_in_the_release(self):
        self.do_install()
        catalog = Catalog(self.paths)
        catalog.commit(catalog.candidate([parse_uri(URI)], 'private fixture'))
        for path in (self.paths.current / 'app').rglob('*'):
            if path.is_file():
                self.assertNotIn(b'synthetic-password', path.read_bytes(), str(path))

    def test_macos_job_is_persistent_but_does_not_encode_profiles(self):
        value = plistlib.loads(unit(Paths(system='darwin', base=self.root / 'mac')))
        self.assertTrue(value['KeepAlive'])
        self.assertTrue(value['RunAtLoad'])
        self.assertEqual(value['ProgramArguments'][-1], '_daemon')


class FormatTests(unittest.TestCase):
    def test_deb_control_and_payload_are_native_and_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            manifest, sha = read_json(ROOT / 'manifest.json'), digest(ROOT / 'manifest.json')
            path = build_packages.build_deb(ROOT, output, manifest, sha)
            raw = path.read_bytes()
            self.assertTrue(raw.startswith(b'!<arch>\n'))
            members = {}
            offset = 8
            while offset < len(raw):
                header = raw[offset:offset + 60]
                length = int(header[48:58])
                name = header[:16].decode().strip().rstrip('/')
                members[name] = raw[offset + 60:offset + 60 + length]
                offset += 60 + length + length % 2
            self.assertEqual(members['debian-binary'], b'2.0\n')
            with tarfile.open(fileobj=io.BytesIO(members['control.tar.gz'])) as archive:
                control = archive.extractfile('control').read()
                self.assertIn(b'Architecture: all', control)
                self.assertIn(b'nftables', control)
                self.assertEqual(archive.getmember('postinst').mode, 0o755)
            with tarfile.open(fileobj=io.BytesIO(members['data.tar.gz'])) as archive:
                self.assertIn('usr/lib/tui-vpn/package-source/src/entry.py', archive.getnames())
                self.assertFalse(any('private/' in n or '..' in Path(n).parts for n in archive.getnames()))

    def test_display_handles_small_width_and_removes_terminal_escape(self):
        self.assertEqual(clipped('abc', 0), '')
        self.assertNotIn('\x1b', clipped('a\x1b[31mb', 80))
        self.assertEqual(human(None), '—')
        self.assertIn('/с', human(1024, True))
        self.assertLessEqual(len(spark([0, 10, 1], 2)), 2)


if __name__ == '__main__':
    unittest.main()
