"""Portable decision/rollback tests; networking and macOS operations are simulated."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
R = load('connection_repair', ROOT / 'connection-repair.py')
M = load('connection_menu', ROOT / 'connection-menu.py')


class NetworkFailure(Exception): pass

class Report:
    def __init__(self, operation='test'):
        self.data = {'operation': operation}
        self.steps = []
    def mark(self, name, status, detail): self.steps.append((name, status, detail))
    def warnings(self): return any(s[1] in ('WARN', 'SKIP') for s in self.steps)
    def end(self, value): self.data['overall'] = value


class Runtime:
    VPNError = NetworkFailure
    CATALOG, ACTIVE, CONFIG = 'catalog', 'active', 'config'
    def __init__(self, backend='socks5', running=True, protocol='vless'):
        self.store = {
            self.CATALOG: {'backend': backend, 'subscription': 'https://example.invalid/private-sub',
                          'bootstrap': [{'id': 'vless-node', 'outbound': {'type': protocol}}],
                          'nodes': [], 'socks5': {'outbound': {'type': 'socks', 'password': 'PRIVATE-PASSWORD'}}},
            self.ACTIVE: {'backend': backend},
            self.CONFIG: {'outbounds': [{'type': 'socks' if backend == 'socks5' else protocol}]}}
        self.running = running
        self.protocol = protocol
        self.events, self.messages = [], []
        self.fail, self.cancel = None, None
        self.stop_fail_at = None
        self.stop_count = 0
        self.lie = False
        self.report = None
    def Report(self, operation):
        self.report = Report(operation); return self.report
    def run(self, args, *a, **k):
        return 0, (b'11.7.10' if 'sw_vers' in args[0] else b'x86_64'), b''
    def say(self, text): self.messages.append(text)
    def backend_of(self, value): return value.get('backend', 'xray')
    def backend_name(self, value): return {'socks5': 'SOCKS5', 'xray': 'Xray'}[value]
    def candidates(self, catalog):
        self.events.append('candidates:' + catalog['backend'])
        if catalog['backend'] == 'socks5': return [catalog['socks5']]
        return catalog.get('nodes', []) + catalog.get('bootstrap', [])
    def check_install(self):
        self.events.append('check-install')
        if self.fail == 'integrity': raise NetworkFailure('damaged')
    def info(self): return 'job' if self.running else ''
    def alive(self): return self.running
    def stop(self):
        self.events.append('stop'); self.stop_count += 1
        if self.stop_count == self.stop_fail_at: raise NetworkFailure('cleanup failed')
        self.running = False
    def assert_no_other_vpn(self): self.events.append('no-other')
    def baseline(self, report):
        self.events.append('baseline')
        return {'ip': '192.0.2.1'}
    def atomic_json(self, path, value):
        self.events.append('write:' + path)
        self.store[path] = copy.deepcopy(value)
    def read_json(self, path): return copy.deepcopy(self.store[path])
    def connect(self, base, report):
        backend = self.store[self.CATALOG]['backend']
        self.events.append('connect:' + backend)
        if self.cancel == backend: raise KeyboardInterrupt()
        if self.fail == backend or self.fail == 'all': raise NetworkFailure('connect failed PRIVATE-PASSWORD')
        self.running = True
        self.store[self.ACTIVE] = {'backend': backend}
        self.store[self.CONFIG] = {'outbounds': [{'type': 'socks' if self.lie or backend == 'socks5' else self.protocol}]}
        if backend == 'xray': self.store[self.CATALOG]['updated_at'] = 'fresh'
    def verify(self, base, report):
        backend = self.store[self.CATALOG]['backend']
        self.events.append('verify:' + backend)
        if self.fail == 'verify':
            self.fail = None
            raise NetworkFailure('TLS verification failed')
        return '198.51.100.2'
    def record_verification(self, ip): self.events.append('verified:' + ip)


class MenuTests(unittest.TestCase):
    def setUp(self): self.v = Runtime()
    def choice(self, text): return M.choose(self.v, self.v.read_json('catalog'), io.StringIO(text))
    def test_xray_selected_from_socks(self): self.assertEqual(self.choice('1\n'), 'xray')
    def test_socks_selected_from_xray(self):
        self.v.store['catalog']['backend'] = 'xray'
        self.assertEqual(self.choice('2\n'), 'socks5')
    def test_choice_does_not_change_connection(self):
        before = copy.deepcopy(self.v.store)
        self.choice('1\n')
        self.assertEqual(self.v.events, []); self.assertEqual(before, self.v.store)
    def test_cancel_has_no_side_effects(self):
        with self.assertRaises(KeyboardInterrupt): self.choice('0\n')
        self.assertTrue(self.v.running); self.assertEqual(self.v.events, [])
    def test_eof_has_no_default_socks(self):
        with self.assertRaises(R.RepairError): self.choice('')
        self.assertEqual(self.v.events, [])
    def test_three_invalid_choices_abort(self):
        with self.assertRaises(R.RepairError): self.choice('\n9\ninvalid\n1\n')
    def test_invalid_then_valid(self): self.assertEqual(self.choice('garbage\n1\n'), 'xray')
    def test_long_choice_aborts(self):
        with self.assertRaises(R.RepairError): self.choice('1' * 100)
    def test_read_is_from_tty_not_pipe(self):
        with patch.object(M.io, 'open', return_value=io.StringIO('1\n')) as opened:
            self.assertEqual(M.choose(self.v, self.v.read_json('catalog')), 'xray')
        opened.assert_called_once_with('/dev/tty', 'r', encoding='utf-8')
    def test_missing_tty_does_not_disconnect(self):
        with patch.object(M.io, 'open', side_effect=OSError('no tty')), self.assertRaises(R.RepairError):
            M.choose(self.v, self.v.read_json('catalog'))
        self.assertEqual(self.v.events, [])
    def test_dispatch_xray_never_invokes_socks_repair(self):
        with patch.object(M, 'switch_xray', return_value=0) as xray, patch.object(R, 'repair') as socks:
            self.assertEqual(M.dispatch(self.v, {}, {}, 'xray', Report()), 0)
            xray.assert_called_once(); socks.assert_not_called()
    def test_dispatch_socks_keeps_recovery(self):
        with patch.object(M, 'switch_xray') as xray, patch.object(R, 'repair', return_value=2) as socks:
            self.assertEqual(M.dispatch(self.v, {}, {}, 'socks5', Report()), 2)
            socks.assert_called_once(); xray.assert_not_called()


class XrayTests(unittest.TestCase):
    def setUp(self):
        self.v = Runtime()
        self.original = self.v.read_json('catalog')
        self.report = Report()
        self.profile = {'private': 'unchanged'}
    def run_switch(self): return M.switch_xray(self.v, self.original, self.profile, self.report)
    def test_socks_to_xray(self):
        self.assertEqual(self.run_switch(), 0)
        self.assertEqual(self.v.store['catalog']['backend'], 'xray')
        self.assertEqual(self.v.store['active']['backend'], 'xray')
        self.assertEqual(self.report.data['connected_protocol'], 'vless')
        self.assertEqual(self.report.data['overall'], 'CONNECTED')
    def test_trojan_also_valid(self):
        self.v.protocol = 'trojan'
        self.original['bootstrap'][0]['outbound']['type'] = 'trojan'
        self.assertEqual(self.run_switch(), 0)
        self.assertEqual(self.report.data['connected_protocol'], 'trojan')
    def test_disconnect_before_connect(self):
        self.run_switch()
        self.assertLess(self.v.events.index('stop'), self.v.events.index('connect:xray'))
    def test_preserve_fresh_subscription_after_connect(self):
        self.run_switch(); self.assertEqual(self.v.store['catalog']['updated_at'], 'fresh')
    def test_preserve_socks_and_input_snapshot(self):
        snapshot = copy.deepcopy(self.original)
        self.run_switch()
        self.assertEqual(self.v.store['catalog']['socks5'], snapshot['socks5'])
        self.assertEqual(self.original, snapshot)
        self.assertEqual(self.profile, {'private': 'unchanged'})
    def test_off_to_xray(self):
        self.v.running = False
        self.assertEqual(self.run_switch(), 0)
        self.assertEqual(self.v.stop_count, 0)
    def test_empty_xray_list_does_not_stop(self):
        self.original['bootstrap'] = []
        with self.assertRaises(R.RepairError): self.run_switch()
        self.assertNotIn('stop', self.v.events)
    def test_socks_node_not_accepted_as_xray(self):
        self.original['bootstrap'][0]['outbound']['type'] = 'socks'
        with self.assertRaises(R.RepairError): self.run_switch()
        self.assertNotIn('stop', self.v.events)
    def test_integrity_checked_before_stop(self):
        self.v.fail = 'integrity'
        with self.assertRaises(NetworkFailure): self.run_switch()
        self.assertNotIn('stop', self.v.events)
    def test_error_restores_previous_without_claiming_xray_success(self):
        self.v.fail = 'xray'
        with self.assertRaises(NetworkFailure): self.run_switch()
        self.assertEqual(self.v.store['catalog'], self.original)
        self.assertEqual(self.v.store['active']['backend'], 'socks5')
        self.assertTrue(self.v.running)
        self.assertNotIn('overall', self.report.data)
        self.assertTrue(any('НЕ успешное' in step[2] for step in self.report.steps))
    def test_cancel_does_not_restart_previous(self):
        self.v.cancel = 'xray'
        with self.assertRaises(KeyboardInterrupt): self.run_switch()
        self.assertFalse(self.v.running)
        self.assertNotIn('connect:socks5', self.v.events)
        self.assertEqual(self.v.store['catalog'], self.original)
    def test_off_failure_does_not_start_old_connection(self):
        self.v.running = False; self.v.fail = 'xray'
        with self.assertRaises(NetworkFailure): self.run_switch()
        self.assertNotIn('connect:socks5', self.v.events)
    def test_verify_failure_triggers_restore(self):
        self.v.fail = 'verify'
        with self.assertRaises(NetworkFailure): self.run_switch()
        self.assertEqual(self.v.store['active']['backend'], 'socks5')
    def test_actual_socks_config_never_claims_xray_success(self):
        self.v.lie = True
        with self.assertRaises(R.RepairError): self.run_switch()
        self.assertNotIn('overall', self.report.data)
    def test_cleanup_failure_blocks_restart(self):
        self.v.fail = 'xray'; self.v.stop_fail_at = 2
        with self.assertRaises(NetworkFailure): self.run_switch()
        self.assertNotIn('connect:socks5', self.v.events)
        self.assertTrue(any('ВОССТАНОВЛЕНИЕ НЕ ПОДТВЕРЖДЕНО' in m for m in self.v.messages))
    def test_failed_restore_stays_failure(self):
        self.v.fail = 'all'
        with self.assertRaises(NetworkFailure): self.run_switch()
        text = '\n'.join(self.v.messages)
        self.assertIn('ВОССТАНОВЛЕНИЕ НЕ ПОДТВЕРЖДЕНО', text)
        self.assertNotIn('PRIVATE-PASSWORD', text)
    def test_success_warnings_return_two(self):
        self.report.mark('TEST', 'WARN', 'fixture')
        self.assertEqual(self.run_switch(), 2)
        self.assertEqual(self.report.data['overall'], 'CONNECTED_WITH_WARNINGS')


class MainTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); (self.root / 'private').mkdir(mode=0o700)
        self.v = Runtime(); self.v.CATALOG = str(self.root / 'private/profiles.json')
        self.v.store[self.v.CATALOG] = self.v.store.pop('catalog')
        for name, data in [('profiles.json', self.v.store[self.v.CATALOG]), ('provider-profile.json', {})]:
            p = self.root / 'private' / name; p.write_text(json.dumps(data)); p.chmod(0o600)
        self.patches = [patch.object(R, 'BASE', str(self.root)), patch.object(R, 'load_runtime', return_value=self.v),
                        patch.object(M.sys, 'platform', 'darwin'), patch.object(M.os, 'geteuid', return_value=0)]
        old_isdir = M.os.path.isdir
        self.patches.append(patch.object(M.os.path, 'isdir', side_effect=lambda p: True if p == '/System/Volumes/Data' else old_isdir(p)))
        # The filesystem permission tests require root, as do the original delivery tests.
        for p in self.patches: p.start(); self.addCleanup(p.stop)
    def test_cancel_in_main_does_not_write_catalog_or_stop(self):
        original = Path(self.v.CATALOG).read_bytes()
        with patch.object(M, 'choose', side_effect=KeyboardInterrupt), self.assertRaises(KeyboardInterrupt): M.main()
        self.assertEqual(original, Path(self.v.CATALOG).read_bytes()); self.assertEqual(self.v.events, [])
    def test_main_returns_error_even_when_previous_connection_restored(self):
        self.v.fail = 'xray'
        with patch.object(M, 'choose', return_value='xray'):
            self.assertEqual(M.main(), 1)
        self.assertEqual(self.v.report.data['overall'], 'FAILED')
        self.assertEqual(self.v.report.data['requested_backend'], 'xray')
        self.assertNotIn('PRIVATE-PASSWORD', '\n'.join(str(x) for x in self.v.report.steps))
    def test_main_socks_dispatch(self):
        with patch.object(M, 'choose', return_value='socks5'), patch.object(R, 'repair', return_value=2) as method:
            self.assertEqual(M.main(), 2); method.assert_called_once()
    def test_existing_supervisor_blocks_switch(self):
        (self.root / 'service').mkdir()
        with patch.object(M, 'choose') as choose, self.assertRaises(R.RepairError): M.main()
        choose.assert_not_called(); self.assertEqual(self.v.events, [])


if __name__ == '__main__': unittest.main()
