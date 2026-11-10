import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError
from tui_vpn import cli, terminal_backend as backend


class TerminalBackendTests(unittest.TestCase):
    def compatible_host(self):
        patches = [mock.patch.object(backend.sys, 'platform', 'darwin'),
                   mock.patch.object(backend.sys, 'version_info', (3, 12, 16)),
                   mock.patch.object(backend.platform, 'machine', return_value='x86_64')]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_pinned_macos_runtime_uses_the_compatible_extension(self):
        self.compatible_host()
        native = ModuleType('compatible_curses')
        with mock.patch.dict(sys.modules), mock.patch.object(backend, 'compatibility_module', return_value=native):
            sys.modules.pop('curses', None)
            backend.prepare_terminal_backend()
            self.assertIs(sys.modules['_curses'], native)

    def test_other_platforms_architectures_and_python_versions_are_unchanged(self):
        self.compatible_host()
        variants = [('linux', 'x86_64', (3, 12, 16)),
                    ('darwin', 'arm64', (3, 12, 16)),
                    ('darwin', 'x86_64', (3, 8, 2)),
                    ('darwin', 'x86_64', (3, 12, 15))]
        for system, architecture, version in variants:
            with self.subTest(system=system, architecture=architecture, version=version), \
                    mock.patch.object(backend.sys, 'platform', system), \
                    mock.patch.object(backend.sys, 'version_info', version), \
                    mock.patch.object(backend.platform, 'machine', return_value=architecture), \
                    mock.patch.object(backend, 'compatibility_module') as load:
                backend.prepare_terminal_backend()
                load.assert_not_called()

    def test_missing_extension_fails_before_the_ui_starts(self):
        self.compatible_host()
        with mock.patch.dict(sys.modules), \
                mock.patch.object(backend, 'compatibility_module', side_effect=ImportError('fixture')):
            sys.modules.pop('curses', None)
            previous = sys.modules.get('_curses')
            with self.assertRaises(AppError):
                backend.prepare_terminal_backend()
            self.assertIs(sys.modules.get('_curses'), previous)

    def test_an_initialized_incompatible_ui_is_not_silently_rebound(self):
        self.compatible_host()
        with mock.patch.dict(sys.modules, {'curses': ModuleType('old_curses')}), \
                mock.patch.object(backend, 'compatibility_module') as load:
            with self.assertRaises(AppError):
                backend.prepare_terminal_backend()
            load.assert_not_called()

    def test_root_macos_ui_is_rejected_before_user_preferences_are_opened(self):
        with mock.patch.object(cli.sys, 'platform', 'darwin'), \
                mock.patch.object(cli.os, 'geteuid', return_value=0), \
                mock.patch('tui_vpn.ui.main') as ui:
            with self.assertRaisesRegex(AppError, 'без sudo'):
                cli.client(ROOT, SimpleNamespace(command='tui', demo=False))
            ui.assert_not_called()
