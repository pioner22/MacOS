import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.catalog import Catalog
from tui_vpn.common import AppError, Paths
from tui_vpn.manual_profiles import socks_profile
from tui_vpn.profiles import parse_uri
from tui_vpn.service import Manager
from test_service import FakeEngine, URI


class ManualProfileTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='p10-manual-')
        self.addCleanup(self.temporary.cleanup)
        self.paths = Paths(base=self.temporary.name)
        self.engine = FakeEngine()
        self.manager = Manager(self.paths, ROOT, self.engine)
        self.addCleanup(self.manager.health.close)
        self.args = {'name': 'Резерв', 'host': 'proxy.example.org', 'port': '1080',
                     'username': 'fixture-user', 'password': 'fixture-password'}

    def add_socks(self):
        self.manager.dispatch('socks_save', self.args)
        return self.manager.catalog.nodes()[0]

    def test_add_and_edit_preserve_manual_off_and_saved_password(self):
        node = self.add_socks()
        self.manager.select({'id': node['id']})
        self.manager.socks_save(dict(self.args, id=node['id'], host='backup.example.org', password=None))
        saved = Catalog(self.paths)
        self.assertFalse(saved.state['enabled'])
        self.assertEqual(node['id'], saved.state['selection'])
        self.assertEqual('fixture-password', saved.nodes()[0]['outbound']['password'])
        self.assertEqual('backup.example.org', saved.nodes()[0]['outbound']['server'])
        self.assertEqual(self.engine.starts, 0)

    def test_edit_details_never_return_password(self):
        node = self.add_socks()
        details = self.manager.dispatch('socks_details', {'id': node['id']})['socks_form']
        self.assertEqual(details['username'], 'fixture-user')
        self.assertTrue(details['has_password'])
        self.assertNotIn('password', details)
        self.assertNotIn('fixture-password', json.dumps(self.manager.status()))

    def test_clear_login_explicitly_removes_authentication(self):
        node = self.add_socks()
        self.manager.socks_save(dict(self.args, id=node['id'], username='', password=None))
        self.assertNotIn('username', self.manager.catalog.nodes()[0]['outbound'])
        self.assertNotIn('password', self.manager.catalog.nodes()[0]['outbound'])

    def test_invalid_fields_keep_the_previous_catalog(self):
        self.add_socks()
        before = copy.deepcopy(self.manager.catalog.data)
        for changes in ({'port': True}, {'port': '70000'}, {'host': 'https://proxy.example.org'},
                        {'username': '', 'password': 'x'}, {'password': 'x\ncommand'},
                        {'name': {'not': 'text'}}):
            with self.subTest(changes=changes), self.assertRaises(AppError):
                self.manager.socks_save(dict(self.args, **changes))
            self.assertEqual(before, self.manager.catalog.data)

    def test_two_credentials_on_one_endpoint_are_distinct_profiles(self):
        first = self.add_socks()
        self.manager.socks_save(dict(self.args, username='other-user', password='other-password'))
        nodes = self.manager.catalog.nodes()
        self.assertEqual(len(nodes), 2)
        self.assertNotEqual(first['id'], nodes[1]['id'])

    def test_edit_and_delete_only_the_chosen_imported_local_node(self):
        self.manager.apply(self.manager.catalog.candidate(
            [parse_uri(URI), socks_profile(self.args)], 'Импорт'))
        original, socks = self.manager.catalog.nodes()
        before = copy.deepcopy(original)
        self.manager.socks_save(dict(self.args, id=socks['id'], name='Новое имя', password=None))
        self.assertEqual(before, self.manager.catalog.nodes()[0])
        self.manager.dispatch('server_delete', {'id': socks['id']})
        self.assertEqual(self.manager.catalog.nodes(), [before])

    def test_provider_managed_socks_cannot_be_edited_or_deleted_individually(self):
        self.manager.apply(self.manager.catalog.candidate(
            [socks_profile(self.args)], 'Provider', 'https://example.org/private-feed'))
        node = self.manager.catalog.nodes()[0]
        for command in ('socks_details', 'server_delete'):
            with self.assertRaises(AppError):
                self.manager.dispatch(command, {'id': node['id']})

    def test_repeated_url_refreshes_one_source_and_reordering_keeps_selection(self):
        first = parse_uri(URI)
        second = parse_uri(URI.replace('synthetic-password', 'second-password').replace('#Primary', '#Second'))
        catalog = self.manager.catalog
        url = 'https://example.org/own-subscription'
        catalog.commit(catalog.candidate([first, second], 'Main', url))
        original = catalog.nodes()[1]['id']
        catalog.select(original)
        catalog.commit(catalog.candidate([second, first], 'Main', url))
        self.assertEqual(len(catalog.data['subscriptions']), 1)
        self.assertEqual(catalog.nodes()[0]['id'], original)
        self.assertEqual(catalog.state['selection'], original)

    def test_changed_credentials_do_not_inherit_an_old_node_identity(self):
        catalog = self.manager.catalog
        url = 'https://example.org/subscription'
        catalog.commit(catalog.candidate([parse_uri(URI)], 'Main', url))
        old = catalog.nodes()[0]['id']
        catalog.commit(catalog.candidate([parse_uri(URI.replace('synthetic-password', 'new-password'))], 'Main', url))
        self.assertNotEqual(old, catalog.nodes()[0]['id'])

    def test_combined_catalog_size_is_rejected_before_replacing_saved_data(self):
        self.add_socks()
        before = copy.deepcopy(self.manager.catalog.data)
        large = parse_uri(URI)
        large['outbound']['transport'] = {'type': 'ws', 'path': '/' + 'x' * 1500000}
        candidate = self.manager.catalog.candidate([large, large, large], 'Large provider')
        with self.assertRaises(AppError):
            self.manager.catalog.commit(candidate)
        self.assertEqual(Catalog(self.paths).data, before)

    def test_unchanged_subscription_refresh_does_not_restart_the_tunnel(self):
        with mock.patch('tui_vpn.service.fetch_worker', return_value=URI.encode()):
            self.manager.add({'url': 'https://example.org/subscription'})
            self.manager.on({})
            self.manager._cycle()
            source = self.manager.catalog.data['subscriptions'][0]
            self.manager.refresh({'id': source['id']})
            self.manager._cycle()
        self.assertEqual(self.engine.starts, 1)


if __name__ == '__main__':
    unittest.main()
