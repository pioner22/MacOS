import copy
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError, Paths
from tui_vpn.service import Manager
from tui_vpn.catalog import Catalog
from tui_vpn.ipc import Server, request
from test_data import URI


class FakeEngine:
    def __init__(self):
        self.process, self.starts, self.stops = None, 0, 0
        self.fail_selection = False

    def check(self, nodes, selection):
        pass

    def start(self, nodes, selection, wanted):
        self.starts += 1
        self.process = mock.Mock()
        self.process.poll.return_value = None

    def stop(self):
        self.stops += 1
        self.process = None

    def select(self, node):
        if self.fail_selection:
            raise OSError('synthetic API failure')

    def test(self):
        return {'ipv4': '198.51.100.77'}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.paths = Paths(base=self.temporary.name)
        self.engine = FakeEngine()
        self.manager = Manager(self.paths, ROOT, self.engine)
        self.wait = mock.patch.object(self.manager.stop_event, 'wait', return_value=False)
        self.wait.start()
        self.addCleanup(self.wait.stop)

    def node(self):
        self.manager.uri({'uri': URI})

    def test_default_off_does_not_create_a_tunnel(self):
        self.manager._cycle()
        self.assertEqual(self.engine.starts, 0)
        self.assertEqual(self.manager.status()['state'], 'OFF')

    def test_cannot_enable_without_a_profile(self):
        with self.assertRaises(AppError):
            self.manager.on({})
        self.assertFalse(self.manager.catalog.state['enabled'])

    def test_on_shows_starting_instead_of_an_old_off_observation(self):
        self.node()
        self.manager.on({})
        self.assertEqual(self.manager.status()['state'], 'STARTING')
        self.manager._cycle()
        self.assertEqual(self.engine.starts, 1)

    def test_manual_off_survives_new_manager_and_never_restarts(self):
        self.node()
        self.manager.on({})
        self.manager._cycle()
        self.manager.off({})
        self.manager._cycle()
        self.assertIsNone(self.engine.process)
        self.assertFalse(Catalog(self.paths).state['enabled'])
        fresh = Manager(self.paths, ROOT, FakeEngine())
        self.assertFalse(fresh.wanted())

    def test_failed_subscription_refresh_keeps_existing_data(self):
        self.node()
        subscription = self.manager.catalog.data['subscriptions'][0]
        subscription['url'] = 'https://example.org/private-token'
        before = copy.deepcopy(self.manager.catalog.data)
        with mock.patch('tui_vpn.service.fetch_worker', side_effect=AppError('unavailable')):
            with self.assertRaises(AppError):
                self.manager.refresh({'id': subscription['id']})
        self.assertEqual(before, self.manager.catalog.data)

    def test_failed_manual_switch_restores_old_selection(self):
        self.node()
        self.engine.fail_selection = True
        with self.assertRaises(AppError):
            self.manager.select({'id': self.manager.catalog.nodes()[0]['id']})
        self.assertEqual(self.manager.catalog.state['selection'], 'auto')

    def test_public_status_contains_neither_urls_nor_credentials(self):
        self.node()
        self.manager.catalog.data['subscriptions'][0]['url'] = 'https://example.org/very-private-token'
        public = json.dumps(self.manager.status())
        self.assertNotIn('synthetic-password', public)
        self.assertNotIn('very-private-token', public)
        self.assertNotIn('outbound', public)

    def test_explicit_delete_never_schedules_readding_the_deleted_profile(self):
        self.node()
        self.manager.uri({'uri': URI.replace('#Primary', '#Secondary')})
        self.manager.view['state'] = 'RUNNING'
        item = self.manager.catalog.data['subscriptions'][0]
        self.manager.delete({'id': item['id']})
        self.assertIsNone(self.manager.pending)
        self.assertNotIn(item['id'], {s['id'] for s in self.manager.catalog.data['subscriptions']})

    def test_unknown_rpc_cannot_run_a_shell(self):
        with self.assertRaises(AppError):
            self.manager.dispatch('shell', {'command': 'synthetic never executed'})

    def test_manual_off_is_not_blocked_by_a_subscription_refresh(self):
        self.node()
        subscription = self.manager.catalog.data['subscriptions'][0]
        subscription['url'] = 'https://example.org/fixture'
        self.manager.on({})
        self.manager._cycle()
        entered, release = threading.Event(), threading.Event()
        errors = []
        def fetch(*_args):
            entered.set()
            release.wait(3)
            return URI.encode()
        def refresh():
            try:
                self.manager.dispatch('subscription_refresh', {'id': subscription['id']})
            except Exception as error:
                errors.append(error)
        with mock.patch('tui_vpn.service.fetch_worker', side_effect=fetch):
            worker = threading.Thread(target=refresh)
            worker.start()
            self.assertTrue(entered.wait(2))
            try:
                self.manager.dispatch('off', {})
            finally:
                release.set()
                worker.join(3)
        self.assertEqual(errors, [])
        self.assertFalse(Catalog(self.paths).state['enabled'])


class IPCTests(unittest.TestCase):
    def setUp(self):
        # macOS sun_path is 104 bytes: the Hub report path cannot hold a socket.
        # This short owned disposable namespace is cleaned before test exit.
        parent = '/private/tmp' if sys.platform == 'darwin' else '/tmp'
        self.temporary = tempfile.TemporaryDirectory(prefix='p10tui-ipc-', dir=parent)
        self.addCleanup(self.temporary.cleanup)
        self.paths = Paths(base=self.temporary.name)
        self.manager = Manager(self.paths, ROOT, FakeEngine())
        self.server = Server(self.paths, os.getuid(), self.manager)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.paths.socket.unlink(missing_ok=True)

    def test_native_peer_uid_allows_the_owner(self):
        self.assertEqual(request('status', paths=self.paths)['state'], 'OFF')

    def test_foreign_peer_is_denied_before_the_command(self):
        self.manager.uri({'uri': URI})
        with mock.patch('tui_vpn.ipc.peer_uid', return_value=os.getuid() + 10000):
            with self.assertRaises(AppError):
                request('on', paths=self.paths)
        self.assertFalse(self.manager.catalog.state['enabled'])

    def test_unknown_command_returns_a_public_error(self):
        with self.assertRaises(AppError):
            request('unknown', paths=self.paths)


if __name__ == '__main__':
    unittest.main()
