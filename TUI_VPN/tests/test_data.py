import base64
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError, Paths, write_json, read_json, owner_lock, verify_source
from tui_vpn.profiles import parse_uri, parse_feed, wireguard, assign_ids, json_feed
from tui_vpn.configuration import build
from tui_vpn.catalog import Catalog
from tui_vpn.engine import Counters, native_health
from tui_vpn.network import validate_url

URI = 'trojan://synthetic-password@example.org:443?security=tls&sni=example.org#Primary'


class DataTests(unittest.TestCase):
    def test_uri_and_base64_feed(self):
        one = parse_uri(URI)
        self.assertEqual(one['outbound']['server'], 'example.org')
        self.assertEqual(parse_feed(base64.b64encode((URI + '\n').encode())), [one])

    def test_tls_verification_cannot_be_disabled(self):
        with self.assertRaises(AppError):
            parse_uri(URI.replace('#Primary', '&allowInsecure=1#Primary'))
        with self.assertRaises(AppError):
            json_feed({'outbounds': [{'type': 'trojan', 'server': 'example.org', 'server_port': 443,
                                     'tls': {'enabled': True, 'insecure': True}}]})

    def test_subscription_cannot_read_root_files_or_set_interfaces(self):
        for field in ('certificate_path', 'key_path', 'detour', 'bind_interface', 'network_namespace'):
            value = parse_uri(URI)['outbound']
            value[field] = '/private/secret'
            with self.subTest(field=field), self.assertRaises(AppError):
                json_feed({'outbounds': [value]})

    def test_terminal_controls_are_removed_from_labels(self):
        with self.assertRaises(AppError):
            parse_uri(URI.replace('#Primary', '#A%1b%5b31m'))
        value = json_feed({'outbounds': [dict(parse_uri(URI)['outbound'], tag='A\x1b[31m')]})[0]
        self.assertNotIn('\x1b', value['name'])

    def test_wireguard_is_data_only_and_requires_full_route(self):
        key = base64.b64encode(b'x' * 32).decode()
        text = ('[Interface]\nPrivateKey=%s\nAddress=10.2.0.2/32\n[Peer]\nPublicKey=%s\n'
                'Endpoint=198.51.100.2:51820\nAllowedIPs=0.0.0.0/0\n') % (key, key)
        self.assertFalse(wireguard(text.encode())['endpoint']['system'])
        for bad in (text.replace('Address=', 'PostUp=touch /tmp/unsafe\nAddress='),
                    text.replace('0.0.0.0/0', '10.0.0.0/8')):
            with self.assertRaises(AppError):
                wireguard(bad.encode())

    def test_native_group_has_no_direct_user_fallback(self):
        nodes = assign_ids([parse_uri(URI)], 'fixture')
        settings = read_json(ROOT / 'config/defaults.json')
        value = build(nodes, settings, 'x' * 48, 'y' * 48, 'darwin')
        self.assertEqual(value['route']['final'], 'proxy')
        automatic, selector = value['outbounds'][-2:]
        self.assertEqual(automatic['type'], 'urltest')
        self.assertNotIn('bootstrap-direct', automatic['outbounds'])
        self.assertNotIn('bootstrap-direct', selector['outbounds'])
        self.assertEqual(value['dns']['final'], 'remote-dns')
        self.assertNotIn('detour', value['dns']['servers'][0])
        self.assertEqual(value['inbounds'][1]['users'][0]['username'], 'probe')

    def test_linux_uses_native_tun_redirect(self):
        value = build(assign_ids([parse_uri(URI)], 'fixture'), read_json(ROOT / 'config/defaults.json'),
                      'x' * 48, 'y' * 48, 'linux')
        self.assertTrue(value['inbounds'][0]['auto_redirect'])
        self.assertEqual(value['inbounds'][0]['dns_mode'], 'hijack')

    def test_counter_resets_do_not_generate_negative_rates(self):
        counters = Counters()
        counters.update(100, 40, 1)
        result = counters.update(300, 80, 3)
        self.assertEqual((result['rx_rate'], result['tx_rate']), (100, 20))
        result = counters.update(0, 0, 4)
        self.assertEqual(result['rx_rate'], 0)

    def test_missing_and_stale_health_are_not_success(self):
        self.assertFalse(native_health({})['healthy'])
        self.assertFalse(native_health({'history': [{'time': '2020-01-01T00:00:00.123456789Z', 'delay': 2}]})['healthy'])
        with mock.patch('tui_vpn.engine.time.time', return_value=1577836801):
            self.assertTrue(native_health({'history': [{'time': '2020-01-01T00:00:00.123456789Z', 'delay': 2}]})['healthy'])

    def test_https_private_targets_and_downgrade_are_rejected(self):
        for url in ('http://example.org', 'https://127.0.0.1/a', 'https://user:password@example.org'):
            with self.subTest(url=url), self.assertRaises(AppError):
                validate_url(url)

    def test_atomic_state_does_not_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'user-data'
            target.write_text('preserve')
            path = Path(folder) / 'state.json'
            path.symlink_to(target)
            with self.assertRaises(AppError):
                write_json(path, {'enabled': True})
            self.assertEqual(target.read_text(), 'preserve')

    def test_owner_lock_rejects_concurrent_commands(self):
        with tempfile.TemporaryDirectory() as folder:
            with owner_lock(Path(folder) / 'lock'):
                with self.assertRaises(AppError):
                    with owner_lock(Path(folder) / 'lock'):
                        self.fail('Lock was acquired twice')

    def test_off_and_selection_persist_across_reload(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = Paths(base=folder)
            catalog = Catalog(paths)
            catalog.commit(catalog.candidate([parse_uri(URI)], 'fixture'))
            catalog.enable(True)
            catalog.select(catalog.nodes()[0]['id'])
            catalog.enable(False)
            fresh = Catalog(paths)
            self.assertFalse(fresh.state['enabled'])
            self.assertEqual(fresh.state['selection'], fresh.nodes()[0]['id'])

    def test_corrupted_saved_state_never_enables_a_different_path(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = Paths(base=folder)
            catalog = Catalog(paths)
            with catalog.connection() as database:
                catalog._save(database, 'state', {'schema': 1, 'enabled': True, 'selection': 'unknown'})
            with self.assertRaises(AppError):
                Catalog(paths)

    def test_saved_catalog_cannot_load_a_privileged_certificate_file(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = Paths(base=folder)
            catalog = Catalog(paths)
            candidate = catalog.candidate([parse_uri(URI)], 'fixture')
            candidate['subscriptions'][0]['nodes'][0]['outbound']['tls']['key_path'] = '/root/private'
            with catalog.connection() as database:
                catalog._save(database, 'catalog', candidate)
            with self.assertRaises(AppError):
                Catalog(paths)

    def test_catalog_and_requested_state_roll_back_in_one_sqlite_transaction(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            paths = Paths(base=folder)
            catalog = Catalog(paths)
            catalog.commit(catalog.candidate([parse_uri(URI)], 'one'))
            catalog.commit(catalog.candidate([parse_uri(URI)], 'two'))
            catalog.select(catalog.nodes()[0]['id'])
            before = catalog.data
            with catalog.connection() as database:
                database.execute("CREATE TRIGGER inject_abort BEFORE UPDATE ON documents WHEN NEW.name='state' BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END")
            with self.assertRaises(sqlite3.DatabaseError):
                catalog.commit({'schema': 1, 'subscriptions': catalog.data['subscriptions'][1:]})
            fresh = Catalog(paths)
            self.assertEqual(fresh.data, before)
            self.assertEqual(fresh.state['selection'], fresh.nodes()[0]['id'])

    def test_source_verifier_detects_tampering(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'one.py').write_text('original')
            import hashlib
            write_json(root / 'manifest.json', {'schema': 'tui-vpn.source.v1', 'files': {
                'one.py': hashlib.sha256(b'original').hexdigest()}})
            verify_source(root)
            (root / 'one.py').write_text('changed')
            with self.assertRaises(AppError):
                verify_source(root)


if __name__ == '__main__':
    unittest.main()
