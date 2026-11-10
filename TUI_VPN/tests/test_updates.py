import datetime
import hashlib
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError
from tui_vpn import updates


class UpdateTests(unittest.TestCase):
    def metadata(self, version=None):
        if version is None:
            parts = [int(p) for p in (ROOT / 'VERSION').read_text().strip().split('.')]
            parts[-1] += 1
            version = '.'.join(str(p) for p in parts)
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        return {'schema': 'tui-vpn.release.v1', 'version': version, 'published_at': now - 60,
            'expires_at': now + 3600, 'artifacts': [{'platform': sys.platform, 'name': ('TUI_VPN-' + version + '-macos-intel.pkg') if sys.platform == 'darwin' else ('tui-vpn_' + version + '_all.deb'),
            'sha256': hashlib.sha256(b'package').hexdigest(), 'bytes': 7}]}

    def test_metadata_is_bound_to_an_exact_github_commit(self):
        responses = [json.dumps({'sha': 'a' * 40}).encode(), json.dumps(self.metadata()).encode()]
        with mock.patch('tui_vpn.updates.fetch_worker', side_effect=responses) as fetch:
            result = updates.check_update(ROOT)
        self.assertIn('/' + 'a' * 40 + '/', result['url'])
        self.assertEqual(fetch.call_count, 2)

    def test_expired_update_and_path_traversal_are_rejected(self):
        for problem in ('expired', 'path'):
            metadata = self.metadata()
            if problem == 'expired':
                metadata['expires_at'] = 1
            else:
                metadata['artifacts'][0]['name'] = '../../escape.pkg'
            with mock.patch('tui_vpn.updates.fetch_worker', side_effect=[
                    json.dumps({'sha': 'a' * 40}).encode(), json.dumps(metadata).encode()]):
                with self.assertRaises(AppError):
                    updates.check_update(ROOT)

    def test_automatic_update_never_downgrades(self):
        with mock.patch('tui_vpn.updates.fetch_worker', side_effect=[
                json.dumps({'sha': 'a' * 40}).encode(), json.dumps(self.metadata('0.0.9')).encode()]):
            self.assertIsNone(updates.check_update(ROOT))

    def test_modified_package_is_not_opened_by_a_privileged_installer(self):
        item = dict(self.metadata()['artifacts'][0], version='0.1.1', url='https://example.org/fake')
        with mock.patch('tui_vpn.updates.check_update', return_value=item), \
                mock.patch('builtins.input', return_value='yes'), \
                mock.patch('tui_vpn.updates.fetch_worker', return_value=b'changed'), \
                mock.patch('tui_vpn.updates.subprocess.run') as launch:
            with self.assertRaisesRegex(AppError, 'Контрольная сумма'):
                updates.interactive_update()
        launch.assert_not_called()

    def test_canceled_native_install_is_not_reported_as_a_successful_update(self):
        import tempfile
        from types import SimpleNamespace
        item = dict(self.metadata()['artifacts'][0], version='0.1.1', url='https://example.org/fake')
        with tempfile.TemporaryDirectory() as folder, \
                mock.patch('tui_vpn.updates.check_update', return_value=item), \
                mock.patch('builtins.input', return_value='yes'), \
                mock.patch('tui_vpn.updates.fetch_worker', return_value=b'package'), \
                mock.patch('tui_vpn.updates.Paths', return_value=SimpleNamespace(current=Path(folder))), \
                mock.patch('tui_vpn.updates.subprocess.run', return_value=SimpleNamespace(returncode=0)):
            with self.assertRaisesRegex(AppError, 'Установка не подтверждена'):
                updates.interactive_update()


if __name__ == '__main__':
    unittest.main()
