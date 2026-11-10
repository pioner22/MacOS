import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import AppError
from tui_vpn import darwin_services as services
from tui_vpn import service_readiness as readiness


def result(code=0, stdout=b'', stderr=b''):
    return subprocess.CompletedProcess([], code, stdout, stderr)


class DarwinServiceTests(unittest.TestCase):
    def host(self, responses):
        paths = SimpleNamespace(label='ru.pioner22.tui-vpn', unit=Path('/fixture/daemon.plist'))
        return SimpleNamespace(paths=paths, command=mock.Mock(side_effect=responses))

    def test_stop_waits_for_the_old_process_after_the_job_label_disappears(self):
        host = self.host([result(0, b'\tpid = 12345\n'), result(), result(113), result(113)])
        with mock.patch.object(services, 'process_alive', side_effect=[True, False]) as alive, \
                mock.patch.object(services.time, 'monotonic', side_effect=[0, 1]), \
                mock.patch.object(services.time, 'sleep') as sleep:
            services.stop_darwin(host)
        self.assertEqual(alive.call_count, 2)
        sleep.assert_called_once()
        self.assertEqual(host.command.call_args_list[1].args[0][1], 'bootout')

    def test_absent_job_does_not_probe_an_unrelated_process(self):
        host = self.host([result(113), result(113), result(113)])
        with mock.patch.object(services.os, 'kill') as kill:
            services.stop_darwin(host)
        kill.assert_not_called()

    def test_uncertain_bootout_reply_still_requires_observed_process_termination(self):
        replies = iter([result(0, b'pid = 12345\n'), result(5), result(113)])
        host = self.host(None)
        def command(_args, allowed):
            reply = next(replies)
            if reply.returncode not in allowed:
                raise AppError('native command returned an unaccepted status')
            return reply
        host.command.side_effect = command
        with mock.patch.object(services, 'process_alive', return_value=False) as alive:
            services.stop_darwin(host)
        alive.assert_called_once_with(12345)

    def test_unfinished_shutdown_is_not_reported_as_a_success(self):
        host = self.host([result(0, b'pid = 12345\n'), result(), result(113)])
        with mock.patch.object(services, 'process_alive', return_value=True), \
                mock.patch.object(services.time, 'monotonic', side_effect=[0, 36]):
            with self.assertRaises(AppError):
                services.stop_darwin(host)

    def test_uncertain_bootstrap_result_is_observed_before_any_repeat(self):
        host = self.host([result(113), result(5, stderr=b'bootstrap reply lost'), result(0)])
        with mock.patch.object(services.time, 'sleep'):
            self.assertTrue(services.start_darwin(host))
        operations = [call.args[0][1] for call in host.command.call_args_list]
        self.assertEqual(operations, ['print', 'bootstrap', 'print'])

    def test_bootstrap_retries_are_bounded_when_the_job_remains_absent(self):
        host = self.host(None)
        host.command.side_effect = lambda args, _allowed: result(113) if args[1] == 'print' else result(5, stderr=b'busy')
        with mock.patch.object(services.time, 'sleep'):
            with self.assertRaises(AppError):
                services.start_darwin(host)
        attempts = sum(call.args[0][1] == 'bootstrap' for call in host.command.call_args_list)
        self.assertLessEqual(attempts, 6)

    def test_permanent_bootstrap_error_is_not_retried(self):
        host = self.host([result(113), result(78, stderr=b'invalid job')])
        with self.assertRaises(AppError):
            services.start_darwin(host)
        self.assertEqual(host.command.call_count, 2)


class ServiceReadinessTests(unittest.TestCase):
    def status(self, enabled=False, state='OFF'):
        return {'source_sha256': 'a' * 64, 'stale': False, 'enabled': enabled, 'state': state}

    def test_manual_off_requires_a_fresh_matching_controller_without_network_activation(self):
        with mock.patch.object(readiness, 'request') as request:
            self.assertTrue(readiness.installation_ready(None, self.status(), 'a' * 64))
            self.assertFalse(readiness.installation_ready(None, self.status(), 'b' * 64))
        request.assert_not_called()

    def test_requested_on_requires_an_actual_route_and_https_test(self):
        status = self.status(True, 'RUNNING')
        with mock.patch.object(readiness, 'request', return_value={'test': {'ipv4': '198.51.100.77'}}) as request:
            self.assertTrue(readiness.installation_ready(None, status, 'a' * 64))
        request.assert_called_once_with('test', paths=None, timeout=20)
        with mock.patch.object(readiness, 'request', side_effect=AppError('no route')):
            self.assertFalse(readiness.installation_ready(None, status, 'a' * 64))

    def test_retrying_stale_or_malformed_status_is_not_ready(self):
        variants = [self.status(True, 'RETRYING'), dict(self.status(), stale=True),
                    dict(self.status(), enabled='false'), dict(self.status(), enabled=None)]
        with mock.patch.object(readiness, 'request') as request:
            for status in variants:
                self.assertFalse(readiness.installation_ready(None, status, 'a' * 64))
        request.assert_not_called()
