#!/usr/bin/env python3
"""Offline lifecycle regressions: mock network/launchd; never touch a real VPN."""
import contextlib
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vpn-runtime.py'
spec = importlib.util.spec_from_file_location('vpn_reconnect_runtime', str(SOURCE))
vpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn)


class SetupReconnectTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.report = mock.Mock()
        self.report.data = {}
        self.profile = {'schema': 'test-data-only'}
        self.base = {'ip': '192.0.2.1', 'at': 'fresh-baseline'}
        self.installed = {'version': vpn.VERSION,
                          'hashes': {'vpn-runtime.py': 'runtime-digest'},
                          'profile_sha256': 'profile-digest'}
        self.mocks = {}
        def install_mock(name, result=None):
            def callback(*args, **kwargs):
                self.events.append(name)
                return result
            m = self.stack.enter_context(mock.patch.object(vpn, name, side_effect=callback))
            self.mocks[name] = m
            return m
        install_mock('read_json', self.profile)
        install_mock('validate_profile', {})
        install_mock('check_activation_paths', '/unused/vpn-bigsur')
        install_mock('check_install', self.installed)
        install_mock('info', 'pid = 1')
        # These mocks deliberately simulate a healthy, previously verified VPN.
        install_mock('alive', True)
        self.stack.enter_context(mock.patch.object(vpn.os.path, 'isfile', return_value=True))
        self.stack.enter_context(mock.patch.object(vpn, 'digest', side_effect=lambda p:
            'profile-digest' if p == '/unused/profile.json' else 'runtime-digest'))
        install_mock('baseline', self.base)
        install_mock('github_check', {})
        install_mock('stage_install', ('/unused/stage', {}, {}, {}))
        install_mock('stop')
        install_mock('activate_install')
        install_mock('connect', '198.51.100.2')
        install_mock('verify', '198.51.100.2')
        install_mock('finish_connected', 0)
        install_mock('rollback_new')
        self.stack.enter_context(mock.patch.object(vpn.os.path, 'isdir', return_value=True))
        self.cleanup = self.stack.enter_context(mock.patch.object(vpn.shutil, 'rmtree'))

    def run_setup(self):
        return vpn.setup('/unused/profile.json', self.report)

    def upgrade(self):
        self.installed['version'] = '2.0.2'

    def inject_failure(self, name, error=None):
        if error is None:
            error = vpn.VPNError('injected failure')
        def callback(*args, **kwargs):
            self.events.append(name)
            raise error
        self.mocks[name].side_effect = callback

    def test_same_version_active_session_is_recreated(self):
        self.assertEqual(self.run_setup(), 0)
        self.mocks['stop'].assert_called_once_with()
        self.mocks['baseline'].assert_called_once_with(self.report)
        self.mocks['connect'].assert_called_once_with(self.base, self.report)
        self.assertLess(self.events.index('stop'), self.events.index('baseline'))
        self.assertLess(self.events.index('baseline'), self.events.index('connect'))
        self.mocks['stage_install'].assert_not_called()
        self.mocks['activate_install'].assert_not_called()
        self.mocks['verify'].assert_not_called()  # no old fast-path verification
        self.mocks['read_json'].assert_called_once_with('/unused/profile.json')

    def test_same_version_offline_session_is_connected(self):
        self.mocks['info'].side_effect = None
        self.mocks['info'].return_value = ''
        self.assertEqual(self.run_setup(), 0)
        self.mocks['stop'].assert_not_called()
        self.mocks['connect'].assert_called_once_with(self.base, self.report)
        self.mocks['stage_install'].assert_not_called()

    def test_update_stages_before_stop_then_reconnects(self):
        self.upgrade()
        self.assertEqual(self.run_setup(), 0)
        self.assertLess(self.events.index('stage_install'), self.events.index('stop'))
        self.assertLess(self.events.index('stop'), self.events.index('baseline'))
        self.assertLess(self.events.index('activate_install'), self.events.index('connect'))
        self.cleanup.assert_not_called()

    def test_fresh_install_has_no_stop(self):
        self.inject_failure('check_install')
        self.mocks['check_install'].side_effect = [vpn.VPNError('not installed'), self.installed]
        self.mocks['info'].side_effect = None
        self.mocks['info'].return_value = ''
        self.assertEqual(self.run_setup(), 0)
        self.mocks['stop'].assert_not_called()
        self.mocks['stage_install'].assert_called_once()
        self.mocks['activate_install'].assert_called_once()
        self.mocks['connect'].assert_called_once()

    def test_staging_failure_leaves_old_tunnel_untouched(self):
        self.upgrade()
        self.inject_failure('stage_install')
        with self.assertRaises(vpn.VPNError):
            self.run_setup()
        self.mocks['stop'].assert_not_called()
        self.mocks['connect'].assert_not_called()

    def test_path_preflight_failure_does_not_touch_network(self):
        self.inject_failure('check_activation_paths')
        with self.assertRaises(vpn.VPNError):
            self.run_setup()
        for name in ('info', 'stop', 'baseline', 'stage_install', 'connect'):
            self.mocks[name].assert_not_called()

    def test_invalid_profile_does_not_reconnect(self):
        self.inject_failure('validate_profile')
        with self.assertRaises(vpn.VPNError):
            self.run_setup()
        self.mocks['stop'].assert_not_called()
        self.mocks['check_activation_paths'].assert_not_called()

    def test_stop_failure_aborts_activation(self):
        self.upgrade()
        self.inject_failure('stop')
        with self.assertRaises(vpn.VPNError):
            self.run_setup()
        self.mocks['activate_install'].assert_not_called()
        self.mocks['connect'].assert_not_called()
        self.cleanup.assert_called_once_with('/unused/stage')

    def test_failed_fresh_baseline_does_not_start_new_tunnel(self):
        self.upgrade()
        self.inject_failure('baseline')
        with self.assertRaises(vpn.VPNError):
            self.run_setup()
        self.mocks['connect'].assert_not_called()
        self.cleanup.assert_called_once_with('/unused/stage')

    def test_failed_final_verification_rolls_back_new_tunnel(self):
        self.inject_failure('finish_connected')
        with self.assertRaises(vpn.VPNError):
            self.run_setup()
        self.mocks['rollback_new'].assert_called_once_with(self.report)

    def test_interrupted_final_verification_rolls_back(self):
        self.inject_failure('finish_connected', KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            self.run_setup()
        self.mocks['rollback_new'].assert_called_once_with(self.report)

    def test_success_with_warnings_preserves_connected_result(self):
        self.mocks['finish_connected'].side_effect = None
        self.mocks['finish_connected'].return_value = 2
        self.assertEqual(self.run_setup(), 2)
        self.mocks['connect'].assert_called_once()
        self.mocks['rollback_new'].assert_not_called()


class CandidateTests(unittest.TestCase):
    def test_preferred_first_and_duplicates_removed(self):
        a, b = {'id': 'a'}, {'id': 'b'}
        state = {'nodes': [a, b, a], 'bootstrap': [b, a], 'preferred': 'b'}
        self.assertEqual(vpn.candidates(state), [b, a])

    def test_bounded_stable_order(self):
        nodes = [{'id': str(i)} for i in range(20)]
        state = {'nodes': nodes, 'bootstrap': nodes[10:18], 'preferred': '19'}
        self.assertEqual([n['id'] for n in vpn.candidates(state)],
                         ['19', '0', '1', '2', '3', '4', '5', '10', '11'])
        self.assertEqual(len(state['nodes']), 20)

    def test_no_nodes(self):
        self.assertEqual(vpn.candidates({}), [])


class BootstrapTests(unittest.TestCase):
    def test_shell_syntax(self):
        p = subprocess.run(['/bin/bash', '-n', str(ROOT / 'vpn.sh')], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_pinned_runtime_is_this_exact_source(self):
        bootstrap = (ROOT / 'vpn.sh').read_text()
        expected = re.search(r'local runtime_sha=([0-9a-f]{64})', bootstrap).group(1)
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), expected)

if __name__ == '__main__':
    unittest.main(verbosity=2)
