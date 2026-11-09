"""Real path/hash/locking tests; legacy network functions are injected test doubles."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'Resources/refresh_legacy_subscription.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

class BridgePolicyTests(unittest.TestCase):
    def scope(self, backend='xray', failure=None):
        refresh = mock.Mock(side_effect=(lambda auth, report: report.mark('SUBSCRIPTION', 'PASS', 'fixture')) if failure is None else failure)
        return {'CATALOG': '/fixture/catalog', 'ACTIVE': '/fixture/active', 'owned': mock.Mock(),
                'read_json': mock.Mock(side_effect=lambda path: {'auth':'fixture-secret'} if path.endswith('active') else {}),
                'backend_of': mock.Mock(return_value=backend), 'assert_routes':mock.Mock(), 'refresh':refresh}
    def test_socks_does_not_change_credentials_or_use_network(self):
        scope = self.scope('socks5')
        with mock.patch.object(b, 'command_lock', contextlib.nullcontext):
            self.assertEqual(b.refresh(scope), 'notApplicable')
        scope['refresh'].assert_not_called(); scope['assert_routes'].assert_not_called()
    def test_xray_requires_routes_then_auth_refresh(self):
        scope = self.scope()
        with mock.patch.object(b, 'command_lock', contextlib.nullcontext):
            self.assertEqual(b.refresh(scope), 'updated')
        scope['assert_routes'].assert_called_once()
        self.assertEqual(scope['refresh'].call_args.args[0], 'fixture-secret')
    def test_route_failure_prevents_refresh(self):
        scope = self.scope(); scope['assert_routes'].side_effect = ValueError()
        with mock.patch.object(b, 'command_lock', contextlib.nullcontext), self.assertRaises(ValueError):
            b.refresh(scope)
        scope['refresh'].assert_not_called()
    def test_silent_refresh_cannot_fake_success(self):
        scope = self.scope(); scope['refresh'].side_effect=None
        with mock.patch.object(b, 'command_lock', contextlib.nullcontext), self.assertRaises(b.BridgeError): b.refresh(scope)
    def test_lock_failure_prevents_network(self):
        scope = self.scope()
        with mock.patch.object(b, 'command_lock', side_effect=b.BridgeError('busy')), self.assertRaises(b.BridgeError): b.refresh(scope)
        scope['refresh'].assert_not_called()
    def test_linux_is_rejected(self):
        with mock.patch.object(b.sys,'platform','linux'), mock.patch.object(b,'load_runtime') as load, contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(b.main(),1)
        load.assert_not_called(); self.assertEqual(json.loads(out.getvalue())['code'],'MACOS_AUTHORIZATION_REQUIRED')
    def test_root_required(self):
        with mock.patch.object(b.sys,'platform','darwin'), mock.patch.object(b.os,'geteuid',return_value=501), mock.patch.object(b,'load_runtime') as load, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(b.main(),1)
        load.assert_not_called()
    def test_errors_never_echo_credentials(self):
        with mock.patch.object(b.sys,'platform','darwin'), mock.patch.object(b.os,'geteuid',return_value=0), mock.patch.object(b.os,'chdir'), mock.patch.object(b.os,'umask'), mock.patch.object(b,'load_runtime',side_effect=ValueError('https://private secret')), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(b.main(),1)
        self.assertNotIn('secret',out.getvalue()); self.assertNotIn('https://',out.getvalue())
    def test_no_public_update_command_or_tunnel_changes(self):
        source=(ROOT/'Resources/refresh_legacy_subscription.py').read_text()
        for prohibited in ("scope['stop'](","scope['connect'](","scope['setup'](","scope['main'](","subprocess.","--insecure"):
            self.assertNotIn(prohibited,source)

@unittest.skipUnless(os.geteuid()==0,'temporary root-owned file checks')
class BridgeFilesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.file=self.root/'file';self.file.write_bytes(b'fixture');self.file.chmod(0o600)
    def test_read_owned(self): self.assertEqual(b.read_owned(str(self.file),32),b'fixture')
    def test_bound(self):
        with self.assertRaises(b.BridgeError):b.read_owned(str(self.file),2)
    def test_link(self):
        p=self.root/'symlink';p.symlink_to(self.file)
        with self.assertRaises(OSError):b.read_owned(str(p),32)
    def test_hardlink(self):
        os.link(self.file,self.root/'hard')
        with self.assertRaises(b.BridgeError):b.read_owned(str(self.file),32)
    def test_group_writable(self):
        self.file.chmod(0o660)
        with self.assertRaises(b.BridgeError):b.read_owned(str(self.file),32)
    def test_user_owned(self):
        os.chown(self.file,65534,-1)
        with self.assertRaises(b.BridgeError):b.read_owned(str(self.file),32)
    def test_concurrent_command_lock(self):
        with mock.patch.object(b,'PRIVATE',str(self.root)):
            with b.command_lock():
                with self.assertRaises(b.BridgeError):
                    with b.command_lock():pass
            with b.command_lock():pass
    def test_lock_symlink(self):
        (self.root/'command.lock').symlink_to(self.file)
        with mock.patch.object(b,'PRIVATE',str(self.root)), self.assertRaises(OSError):
            with b.command_lock():pass

if __name__=='__main__':unittest.main()
