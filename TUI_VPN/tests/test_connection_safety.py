import tempfile
import threading
import copy
import unittest
from pathlib import Path
from unittest import mock
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError, Paths
from tui_vpn.service import Manager
from tui_vpn.catalog import Catalog
from tui_vpn.profiles import parse_uri, validate_outbound
from test_service import FakeEngine, URI


class ConnectionSafetyTests(unittest.TestCase):
    def test_manual_off_cancels_a_pending_automatic_catalog_rollback(self):
        with tempfile.TemporaryDirectory(prefix='p10-off-rollback-') as temporary:
            manager = Manager(Paths(base=temporary), ROOT, FakeEngine())
            manager.uri({'uri': URI})
            manager.view['state'] = 'RUNNING'
            manager.uri({'uri': URI.replace('#Primary', '#Secondary')})
            self.assertIsNotNone(manager.pending)
            wanted = copy.deepcopy(manager.catalog.data)
            manager.off({})
            self.assertIsNone(manager.pending)
            manager._rollback_pending()
            self.assertEqual(wanted, manager.catalog.data)
            manager.health.close()

    def test_automatic_rollback_cancels_checks_for_the_rejected_catalog(self):
        with tempfile.TemporaryDirectory(prefix='p10-rollback-probe-') as temporary:
            manager = Manager(Paths(base=temporary), ROOT, FakeEngine())
            manager.uri({'uri': URI})
            before = copy.deepcopy(manager.catalog.data)
            manager.view['state'] = 'RUNNING'
            manager.uri({'uri': URI.replace('#Primary', '#Secondary')})
            with mock.patch('tui_vpn.health_checks.threading.Thread'):
                manager.health.start(manager.probe_nodes())
                self.assertTrue(manager.status()['probes']['running'])
                manager.view['state'] = 'CHECKING'
                manager.pending = (manager.catalog.revision, before, 0)
                manager._rollback_pending()
                self.assertFalse(manager.status()['probes']['running'])
                self.assertEqual(manager.catalog.data, before)
                manager.health.close()

    def test_manual_off_wins_while_the_initial_connection_guard_is_waiting(self):
        with tempfile.TemporaryDirectory(prefix='p10-on-race-') as temporary:
            paths, engine = Paths(base=temporary), FakeEngine()
            entered, release = threading.Event(), threading.Event()
            engine.guard = lambda: (entered.set(), release.wait(3))
            manager = Manager(paths, ROOT, engine)
            manager.uri({'uri': URI})
            thread = threading.Thread(target=manager.on, args=({},))
            thread.start()
            try:
                self.assertTrue(entered.wait(2))
                manager.off({})
            finally:
                release.set()
                thread.join(3)
                manager.health.close()
            self.assertFalse(thread.is_alive())
            self.assertFalse(Catalog(paths).state['enabled'])
            self.assertEqual(engine.starts, 0)

    def test_subscription_cannot_choose_a_native_network_namespace(self):
        outbound = parse_uri(URI)['outbound']
        outbound['netns'] = '/proc/1/ns/net'
        with self.assertRaises(AppError):
            validate_outbound(outbound)

    def test_other_vpn_failure_does_not_queue_a_future_tunnel_start(self):
        with tempfile.TemporaryDirectory(prefix='p10-connection-') as temporary:
            paths = Paths(base=temporary)
            engine = FakeEngine()
            engine.guard = mock.Mock(side_effect=AppError('Другой VPN уже работает.'))
            manager = Manager(paths, ROOT, engine)
            manager.uri({'uri': URI})
            with self.assertRaises(AppError):
                manager.on({})
            self.assertFalse(Catalog(paths).state['enabled'])
            self.assertIsNone(engine.process)


if __name__ == '__main__':
    unittest.main()
