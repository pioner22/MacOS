"""Regression tests for the 2.0.1 audit. No real VPN/provider connections.
SystemConfiguration/launchd/routing are mocked here; test_vpn_native.py is separate.
"""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import time
import unittest
from unittest import mock
import test_vpn_runtime as original

v = original.v


def question(name=b'ifconfig.me'):
    return b''.join(bytes([len(part)]) + part for part in name.split(b'.')) + b'\0'


def answer(records=None, flags=0x8180, name=b'ifconfig.me', count=None):
    if records is None:
        records = [b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + b'\xc0\x00\x02\x01']
    return b'ID' + struct.pack('!HHHHH', flags, 1, len(records) if count is None else count, 0, 0) + question(name) + b'\0\1\0\1' + b''.join(records)


class Status(original.Fixture):
    def test_launchctl_timeout_is_unknown_not_absent(self):
        with mock.patch.object(v, 'run', return_value=(124, b'', b'')), self.assertRaises(v.VPNError):
            v.info()

    def test_launchctl_permission_failure_is_unknown(self):
        with mock.patch.object(v, 'run', return_value=(1, b'', b'Operation not permitted')), self.assertRaises(v.VPNError):
            v.info()

    def test_empty_success_is_not_absent(self):
        with mock.patch.object(v, 'run', return_value=(0, b'', b'')), self.assertRaises(v.VPNError):
            v.info()

    def test_real_missing_service_is_absent(self):
        msg = ('Could not find service "%s" in domain for system' % v.LABEL).encode()
        for code in (3, 113):
            with mock.patch.object(v, 'run', return_value=(code, b'', msg)):
                self.assertEqual(v.info(), '')

    def test_other_missing_service_not_ours(self):
        with mock.patch.object(v, 'run', return_value=(113, b'', b'Could not find service "other"')), self.assertRaises(v.VPNError):
            v.info()

    def test_launchctl_pid_exact(self):
        with mock.patch.object(v, 'run', return_value=(0, b'system/test = {\n  pid = 123\n}\n', b'')):
            self.assertTrue(v.alive())

    def test_ifconfig_timeout_is_not_absence(self):
        with mock.patch.object(v, 'run', return_value=(124, b'', b'')), self.assertRaises(v.VPNError):
            v.interface_state()

    def test_ifconfig_real_missing(self):
        with mock.patch.object(v, 'run', return_value=(1, b'', b'ifconfig: interface utun98 does not exist')):
            self.assertIsNone(v.interface_state())

    def test_wrong_interface_response_rejected(self):
        with mock.patch.object(v, 'run', return_value=(0, b'utun980: flags=8051<UP>\n', b'')), self.assertRaises(v.VPNError):
            v.interface_state()

    def test_route_timeout_is_not_absence(self):
        with mock.patch.object(v, 'run', return_value=(124, b'', b'')), self.assertRaises(v.VPNError):
            v.route_interface('1.1.1.1')

    def test_missing_route_is_distinct(self):
        with mock.patch.object(v, 'run', return_value=(1, b'', b'route: writing to routing socket: not in table')):
            self.assertEqual(v.route_interface('1.1.1.1'), '')

    def test_invalid_route_ip_does_not_execute(self):
        with mock.patch.object(v, 'run') as run, self.assertRaises(v.VPNError):
            v.route_interface('not-an-address')
        run.assert_not_called()

    def test_stop_unknown_not_success(self):
        with mock.patch.object(v, 'info', side_effect=v.VPNError('unknown')), self.assertRaises(v.VPNError):
            v.stop()

    def test_stop_checks_dns_cleanup(self):
        v.atomic_json(v.ACTIVE, {'name': 'old'})
        with mock.patch.object(v, 'info', return_value=''), mock.patch.object(v, 'interface_state', return_value=None), mock.patch.object(v, 'dns_cleanup_complete', return_value=True) as dns, mock.patch.object(v, 'route_interface', return_value='en0'):
            v.stop()
        dns.assert_called_once()
        self.assertFalse(Path(v.ACTIVE).exists())

    def test_ifconfig_up_is_flag_not_substring(self):
        with mock.patch.object(v, 'alive', return_value=True), mock.patch.object(v, 'interface_state', return_value=b'utun98: flags=0<NOTUP>\n'), self.assertRaises(v.VPNError):
            v.assert_routes()


class DNSMessages(original.Fixture):
    def test_real_a_response(self):
        v.validate_dns_answer(answer(), b'ID')

    def test_answer_count_without_record_rejected(self):
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer([], count=1), b'ID')

    def test_wrong_id_rejected(self):
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer(), b'NO')

    def test_wrong_question_rejected(self):
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer(name=b'elsewhere.com'), b'ID')

    def test_truncated_dns_rejected(self):
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer(flags=0x8380), b'ID')

    def test_error_rcode_rejected(self):
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer(flags=0x8183), b'ID')

    def test_wrong_a_length_rejected(self):
        record = b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 3) + b'\x01\x02\x03'
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer([record]), b'ID')

    def test_unrelated_a_rejected(self):
        record = question(b'unrelated.com') + struct.pack('!HHIH', 1, 1, 60, 4) + b'\x01\x02\x03\x04'
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer([record]), b'ID')

    def test_cname_to_a(self):
        alias = question(b'edge.example.com')
        cname = b'\xc0\x0c' + struct.pack('!HHIH', 5, 1, 60, len(alias)) + alias
        a = alias + struct.pack('!HHIH', 1, 1, 60, 4) + b'\x01\x02\x03\x04'
        v.validate_dns_answer(answer([cname, a]), b'ID')

    def test_cname_without_address_rejected(self):
        alias = question(b'edge.example.com')
        cname = b'\xc0\x0c' + struct.pack('!HHIH', 5, 1, 60, len(alias)) + alias
        with self.assertRaises(v.VPNError):
            v.validate_dns_answer(answer([cname]), b'ID')

    def test_compression_self_pointer_rejected(self):
        with self.assertRaises(v.VPNError):
            v.dns_name(b'\xc0\x00', 0)

    def test_native_resolver_exact_match(self):
        self.assertTrue(v.native_dns_registered(b'resolver #1\n  nameserver[0] : 172.29.255.2\n  if_index : 9 (utun98)\n'))

    def test_native_resolver_global_supplemental(self):
        self.assertTrue(v.native_dns_registered(b'resolver #1\n  nameserver[0] : 172.29.255.2\n  flags : Supplemental\n'))

    def test_native_resolver_wrong_interface(self):
        self.assertFalse(v.native_dns_registered(b'resolver #1\n  nameserver[0] : 172.29.255.2\n  if_index : 9 (utun980)\n'))

    def test_native_resolver_wrong_dns_address(self):
        self.assertFalse(v.native_dns_registered(b'resolver #1\n  nameserver[0] : 172.29.255.20\n  if_index : 9 (utun98)\n'))

    def test_header_forgery_in_real_assert_dns_rejected(self):
        sock = mock.Mock()
        sock.recv.return_value = answer([], count=1)
        dump = b'resolver #1\n  nameserver[0] : 172.29.255.2\n  if_index : 9 (utun98)\n'
        with mock.patch.object(v, 'run', return_value=(0, dump, b'')), mock.patch.object(v, 'managed_dns_present', return_value=True), mock.patch.object(v, 'route_interface', return_value=v.IFACE), mock.patch.object(v.os, 'urandom', return_value=b'ID'), mock.patch.object(v.socket, 'socket', return_value=sock), self.assertRaises(v.VPNError):
            v.assert_dns()
        sock.close.assert_called_once()


class Transport(original.Fixture):
    def test_invalid_utf8_not_silently_replaced(self):
        with self.assertRaises(v.VPNError):
            v.parse_uri(original.TROJAN.replace('test%2Bpassword', 'bad%ffpassword'))

    def test_api_failure_can_use_verified_raw(self):
        raw = b'test-checked-object'
        with mock.patch.object(v, 'CHECK_FALLBACK_SHA', hashlib.sha256(raw).hexdigest()), mock.patch.object(v, 'http', side_effect=[v.VPNError('API HTTP 403'), (raw, original.META)]) as http:
            self.assertEqual(v.github_check(), original.META)
        self.assertEqual(http.call_count, 2)
        self.assertEqual(http.call_args.args[0], v.CHECK_FALLBACK_URL)

    def test_raw_fallback_wrong_hash_rejected(self):
        with mock.patch.object(v, 'http', side_effect=[v.VPNError('API'), (b'wrong', original.META)]), self.assertRaises(v.VPNError):
            v.github_check()

    def test_api_success_skips_raw(self):
        with mock.patch.object(v, 'http', return_value=(b'{"current_user_url":"test"}', original.META)) as http:
            v.github_check()
        http.assert_called_once()

    def test_large_stdin_timeout_real_process(self):
        start = time.monotonic()
        rc, _, _ = v.run([sys.executable, '-c', 'import time; time.sleep(5)'], b'a' * (1024 * 1024), timeout=0.1)
        self.assertEqual(rc, 124)
        self.assertLess(time.monotonic() - start, 3)

    def test_stdin_real_echo_large(self):
        data = b'hello' * 20000
        rc, out, _ = v.run(['/bin/cat'], data=data)
        self.assertEqual((rc, out), (0, data))

    def test_negative_http_metrics_rejected(self):
        def call(args, *a, **kw):
            Path(args[args.index('-o') + 1]).write_bytes(b'ok')
            return 0, b'200\n1.1.1.1\n2\n-1\n0.1', b''
        with mock.patch.object(v, 'run', side_effect=call), self.assertRaises(v.VPNError):
            v.http('https://example.com/test')

    def test_nonfinite_size_not_overflow_crash(self):
        def call(args, *a, **kw):
            Path(args[args.index('-o') + 1]).write_bytes(b'')
            return 0, b'200\n1.1.1.1\ninf\n1\n1', b''
        with mock.patch.object(v, 'run', side_effect=call), self.assertRaises(v.VPNError):
            v.http('https://example.com/test')


class Lifecycle(original.Fixture):
    def turn_patches(self, existing=False):
        stack = contextlib.ExitStack()
        for name, value in [('alive', existing), ('info', ''), ('baseline', original.BASELINE), ('connect', '198.51.100.2')]:
            stack.enter_context(mock.patch.object(v, name, return_value=value))
        if existing:
            v.atomic_json(v.ACTIVE, {'name': 'existing', 'baseline': original.BASELINE})
        return stack

    def test_new_on_second_verify_failure_stops(self):
        with self.turn_patches(), mock.patch.object(v, 'verify', side_effect=v.VPNError('dead')), mock.patch.object(v, 'stop') as stop, self.assertRaises(v.VPNError):
            v.turn_on(self.report())
        stop.assert_called_once()

    def test_existing_on_failure_does_not_disconnect(self):
        with self.turn_patches(True), mock.patch.object(v, 'verify', side_effect=v.VPNError('dead')), mock.patch.object(v, 'stop') as stop, self.assertRaises(v.VPNError):
            v.turn_on(self.report())
        stop.assert_not_called()

    def test_new_on_record_failure_stops(self):
        with self.turn_patches(), mock.patch.object(v, 'verify', return_value='198.51.100.2'), mock.patch.object(v, 'record_verification', side_effect=OSError('disk full')), mock.patch.object(v, 'stop') as stop, self.assertRaises(OSError):
            v.turn_on(self.report())
        stop.assert_called_once()

    def test_verification_updates_timestamp(self):
        v.atomic_json(v.ACTIVE, {'name': 'test', 'verified_at': 'old', 'ip': 'old'})
        v.record_verification('198.51.100.2')
        state = v.read_json(v.ACTIVE)
        self.assertEqual(state['ip'], '198.51.100.2')
        self.assertNotEqual(state['verified_at'], 'old')

    def test_cancel_postlaunch_refresh_stops(self):
        stack = original.Workflow.connect_patches(self)
        with stack, mock.patch.object(v, 'run', return_value=(0, b'', b'')), mock.patch.object(v, 'verify', return_value='198.51.100.2'), mock.patch.object(v, 'refresh', side_effect=[None, KeyboardInterrupt()]), mock.patch.object(v, 'stop') as stop, self.assertRaises(KeyboardInterrupt):
            v.connect(original.BASELINE, self.report())
        stop.assert_called_once()

    def test_postlaunch_io_failure_stops(self):
        stack = original.Workflow.connect_patches(self)
        with stack, mock.patch.object(v, 'run', return_value=(0, b'', b'')), mock.patch.object(v, 'verify', return_value='198.51.100.2'), mock.patch.object(v, 'refresh', side_effect=[None, OSError('disk full')]), mock.patch.object(v, 'stop') as stop, self.assertRaises(OSError):
            v.connect(original.BASELINE, self.report())
        stop.assert_called_once()

    def test_failed_rollback_explicit_not_pass(self):
        report = self.report()
        with mock.patch.object(v, 'stop', side_effect=v.VPNError('unknown')):
            v.rollback_new(report)
        self.assertEqual(report.data['steps'][-1]['status'], 'FAIL')

    def test_report_write_failure_does_not_prevent_stop(self):
        report = mock.Mock()
        report.mark.side_effect = OSError('disk full')
        with mock.patch.object(v, 'stop') as stop:
            v.rollback_new(report)
        stop.assert_called_once()


class SpeedParsing(original.Fixture):
    def native(self, text):
        report = self.report()
        with mock.patch.object(v, 'assert_routes'), mock.patch.object(v.os.path, 'isfile', return_value=True), mock.patch.object(v.os, 'access', return_value=True), mock.patch.object(v, 'run', return_value=(0, text, b'')):
            v.speed(report)
        return report

    def test_two_downloads_are_not_upload_pass(self):
        report = self.native(b'Downlink capacity: 100 Mbps\nDownlink capacity: 200 Mbps')
        self.assertTrue(report.warnings())
        self.assertNotIn('speed', report.data)

    def test_malformed_numeric_output_warns(self):
        report = self.native(b'Downlink capacity: 1..2 Mbps\nUplink capacity: 20 Mbps')
        self.assertTrue(report.warnings())

    def test_units_normalized(self):
        report = self.native(b'Downlink capacity: 1.5 Gbps\nUplink capacity: 500 Kbps')
        self.assertEqual(report.data['speed']['download_mbps'], 1500)
        self.assertEqual(report.data['speed']['upload_mbps'], 0.5)

    def test_cdn_route_outside_vpn_warns(self):
        report = self.report()
        with mock.patch.object(v, 'assert_routes'), mock.patch.object(v.os.path, 'isfile', return_value=False), mock.patch.object(v, 'http', return_value=(None, original.META)), mock.patch.object(v, 'route_interface', return_value='en0'):
            v.speed(report)
        self.assertNotIn('speed', report.data)
        self.assertEqual(report.data['steps'][-1]['status'], 'WARN')


class Supervisor(original.Fixture):
    def test_only_three_own_temporary_keys(self):
        session = mock.Mock()
        v.install_temporary_dns(session)
        paths = [call.args[0] for call in session.add.call_args_list]
        self.assertEqual(paths, ['State:/Network/Service/' + v.LABEL + '/' + suffix for suffix in ('IPv4', 'IPv6', 'DNS')])
        self.assertEqual(session.add.call_args_list[-1].args[1]['ServerAddresses'], [v.DNS4, v.DNS6])

    def test_lookup_session_closed(self):
        session = mock.Mock()
        session.contains.return_value = True
        with mock.patch.object(v, 'TemporaryDNS', return_value=session):
            self.assertTrue(v.managed_dns_present())
        session.close.assert_called_once()

    def test_core_failure_closes_dns_and_reaps(self):
        session, core = mock.Mock(), mock.Mock()
        core.poll.return_value = 1
        with mock.patch.object(v, 'check_install'), mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v.subprocess, 'Popen', return_value=core), mock.patch.object(v, 'interface_state', return_value=b'utun98: flags=<UP>'), mock.patch.object(v, 'stop_service_child') as stop, self.assertRaises(v.VPNError):
            v.serve()
        session.close.assert_called_once()
        stop.assert_called_once_with(core)

    def test_native_error_stops_child(self):
        session, core = mock.Mock(), mock.Mock()
        with mock.patch.object(v, 'check_install'), mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v.subprocess, 'Popen', return_value=core), mock.patch.object(v, 'interface_state', return_value=b'utun98: flags=<UP>'), mock.patch.object(v, 'install_temporary_dns', side_effect=v.VPNError('key exists')), mock.patch.object(v, 'stop_service_child') as stop, self.assertRaises(v.VPNError):
            v.serve()
        session.close.assert_called_once()
        stop.assert_called_once_with(core)

    def test_sigterm_cleanup(self):
        session, core = mock.Mock(), mock.Mock()
        with mock.patch.object(v, 'check_install'), mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v.subprocess, 'Popen', return_value=core), mock.patch.object(v, 'interface_state', side_effect=KeyboardInterrupt()), mock.patch.object(v, 'stop_service_child') as stop:
            self.assertEqual(v.serve(), 0)
        session.close.assert_called_once()
        stop.assert_called_once_with(core)

    def test_session_close_failure_still_reaps(self):
        session, core = mock.Mock(), mock.Mock()
        session.close.side_effect = OSError('native close')
        with mock.patch.object(v, 'check_install'), mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v.subprocess, 'Popen', return_value=core), mock.patch.object(v, 'interface_state', side_effect=KeyboardInterrupt()), mock.patch.object(v, 'stop_service_child') as stop, self.assertRaises(OSError):
            v.serve()
        stop.assert_called_once_with(core)

    def test_dns_cleanup_checks_all_keys(self):
        session = mock.Mock()
        session.contains.side_effect = [False, True]
        with mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v, 'run') as run:
            self.assertFalse(v.dns_cleanup_complete())
        run.assert_not_called()
        session.close.assert_called_once()

    def test_dns_cleanup_waits_for_resolver(self):
        session = mock.Mock()
        session.contains.return_value = False
        with mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v, 'run', return_value=(0, b'nameserver[0] : 172.29.255.2\n', b'')):
            self.assertFalse(v.dns_cleanup_complete())

    def test_dns_cleanup_unknown_is_error(self):
        session = mock.Mock()
        session.contains.return_value = False
        with mock.patch.object(v, 'TemporaryDNS', return_value=session), mock.patch.object(v, 'run', return_value=(124, b'', b'')), self.assertRaises(v.VPNError):
            v.dns_cleanup_complete()

    def test_launchd_supervises_group_not_shell_background(self):
        import plistlib
        v.write_plist()
        with open(v.PLIST, 'rb') as stream:
            plist = plistlib.load(stream)
        self.assertEqual(plist['ProgramArguments'][-1], '_serve')
        self.assertEqual(plist['ProgramArguments'][0], '/usr/bin/python')
        self.assertFalse(plist['AbandonProcessGroup'])
        self.assertFalse(plist['KeepAlive'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
