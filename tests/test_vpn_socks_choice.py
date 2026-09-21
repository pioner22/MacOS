#!/usr/bin/env python3
"""Offline tests: real parsers/files; mocked launchd, core and network. No real VPN."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('vpn_socks_choice', str(ROOT / 'vpn-runtime.py'))
v = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)


def preset():
    return {'server': '192.0.2.100', 'port': 1080,
            'username': 'fixture-user', 'password': 'FIXTURE-not-a-real-secret'}


def profile():
    return {'schema': 'bigsur-vpn-profile-v2', 'subscription': 'https://example.com/subscription',
            'bootstrap': ['trojan://fixture@example.com:443?security=tls&type=tcp#fixture'],
            'socks5': preset()}


class ProfileTests(unittest.TestCase):
    def test_socks_outbound_schema(self):
        n = v.validate_socks(preset())
        self.assertEqual(n['outbound']['type'], 'socks')
        self.assertEqual(n['outbound']['version'], '5')
        self.assertEqual(n['outbound']['network'], 'tcp')
        self.assertNotIn('tls', n['outbound'])
        self.assertEqual(n['name'], 'SOCKS5 резерв')
        self.assertNotIn(preset()['password'], n['name'])

    def test_profile_contains_both_transports(self):
        s = v.validate_profile(profile())
        self.assertEqual(s['backend'], 'xray')
        self.assertEqual(s['socks5']['outbound']['type'], 'socks')
        self.assertEqual(s['bootstrap'][0]['outbound']['type'], 'trojan')

    def test_legacy_profile_still_valid(self):
        p = profile(); del p['socks5']
        self.assertNotIn('socks5', v.validate_profile(p))
        self.assertEqual(v.backend_of({}), 'xray')

    def test_profile_unchanged(self):
        p = profile(); before = copy.deepcopy(p)
        v.validate_profile(p)
        self.assertEqual(p, before)

    def test_unknown_backend_rejected(self):
        with self.assertRaises(v.VPNError):
            v.backend_of({'backend': 'amnezia'})

    def test_extra_fields_cannot_add_shell_code(self):
        p = preset(); p['PostUp'] = 'execute-me'
        with self.assertRaises(v.VPNError):
            v.validate_socks(p)

    def test_missing_field_rejected(self):
        p = preset(); del p['password']
        with self.assertRaises(v.VPNError):
            v.validate_socks(p)

    def test_secret_not_in_validation_error(self):
        p = preset(); p['password'] = 'DO_NOT_DISCLOSE\n'
        with self.assertRaises(v.VPNError) as caught:
            v.validate_socks(p)
        self.assertNotIn('DO_NOT_DISCLOSE', str(caught.exception))

    def test_quotes_remain_data_in_json(self):
        p = preset(); p['password'] = "a\"'$(never-run);\\b"
        n = v.validate_socks(p)
        c = v.make_config(n, 'fixture-auth', True)
        self.assertEqual(json.loads(json.dumps(c))['outbounds'][0]['password'], p['password'])


def invalid_field(key, value, name):
    def test(self):
        p = preset(); p[key] = value
        with self.assertRaises(v.VPNError):
            v.validate_socks(p)
    setattr(ProfileTests, 'test_invalid_' + name, test)
for key, values in (
    ('server', ['', '999.1.1.1', '127.0.0.1\n', 'example.com', '::1', '1.2.3.4;ls', 123]),
    ('port', [True, False, 0, -1, 65536, 1.1, '1080', None]),
    ('username', ['', None, 'user\n', 'x' * 256]),
    ('password', ['', None, 'pw\x00', 'x' * 256]),
):
    for i, value in enumerate(values):
        invalid_field(key, value, '%s_%02d' % (key, i))


class MenuTests(unittest.TestCase):
    def choose(self, line):
        with contextlib.redirect_stdout(io.StringIO()):
            return v.choose_backend(v.validate_profile(profile()), io.StringIO(line))

    def test_xray(self): self.assertEqual(self.choose('1\n'), 'xray')
    def test_socks(self): self.assertEqual(self.choose('2\n'), 'socks5')
    def test_whitespace(self): self.assertEqual(self.choose(' 2 \n'), 'socks5')
    def test_retry(self): self.assertEqual(self.choose('bad\n2\n'), 'socks5')

    def test_overlong_input_cannot_be_reinterpreted_as_choice(self):
        with self.assertRaises(v.UsageError): self.choose('x' * 32 + '2\n')

    def test_cancel(self):
        with self.assertRaises(KeyboardInterrupt): self.choose('0\n')

    def test_closed_input(self):
        with self.assertRaises(v.VPNError): self.choose('')

    def test_retries_are_bounded(self):
        with self.assertRaises(v.UsageError): self.choose('bad\nbad\nbad\n2\n')

    def test_only_legacy_profile_has_default(self):
        with mock.patch.object(v.io, 'open', side_effect=AssertionError('must not open tty')):
            self.assertEqual(v.choose_backend({}), 'xray')

    def test_reads_tty_not_stdin(self):
        fake = io.StringIO('2\n')
        with mock.patch.object(v.io, 'open', return_value=fake) as opened, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(v.choose_backend(v.validate_profile(profile())), 'socks5')
            opened.assert_called_once_with('/dev/tty', 'r', encoding='utf-8')
        self.assertTrue(fake.closed)

    def test_missing_tty_rejected(self):
        with mock.patch.object(v.io, 'open', side_effect=OSError('no tty')), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(v.VPNError): v.choose_backend(v.validate_profile(profile()))

    def test_menu_does_not_disclose_credentials(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            v.choose_backend(v.validate_profile(profile()), io.StringIO('2\n'))
        self.assertNotIn(preset()['password'], out.getvalue())
        self.assertNotIn(preset()['username'], out.getvalue())


class ConfigAndChoiceTests(unittest.TestCase):
    def test_socks_candidates_never_fall_back_to_primary(self):
        s = v.validate_profile(profile()); s['backend'] = 'socks5'
        s['nodes'] = [{'id': 'primary'}]; s['preferred'] = 'primary'
        self.assertEqual(v.candidates(s), [s['socks5']])

    def test_xray_candidates_ignore_socks(self):
        s = v.validate_profile(profile())
        self.assertEqual(v.candidates(s), s['bootstrap'])

    def test_missing_socks_is_error_not_primary_fallback(self):
        with self.assertRaises(v.VPNError): v.candidates({'backend': 'socks5'})

    def test_socks_config_does_not_mutate_preset(self):
        n = v.validate_socks(preset()); before = copy.deepcopy(n)
        c = v.make_config(n, 'fixture-auth', True)
        c['outbounds'][0]['server'] = '192.0.2.1'
        self.assertEqual(n, before)

    def test_dns_is_https_over_selected_proxy(self):
        c = v.make_config(v.validate_socks(preset()), 'fixture-auth', True)
        dns = c['dns']['servers'][0]
        self.assertEqual((dns['type'], dns['detour']), ('https', 'proxy'))
        self.assertEqual(c['route']['rules'][0]['action'], 'hijack-dns')

    def test_udp_rejected_after_dns_hijack(self):
        c = v.make_config(v.validate_socks(preset()), 'fixture-auth', True)
        self.assertEqual(c['route']['rules'][1], {'network': ['udp', 'icmp'], 'action': 'reject'})
        self.assertEqual(c['route']['final'], 'proxy')
        self.assertFalse(any(x['type'] == 'direct' for x in c['outbounds']))

    def test_xray_config_unchanged(self):
        n = v.validate_profile(profile())['bootstrap'][0]
        c = v.make_config(n, 'fixture-auth', True)
        self.assertEqual(c['route']['rules'], [{'port': 53, 'action': 'hijack-dns'}])
        self.assertEqual(c['outbounds'][0]['type'], 'trojan')

    def test_socks_refresh_never_contacts_primary(self):
        s = v.validate_profile(profile()); s['backend'] = 'socks5'
        with mock.patch.object(v, 'read_json', return_value=s), mock.patch.object(v, 'http') as http:
            with self.assertRaises(v.VPNError): v.refresh(None, mock.Mock())
            http.assert_not_called()

    def test_socks_list_preserves_xray_preference(self):
        s = v.validate_profile(profile()); s.update(backend='socks5', preferred='keep-xray')
        with mock.patch.object(v, 'read_json', return_value=s), mock.patch.object(v, 'atomic_json') as write, contextlib.redirect_stdout(io.StringIO()):
            v.list_nodes('1'); write.assert_not_called()
            with self.assertRaises(v.VPNError): v.list_nodes('2')
        self.assertEqual(s['preferred'], 'keep-xray')


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.events = []
        self.report = mock.Mock(); self.report.data = {}
        self.state = v.validate_profile(profile())
        self.installed = {'version': v.VERSION, 'hashes': {'vpn-runtime.py': 'code'}, 'profile_sha256': 'profile'}
        self.base = {'ip': '192.0.2.1'}
        self.m = {}
        for name, ret in [('validate_profile', self.state), ('check_activation_paths', None),
                          ('choose_backend', 'socks5'), ('check_install', self.installed),
                          ('info', 'our-job'), ('baseline', self.base), ('github_check', {}),
                          ('stage_install', ('/fixture/stage', copy.deepcopy(self.state), {}, {})),
                          ('stop', None), ('activate_install', None), ('connect', '198.51.100.1'),
                          ('finish_connected', 2), ('rollback_new', None), ('atomic_json', None),
                          ('atomic_bytes', None)]:
            def callback(*args, _name=name, _ret=ret, **kwargs):
                self.events.append(_name); return _ret
            self.m[name] = self.stack.enter_context(mock.patch.object(v, name, side_effect=callback))
        self.stack.enter_context(mock.patch.object(v, 'read_json', side_effect=lambda path:
            profile() if path == '/fixture/profile.json' else copy.deepcopy(self.state)))
        self.stack.enter_context(mock.patch.object(v, 'digest', side_effect=lambda path:
            'profile' if path == '/fixture/profile.json' else 'code'))
        self.stack.enter_context(mock.patch.object(v.os.path, 'isdir', return_value=True))
        self.cleanup = self.stack.enter_context(mock.patch.object(v.shutil, 'rmtree'))

    def run_setup(self): return v.setup('/fixture/profile.json', self.report)

    def test_same_version_switches_without_core_download(self):
        self.assertEqual(self.run_setup(), 2)
        self.m['stage_install'].assert_not_called()
        self.m['stop'].assert_called_once()
        self.m['connect'].assert_called_once_with(self.base, self.report)
        catalog = self.m['atomic_json'].call_args.args[1]
        self.assertEqual(catalog['backend'], 'socks5')
        self.assertIn('socks5', catalog)
        self.assertLess(self.events.index('stop'), self.events.index('baseline'))
        self.assertLess(self.events.index('baseline'), self.events.index('connect'))

    def test_same_version_rewrites_public_wrapper(self):
        self.run_setup()
        self.m['atomic_bytes'].assert_called_once_with(v.BASE + '/vpn-bigsur.sh', v.b(v.CLI), 0o755)

    def test_upgrade_stages_before_stopping(self):
        self.installed['version'] = '2.0.3'
        self.run_setup()
        self.assertLess(self.events.index('stage_install'), self.events.index('stop'))
        args = self.m['activate_install'].call_args.args
        self.assertEqual(args[1]['backend'], 'socks5')
        self.cleanup.assert_not_called()

    def test_select_xray_after_socks(self):
        self.state['backend'] = 'socks5'
        self.m['choose_backend'].side_effect = None; self.m['choose_backend'].return_value = 'xray'
        self.run_setup()
        self.assertEqual(self.m['atomic_json'].call_args.args[1]['backend'], 'xray')

    def test_new_install_connects_without_stop(self):
        self.m['check_install'].side_effect = [v.VPNError('not installed'), self.installed]
        self.m['info'].side_effect = None; self.m['info'].return_value = ''
        self.run_setup()
        self.m['stop'].assert_not_called()
        self.m['activate_install'].assert_called_once()
        self.m['connect'].assert_called_once()

    def test_cancel_does_not_touch_network(self):
        self.m['choose_backend'].side_effect = KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt): self.run_setup()
        for name in ('stop', 'baseline', 'connect', 'stage_install', 'info'):
            self.m[name].assert_not_called()

    def test_failed_download_keeps_previous_connection(self):
        self.installed['version'] = '2.0.3'
        self.m['stage_install'].side_effect = v.VPNError('download')
        with self.assertRaises(v.VPNError): self.run_setup()
        self.m['stop'].assert_not_called()

    def test_stop_failure_aborts_activation(self):
        self.installed['version'] = '2.0.3'
        self.m['stop'].side_effect = v.VPNError('stop')
        with self.assertRaises(v.VPNError): self.run_setup()
        self.m['activate_install'].assert_not_called()
        self.m['connect'].assert_not_called()
        self.cleanup.assert_called_once_with('/fixture/stage')

    def test_failed_final_test_rolls_back(self):
        self.m['finish_connected'].side_effect = v.VPNError('verify')
        with self.assertRaises(v.VPNError): self.run_setup()
        self.m['rollback_new'].assert_called_once_with(self.report)

    def test_interrupted_final_test_rolls_back(self):
        self.m['finish_connected'].side_effect = KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt): self.run_setup()
        self.m['rollback_new'].assert_called_once_with(self.report)


class ConnectTests(unittest.TestCase):
    def connect_fixture(self, failure=False):
        s = v.validate_profile(profile()); s['backend'] = 'socks5'
        report = mock.Mock(); report.data = {}
        with contextlib.ExitStack() as stack:
            for name, result in [('read_json', s), ('info', ''), ('assert_no_other_vpn', None),
                                 ('resolve_node', s['socks5']), ('probe', '198.51.100.1'),
                                 ('check_config', None), ('write_plist', None), ('run', (0, b'', b'')),
                                 ('alive', True), ('route_interface', v.IFACE), ('managed_dns_present', True),
                                 ('assert_dns', None)]:
                stack.enter_context(mock.patch.object(v, name, return_value=result))
            refresh = stack.enter_context(mock.patch.object(v, 'refresh', side_effect=AssertionError('primary provider contacted')))
            write = stack.enter_context(mock.patch.object(v, 'atomic_json'))
            verify = stack.enter_context(mock.patch.object(v, 'verify', return_value='198.51.100.1'))
            rollback = stack.enter_context(mock.patch.object(v, 'rollback_new'))
            if failure:
                verify.side_effect = v.VPNError('test failed')
                with self.assertRaises(v.VPNError): v.connect({'ip': '192.0.2.1'}, report)
                rollback.assert_called_once_with(report)
            else:
                self.assertEqual(v.connect({'ip': '192.0.2.1'}, report), '198.51.100.1')
                active = next(args.args[1] for args in write.call_args_list if args.args[0] == v.ACTIVE)
                self.assertEqual(active['backend'], 'socks5')
                self.assertNotIn(preset()['password'], json.dumps(report.data))
                rollback.assert_not_called()
            refresh.assert_not_called()

    def test_no_primary_subscription_calls(self): self.connect_fixture()
    def test_failed_verification_stops_new_service(self): self.connect_fixture(True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
