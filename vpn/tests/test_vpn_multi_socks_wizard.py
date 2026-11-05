#!/usr/bin/env python3
"""Offline 2.1.4 regressions; real private files, simulated network/launchd."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vpn_multi_runtime', str(ROOT / 'vpn-runtime.py'))
vpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn)


def preset():
    return {'schema': 'bigsur-vpn-profile-v2', 'subscription': 'https://example.com/sub',
            'bootstrap': ['trojan://fixture@example.com:443?security=tls&type=tcp'],
            'socks5': {'server': '192.0.2.1', 'port': 45004, 'username': 'fixture-user', 'password': 'fixture-secret'},
            'socks5_alternates': ['192.0.2.2']}


class AddressTests(unittest.TestCase):
    def setUp(self):
        self.raw = preset()
        self.state = vpn.validate_profile(self.raw)
        self.state['backend'] = 'socks5'

    def test_two_addresses_share_only_supplied_credentials(self):
        nodes = vpn.candidates(self.state)
        self.assertEqual([n['outbound']['server'] for n in nodes], ['192.0.2.1', '192.0.2.2'])
        for n in nodes:
            self.assertEqual(n['outbound']['server_port'], 45004)
            self.assertEqual(n['outbound']['username'], 'fixture-user')
            self.assertEqual(n['outbound']['password'], 'fixture-secret')

    def test_endpoint_ids_differ(self):
        self.assertNotEqual(*[n['id'] for n in vpn.candidates(self.state)])

    def test_input_is_not_modified(self):
        self.assertEqual(self.raw, preset())

    def test_legacy_preset_without_alternates(self):
        del self.raw['socks5_alternates']
        s = vpn.validate_profile(self.raw); s['backend'] = 'socks5'
        self.assertEqual(len(vpn.candidates(s)), 1)

    def test_legacy_installed_catalog_without_nodes(self):
        del self.state['socks5_nodes']
        self.assertEqual(vpn.candidates(self.state), [self.state['socks5']])

    def test_duplicates_not_probed_twice(self):
        self.raw['socks5_alternates'] = ['192.0.2.1', '192.0.2.2', '192.0.2.2']
        s = vpn.validate_profile(self.raw); s['backend'] = 'socks5'
        self.assertEqual(len(vpn.candidates(s)), 2)

    def test_empty_alternates_allowed(self):
        self.raw['socks5_alternates'] = []
        self.assertEqual(len(vpn.validate_profile(self.raw)['socks5_nodes']), 1)

    def test_bad_alternate_values_rejected_without_echoing_secrets(self):
        for bad in ('999.1.1.1', 'example.com', '192.0.2.1\n', '::1', 1, None, {'password': 'secret'}):
            with self.subTest(bad=bad):
                self.raw['socks5_alternates'] = [bad]
                with self.assertRaises(vpn.VPNError) as caught: vpn.validate_profile(self.raw)
                self.assertNotIn('fixture-secret', str(caught.exception))

    def test_not_a_list_rejected(self):
        for bad in (None, '192.0.2.2', {}, 1):
            self.raw['socks5_alternates'] = bad
            with self.assertRaises(vpn.VPNError): vpn.validate_profile(self.raw)

    def test_too_many_addresses_rejected(self):
        self.raw['socks5_alternates'] = ['192.0.2.2'] * 8
        with self.assertRaises(vpn.VPNError): vpn.validate_profile(self.raw)

    def test_eight_total_allowed(self):
        self.raw['socks5_alternates'] = ['192.0.2.%s' % n for n in range(2, 9)]
        self.assertEqual(len(vpn.validate_profile(self.raw)['socks5_nodes']), 8)

    def test_no_primary_rejected(self):
        del self.raw['socks5']
        with self.assertRaises(vpn.VPNError): vpn.validate_profile(self.raw)

    def test_preferred_address_is_first_but_not_exclusive(self):
        self.state['preferred_socks5'] = self.state['socks5_nodes'][1]['id']
        self.assertEqual([n['outbound']['server'] for n in vpn.candidates(self.state)], ['192.0.2.2', '192.0.2.1'])

    def test_unknown_preference_keeps_all(self):
        self.state['preferred_socks5'] = 'removed'
        self.assertEqual(len(vpn.candidates(self.state)), 2)

    def test_corrupt_nodes_rejected(self):
        for bad in ([], {}, [None], [{'outbound': {}}], [self.state['socks5']] * 9):
            self.state['socks5_nodes'] = bad
            with self.assertRaises(vpn.VPNError): vpn.candidates(self.state)

    def test_stored_type_and_credentials_revalidated(self):
        for field, value in (('type', 'direct'), ('version', '4'), ('network', 'udp'), ('server_port', 0), ('password', '')):
            s = copy.deepcopy(self.state); s['socks5_nodes'][0]['outbound'][field] = value
            with self.assertRaises(vpn.VPNError): vpn.candidates(s)

    def test_xray_does_not_select_socks(self):
        self.state['backend'] = 'xray'
        self.assertEqual([n['outbound']['type'] for n in vpn.candidates(self.state)], ['trojan'])

    def test_labels_do_not_reveal_credentials(self):
        for n in vpn.candidates(self.state):
            label = vpn.node_label(n)
            self.assertIn(n['outbound']['server'], label)
            self.assertNotIn('fixture-user', label); self.assertNotIn('fixture-secret', label)

    def test_dns_uses_proxy_and_other_udp_rejected_for_every_address(self):
        for n in vpn.candidates(self.state):
            cfg = vpn.make_config(n, 'local-auth', True)
            self.assertEqual(cfg['dns']['servers'][0]['detour'], 'proxy')
            self.assertIn({'network': ['udp', 'icmp'], 'action': 'reject'}, cfg['route']['rules'])
            self.assertEqual([x['type'] for x in cfg['outbounds']], ['socks'])


class PrivateStateTests(unittest.TestCase):
    def setUp(self):
        self.ctx = contextlib.ExitStack(); self.addCleanup(self.ctx.close)
        self.temp = self.ctx.enter_context(tempfile.TemporaryDirectory())
        self.root = Path(self.temp)
        for field, filename in (('CATALOG', 'profiles.json'), ('CONFIG', 'config.json'), ('ACTIVE', 'active.json'), ('REPORT', 'report.json')):
            self.ctx.enter_context(mock.patch.object(vpn, field, str(self.root / filename)))
        self.state = vpn.validate_profile(preset()); self.state['backend'] = 'socks5'
        vpn.atomic_json(vpn.CATALOG, self.state)
        self.output = self.ctx.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.report = vpn.Report('test')

    def patch(self, name, **kw):
        return self.ctx.enter_context(mock.patch.object(vpn, name, **kw))

    def connection_mocks(self):
        for name, value in (('info', ''), ('assert_no_other_vpn', None), ('check_config', None),
                            ('write_plist', None), ('alive', True), ('route_interface', vpn.IFACE),
                            ('managed_dns_present', True), ('assert_dns', None), ('verify', '198.51.100.9')):
            self.patch(name, return_value=value)
        self.patch('resolve_node', side_effect=lambda n: n)
        self.launch = self.patch('run', return_value=(0, b'', b''))
        self.subscription = self.patch('refresh', side_effect=AssertionError('SOCKS must not refresh Xray'))

    def test_first_fails_second_works_and_is_recorded(self):
        self.connection_mocks()
        probe = self.patch('probe', side_effect=[vpn.VPNError('unreachable'), '198.51.100.9'])
        self.assertEqual(vpn.connect({'ip': '203.0.113.10'}, self.report), '198.51.100.9')
        self.assertEqual([c.args[0]['outbound']['server'] for c in probe.call_args_list], ['192.0.2.1', '192.0.2.2'])
        self.assertEqual(vpn.read_json(vpn.CONFIG)['outbounds'][0]['server'], '192.0.2.2')
        self.assertEqual(vpn.read_json(vpn.ACTIVE)['server_address'], '192.0.2.2')
        self.assertEqual(vpn.read_json(vpn.REPORT)['server_address'], '192.0.2.2')
        self.assertNotIn('fixture-secret', self.output.getvalue())
        self.assertEqual(os.stat(vpn.CONFIG).st_mode & 0o777, 0o600)

    def test_first_works_second_not_needed(self):
        self.connection_mocks(); probe = self.patch('probe', return_value='198.51.100.9')
        vpn.connect({'ip': '203.0.113.10'}, self.report)
        self.assertEqual(probe.call_count, 1)
        self.assertEqual(vpn.read_json(vpn.ACTIVE)['server_address'], '192.0.2.1')

    def test_both_fail_never_launch_tun(self):
        self.connection_mocks(); probe = self.patch('probe', side_effect=vpn.VPNError('bad auth'))
        with self.assertRaises(vpn.VPNError): vpn.connect({}, self.report)
        self.assertEqual(probe.call_count, 2); self.launch.assert_not_called()
        self.assertFalse(Path(vpn.CONFIG).exists()); self.assertFalse(Path(vpn.ACTIVE).exists())

    def test_preferred_fails_other_still_tried(self):
        self.connection_mocks(); self.state['preferred_socks5'] = self.state['socks5_nodes'][1]['id']
        vpn.atomic_json(vpn.CATALOG, self.state)
        probe = self.patch('probe', side_effect=[vpn.VPNError('timeout'), '198.51.100.9'])
        vpn.connect({}, self.report)
        self.assertEqual([c.args[0]['outbound']['server'] for c in probe.call_args_list], ['192.0.2.2', '192.0.2.1'])

    def test_equal_direct_ip_not_accepted(self):
        self.connection_mocks(); probe = self.patch('probe', side_effect=['203.0.113.10', '198.51.100.9'])
        vpn.connect({'ip': '203.0.113.10'}, self.report)
        self.assertEqual(probe.call_count, 2)

    def test_probe_cancel_does_not_fall_through_to_another_server(self):
        self.connection_mocks(); probe = self.patch('probe', side_effect=KeyboardInterrupt)
        with self.assertRaises(KeyboardInterrupt): vpn.connect({}, self.report)
        self.assertEqual(probe.call_count, 1); self.launch.assert_not_called()

    def test_final_verification_failure_rolls_back(self):
        self.connection_mocks(); self.patch('probe', return_value='198.51.100.9')
        self.patch('verify', side_effect=vpn.VPNError('TLS failed')); rollback = self.patch('rollback_new')
        with self.assertRaises(vpn.VPNError): vpn.connect({}, self.report)
        rollback.assert_called_once(); self.assertFalse(Path(vpn.ACTIVE).exists())

    def test_list_shows_both_addresses_not_password(self):
        vpn.list_nodes()
        text = self.output.getvalue()
        self.assertIn('192.0.2.1:45004', text); self.assertIn('192.0.2.2:45004', text)
        self.assertNotIn('fixture-secret', text)

    def test_select_persists_preference_without_connecting(self):
        stop = self.patch('stop'); connect = self.patch('connect')
        vpn.list_nodes('2')
        self.assertEqual(vpn.read_json(vpn.CATALOG)['preferred_socks5'], self.state['socks5_nodes'][1]['id'])
        stop.assert_not_called(); connect.assert_not_called()

    def test_invalid_selection_never_changes_catalog(self):
        before = Path(vpn.CATALOG).read_bytes()
        for bad in ('0', '-1', '3', '1.0', 'x', '2\n', '02'):
            with self.assertRaises(vpn.VPNError): vpn.list_nodes(bad)
        self.assertEqual(Path(vpn.CATALOG).read_bytes(), before)

    def wizard_mocks(self, running=False):
        self.patch('check_install', return_value={'version': '2.1.4'})
        self.patch('info', return_value='running' if running else '')
        self.stop = self.patch('stop')
        self.base = self.patch('baseline', return_value={'ip': '203.0.113.10'})
        self.connect = self.patch('connect', return_value='198.51.100.9')
        self.patch('stage_install', side_effect=AssertionError('wizard must not reinstall'))
        self.patch('activate_install', side_effect=AssertionError('wizard must not reinstall'))

    def test_wizard_selects_socks_locally(self):
        self.wizard_mocks()
        self.assertEqual(vpn.wizard(self.report, io.StringIO('2\n')), 0)
        self.assertEqual(vpn.read_json(vpn.CATALOG)['backend'], 'socks5')
        self.connect.assert_called_once(); self.stop.assert_not_called()

    def test_wizard_selects_xray_without_reinstall(self):
        self.wizard_mocks(True)
        self.assertEqual(vpn.wizard(self.report, io.StringIO('1\n')), 2)
        self.assertEqual(vpn.read_json(vpn.CATALOG)['backend'], 'xray')
        self.stop.assert_called_once(); self.connect.assert_called_once()

    def test_wizard_stop_precedes_baseline_and_connect(self):
        self.wizard_mocks(True); order = []
        self.stop.side_effect = lambda: order.append('stop')
        self.base.side_effect = lambda *a: order.append('baseline') or {}
        self.connect.side_effect = lambda *a: order.append('connect') or '198.51.100.9'
        vpn.wizard(self.report, io.StringIO('2\n'))
        self.assertEqual(order, ['stop', 'baseline', 'connect'])

    def test_wizard_cancel_does_not_touch_working_connection(self):
        self.wizard_mocks(True); before = Path(vpn.CATALOG).read_bytes()
        with self.assertRaises(KeyboardInterrupt): vpn.wizard(self.report, io.StringIO('0\n'))
        self.stop.assert_not_called(); self.connect.assert_not_called(); self.base.assert_not_called()
        self.assertEqual(Path(vpn.CATALOG).read_bytes(), before)

    def test_wizard_eof_does_not_stop(self):
        self.wizard_mocks(True)
        with self.assertRaises(vpn.VPNError): vpn.wizard(self.report, io.StringIO(''))
        self.stop.assert_not_called()

    def test_wizard_invalid_input_does_not_stop(self):
        self.wizard_mocks(True)
        with self.assertRaises(vpn.UsageError): vpn.wizard(self.report, io.StringIO('x\nx\nx\n'))
        self.stop.assert_not_called()

    def test_wizard_bad_install_never_stops(self):
        self.wizard_mocks(True); self.patch('check_install', side_effect=vpn.VPNError('hash'))
        with self.assertRaises(vpn.VPNError): vpn.wizard(self.report, io.StringIO('2\n'))
        self.stop.assert_not_called()

    def test_wizard_failed_cleanup_never_connects_or_changes_choice(self):
        self.wizard_mocks(True); self.stop.side_effect = vpn.VPNError('busy'); before = Path(vpn.CATALOG).read_bytes()
        with self.assertRaises(vpn.VPNError): vpn.wizard(self.report, io.StringIO('1\n'))
        self.connect.assert_not_called(); self.assertEqual(Path(vpn.CATALOG).read_bytes(), before)

    def test_wizard_failed_candidate_restores_saved_choice(self):
        self.wizard_mocks(True); self.connect.side_effect = vpn.VPNError('down')
        with self.assertRaises(vpn.VPNError): vpn.wizard(self.report, io.StringIO('1\n'))
        self.assertEqual(vpn.read_json(vpn.CATALOG), self.state)
        self.assertEqual(self.connect.call_count, 1)

    def test_wizard_ctrl_c_does_not_reconnect_old_profile(self):
        self.wizard_mocks(True); self.connect.side_effect = KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt): vpn.wizard(self.report, io.StringIO('1\n'))
        self.assertEqual(self.connect.call_count, 1)
        self.assertEqual(vpn.read_json(vpn.CATALOG), self.state)

    def test_wizard_keeps_profiles_credentials_and_preferred_address(self):
        self.wizard_mocks(); self.state['preferred_socks5'] = self.state['socks5_nodes'][1]['id']
        vpn.atomic_json(vpn.CATALOG, self.state)
        vpn.wizard(self.report, io.StringIO('2\n'))
        self.assertEqual(vpn.read_json(vpn.CATALOG), self.state)


class CommandTests(unittest.TestCase):
    def test_wizard_and_menu_aliases(self):
        for arg in ('wizard', '--wizard', 'menu', '--menu'):
            self.assertEqual(vpn.parse_command([arg]), ('wizard', []))
            with self.assertRaises(vpn.UsageError): vpn.parse_command([arg, 'extra'])

    def test_help_advertises_wizard(self):
        p = subprocess.run([sys.executable, str(ROOT / 'vpn-runtime.py'), '--help'], capture_output=True)
        self.assertEqual(p.returncode, 0); self.assertIn(b'wizard', p.stdout)

    def test_wrapper_forwards_wizard_and_menu_without_downloader(self):
        self.assertEqual(subprocess.run(['/bin/bash', '-n'], input=vpn.CLI.encode(), capture_output=True).returncode, 0)
        self.assertNotIn('curl', vpn.CLI)
        self.assertNotIn('raw.githubusercontent', vpn.CLI)
        text = vpn.CLI.replace('if [ "$EUID" -ne 0 ]; then', 'if false; then')
        text = text.replace('exec /usr/bin/python -E -s -B /Library/BigSurVPN/current/vpn-runtime.py', "printf '<%s>\n'")
        for arg in ('wizard', '--wizard', 'menu', '--menu'):
            p = subprocess.run(['/bin/bash', '-c', text, 'test', arg], capture_output=True)
            self.assertEqual(p.returncode, 0); self.assertIn(arg.lstrip('-').encode(), p.stdout)


if __name__ == '__main__':
    unittest.main()
