import copy
import json
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import Paths, load_settings, private_directory
from tui_vpn.health_checks import HealthChecks
from tui_vpn.probe_runtime import NativeProbe, check_node, prepare_nodes, result
from tui_vpn.profiles import assign_ids, parse_uri
from test_data import URI


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='p10-probes-')
        self.addCleanup(self.temporary.cleanup)
        self.paths = Paths(base=self.temporary.name)
        private_directory(self.paths.private)
        self.settings = load_settings(ROOT)
        self.node = assign_ids([parse_uri(URI)], 'a' * 32)[0]
        self.checks = HealthChecks(self.paths, ROOT, self.settings)
        self.addCleanup(self.checks.close)

    def received(self, **values):
        data = dict(result(self.node['id'], 'ok', 'direct:en0', 12), **values)
        self.checks._accept(json.dumps(data), {self.node['id']: self.node}, self.checks.generation)

    def test_http_success_with_zero_latency_is_still_a_real_success(self):
        probe = mock.Mock()
        probe.delay.return_value = 0
        outcome = check_node(probe, self.node['id'], ['node'], self.settings, 'direct:en0')
        self.assertEqual((outcome['state'], outcome['delay_ms']), ('ok', 0))

    def test_refused_connection_never_becomes_zero_latency_success(self):
        probe = mock.Mock()
        probe.delay.side_effect = OSError('synthetic denied')
        outcome = check_node(probe, self.node['id'], ['node'], self.settings, 'direct:en0')
        self.assertEqual(outcome['state'], 'failed')
        self.assertIsNone(outcome['delay_ms'])

    def test_cache_expires_even_when_monotonic_clock_did_not_advance_during_sleep(self):
        self.received()
        record = self.checks.records[self.node['id']]
        record['observed'] = 100
        record['value']['checked_at'] = 1000
        with mock.patch('tui_vpn.health_checks.time.monotonic', return_value=101), \
                mock.patch('tui_vpn.health_checks.time.time', return_value=5000):
            values, _meta = self.checks.snapshot([self.node])
        self.assertEqual(values[self.node['id']]['state'], 'stale')
        self.assertIsNone(values[self.node['id']]['delay_ms'])

    def test_changed_credentials_invalidate_even_an_unchanged_node_id(self):
        self.received()
        changed = copy.deepcopy(self.node)
        changed['outbound']['password'] = 'changed-private-fixture'
        self.assertEqual(self.checks.snapshot([changed])[0][changed['id']]['state'], 'unknown')
        self.checks.invalidate([changed])
        self.assertNotIn(changed['id'], self.checks.records)

    def test_cancelled_generation_cannot_publish_a_late_green_result(self):
        old = self.checks.generation
        self.checks.cancel()
        self.checks._accept(json.dumps(result(self.node['id'], 'ok', 'current', 1)),
                            {self.node['id']: self.node}, old)
        self.assertEqual(self.checks.snapshot([self.node])[0][self.node['id']]['state'], 'unknown')

    def test_public_snapshot_does_not_include_credentials_or_fingerprints(self):
        self.received()
        text = json.dumps(self.checks.snapshot([self.node]))
        for forbidden in ('synthetic-password', 'fingerprint', 'outbound'):
            self.assertNotIn(forbidden, text)

    def test_unsupported_or_sensitive_helper_output_is_rejected(self):
        for changed in ({'delay_ms': True}, {'path': 'http://private-url'},
                        {'error': 'raw-secret-from-an-exception'}, {'id': 'unknown'}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                self.received(**changed)

    def test_only_one_batch_can_start_and_repeated_clicks_are_bounded(self):
        with mock.patch('tui_vpn.health_checks.threading.Thread') as thread:
            self.assertTrue(self.checks.start([self.node]))
            self.assertFalse(self.checks.start([self.node]))
            self.assertEqual(thread.call_count, 1)
            self.checks.cancel()
            self.assertFalse(self.checks.start([self.node]))

    def test_hung_helper_is_stopped_and_private_scratch_is_removed(self):
        original_popen, processes = subprocess.Popen, []
        script = ('import sys,json,time\n'
                  'data=json.load(sys.stdin)\n'
                  'print(json.dumps({"id":data["nodes"][0]["id"],"state":"ok",'
                  '"delay_ms":1,"path":"current","error":""}),flush=True)\n'
                  'time.sleep(30)\n')
        def fake_worker(_args, **kwargs):
            process = original_popen([sys.executable, '-B', '-c', script], **kwargs)
            processes.append(process)
            return process
        self.checks.settings = dict(self.settings, probe_batch_timeout=0.3)
        with mock.patch('tui_vpn.health_checks.subprocess.Popen', side_effect=fake_worker):
            self.assertTrue(self.checks.start([self.node]))
            self.checks.thread.join(5)
        self.assertFalse(self.checks.thread.is_alive())
        self.assertIsNotNone(processes[0].poll())
        self.assertFalse(self.checks.running)
        self.assertNotEqual(self.checks.snapshot([self.node])[0][self.node['id']]['state'], 'checking')
        self.assertEqual(list(self.paths.private.glob('probe-*')), [])

    def test_downloaded_private_targets_are_blocked_before_native_start(self):
        node = dict(self.node, outbound={'type': 'socks', 'server': '127.0.0.1', 'server_port': 8080})
        observed = []
        outbounds, tags = prepare_nodes([node], 'en0', 6000, observed.append)
        self.assertEqual((outbounds, tags), ([], {}))
        self.assertEqual(observed[0]['state'], 'blocked')

    def test_explicit_manual_loopback_socks_has_no_physical_interface_binding(self):
        node = dict(self.node, _manual_socks=True,
                    outbound={'type': 'socks', 'server': '127.0.0.1', 'server_port': 1080})
        outbounds, tags = prepare_nodes([node], 'en0', 6000, self.fail)
        self.assertNotIn('bind_interface', outbounds[0])
        self.assertEqual(tags[node['id']]['path'], 'local')

    def test_link_local_metadata_address_is_blocked_even_for_manual_socks(self):
        node = dict(self.node, _manual_socks=True,
                    outbound={'type': 'socks', 'server': '169.254.169.254', 'server_port': 80})
        observed = []
        self.assertFalse(prepare_nodes([node], '', 6000, observed.append)[0])
        self.assertEqual(observed[0]['state'], 'blocked')

    def test_resolved_ip_is_frozen_while_tls_identity_is_preserved(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))]
        with mock.patch('tui_vpn.probe_runtime.socket.getaddrinfo', return_value=answers) as resolve:
            outbounds, _ = prepare_nodes([self.node], 'en0', 6000, self.fail)
        resolve.assert_called_once()
        self.assertEqual(outbounds[0]['server'], '93.184.216.34')
        self.assertEqual(outbounds[0]['tls']['server_name'], self.node['outbound']['tls']['server_name'])
        self.assertEqual(outbounds[0]['bind_interface'], 'en0')

    def test_mixed_public_and_private_dns_answer_is_not_partially_trusted(self):
        answers = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443))
                   for address in ('93.184.216.34', '127.0.0.1')]
        observed = []
        with mock.patch('tui_vpn.probe_runtime.socket.getaddrinfo', return_value=answers):
            outbounds, _ = prepare_nodes([self.node], 'en0', 6000, observed.append)
        self.assertEqual(outbounds, [])
        self.assertEqual(observed[0]['state'], 'blocked')

    def test_native_probe_has_no_tun_dns_changes_or_public_listener(self):
        probe = NativeProbe(Path('/unused-test-core'), self.paths.private,
                            [{'type': 'socks', 'server': '127.0.0.1', 'server_port': 1080, 'tag': 'fixture'}])
        self.assertEqual(probe.config['inbounds'], [])
        self.assertNotIn('dns', probe.config)
        self.assertNotIn('auto_route', json.dumps(probe.config))
        api = probe.config['experimental']['clash_api']
        self.assertTrue(api['external_controller'].startswith('127.0.0.1:'))
        self.assertGreaterEqual(len(api['secret']), 32)


if __name__ == '__main__':
    unittest.main()
