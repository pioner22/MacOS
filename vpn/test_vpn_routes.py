# -*- coding: utf-8 -*-
"""Regression tests for 2.0.2. No real macOS/network/provider is exercised.
Use Python 3: python3 -m unittest -v test_vpn_routes
"""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('vpn', ROOT / 'vpn-runtime.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
IP6 = '2606:4700:4700::1111'
NO_ROUTE = (0, ('   route to: ' + IP6 + '\n').encode(), b'route: message indicates error 3: No such process\n')
WRITE_NO_ROUTE = (0, b'', b'route: writing to routing socket: not in table\n')
BASE = {'ip': '192.0.2.1', 'at': '2026-09-20T00:00:00Z'}
NODE_URI = 'trojan://test%2Bpassword@example.com:443?security=tls&type=tcp&sni=example.com#Test'

def reply(iface='en0', flags='UP,GATEWAY,DONE,STATIC'):
    return 0, ('   route to: 1.1.1.1\ndestination: default\n  interface: %s\n      flags: <%s>\n' % (iface, flags)).encode(), b''

class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name)
        (self.p / 'private').mkdir()
        (self.p / 'releases').mkdir()
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in {
            'BASE': str(self.p), 'PRIVATE': str(self.p / 'private'),
            'CURRENT': str(self.p / 'current'), 'CONFIG': str(self.p / 'private/config.json'),
            'CATALOG': str(self.p / 'private/profiles.json'), 'ACTIVE': str(self.p / 'private/active.json'),
            'REPORT': str(self.p / 'private/report.json'), 'PLIST': str(self.p / 'private/runtime.plist')
        }.items():
            self.stack.enter_context(mock.patch.object(v, name, value))
        self.say = self.stack.enter_context(mock.patch.object(v, 'say'))
        self.node = v.parse_uri(NODE_URI)
        v.atomic_json(v.CATALOG, {'bootstrap': [self.node], 'nodes': [], 'subscription': 'https://example.com/sub'})
    def report(self):
        return v.Report('test')
    def parse(self, response):
        return v.parse_route_result(*response)
    def connect_context(self):
        stack = contextlib.ExitStack()
        for name, value in [('info',''),('assert_no_other_vpn',None),('refresh',None),
                            ('resolve_node',self.node),('probe','198.51.100.2'),('check_config',None),
                            ('write_plist',None),('alive',True),('route_interface',v.IFACE),
                            ('managed_dns_present',True),('assert_dns',None),('verify','198.51.100.2')]:
            stack.enter_context(mock.patch.object(v,name,return_value=value))
        return stack

class RouteParsing(Fixture):
    def test_kernel_esrch_exit_zero(self): self.assertEqual(self.parse(NO_ROUTE), '')
    def test_kernel_esrch_exit_one(self): self.assertEqual(self.parse((1, NO_ROUTE[1], NO_ROUTE[2])), '')
    def test_write_missing_exit_zero(self): self.assertEqual(self.parse(WRITE_NO_ROUTE), '')
    def test_write_missing_exit_one(self): self.assertEqual(self.parse((1, b'', WRITE_NO_ROUTE[2])), '')
    def test_zero_unreachable_kernel(self):
        self.assertEqual(self.parse((0,b'',b'route: message indicates error 51: Network is unreachable\n')), '')
    def test_one_unreachable_write(self):
        self.assertEqual(self.parse((1,b'',b'route: writing to routing socket: Network is unreachable\n')), '')
    def test_zero_host_unreachable(self):
        self.assertEqual(self.parse((0,b'',b'route: message indicates error 65: No route to host\n')), '')
    def test_direct_interface(self): self.assertEqual(self.parse(reply()), 'en0')
    def test_tunnel_interface(self): self.assertEqual(self.parse(reply('utun98')), 'utun98')
    def test_foreign_tunnel_preserved(self): self.assertEqual(self.parse(reply('utun3')), 'utun3')
    def test_loopback_is_not_absent(self): self.assertEqual(self.parse(reply('lo0')), 'lo0')
    def test_timeout_even_with_no_route(self):
        with self.assertRaises(v.VPNError): self.parse((124, NO_ROUTE[1], NO_ROUTE[2]))
    def test_killed_even_with_interface(self):
        with self.assertRaises(v.VPNError): self.parse((-15, reply()[1], b''))
    def test_empty_zero_is_unknown(self):
        with self.assertRaises(v.VPNError): self.parse((0,b'',b''))
    def test_only_route_to_is_unknown(self):
        with self.assertRaises(v.VPNError): self.parse((0,NO_ROUTE[1],b''))
    def test_permission_error_zero(self):
        with self.assertRaises(v.VPNError): self.parse((0,b'',b'route: message indicates error 1: Operation not permitted\n'))
    def test_permission_error_one(self):
        with self.assertRaises(v.VPNError): self.parse((1,b'',b'route: socket: Operation not permitted\n'))
    def test_unknown_warning_with_interface(self):
        with self.assertRaises(v.VPNError): self.parse((0,reply()[1],b'route: message length mismatch\n'))
    def test_nonzero_with_interface(self):
        with self.assertRaises(v.VPNError): self.parse((1,reply()[1],b''))
    def test_conflicting_absence_and_interface(self):
        with self.assertRaises(v.VPNError): self.parse((0,reply()[1],NO_ROUTE[2]))
    def test_duplicate_interfaces(self):
        with self.assertRaises(v.VPNError): self.parse((0,b'interface: en0\ninterface: utun98\n',b''))
    def test_invalid_interface_character(self):
        with self.assertRaises(v.VPNError): self.parse((0,b'interface: utun98;foo\n',b''))
    def test_no_route_substring_is_not_enough(self):
        with self.assertRaises(v.VPNError): self.parse((0,b'',b'unknown problem, not in table perhaps\n'))
    def test_missing_plus_other_error_not_hidden(self):
        with self.assertRaises(v.VPNError): self.parse((0,b'',NO_ROUTE[2]+b'route: other failure\n'))
    def test_reject_not_forwarding(self):
        with self.assertRaises(v.VPNError): self.parse(reply('utun98','UP,REJECT'))
    def test_blackhole_not_forwarding(self):
        with self.assertRaises(v.VPNError): self.parse(reply('utun98','UP,BLACKHOLE'))
    def test_error_saves_bounded_private_diagnostic(self):
        with mock.patch.object(v,'run',return_value=(0,b'route to: '+b'x'*8000,b'UNKNOWN')):
            with self.assertRaises(v.VPNError) as e: v.route_interface(IP6, True)
        d = self.p/'private/route-diagnostic.json'
        data = json.loads(d.read_text())
        self.assertEqual(data['returncode'],0)
        self.assertEqual(data['stderr'],'UNKNOWN')
        self.assertLessEqual(len(data['stdout']),4096)
        self.assertEqual(d.stat().st_mode & 0o777,0o600)
        self.assertIn('UNKNOWN', data['stderr'])
        self.assertIn('route=0',str(e.exception))
    def test_diagnostic_write_failure_keeps_route_error(self):
        with mock.patch.object(v,'run',return_value=(0,b'',b'failure')), mock.patch.object(v,'atomic_json',side_effect=OSError('disk')):
            with self.assertRaises(v.VPNError) as e: v.route_interface(IP6,True)
        self.assertIn('route=0',str(e.exception))
    def test_valid_absence_not_reported_as_failure(self):
        with mock.patch.object(v,'run',return_value=NO_ROUTE): self.assertEqual(v.route_interface(IP6,True),'')
        self.assertFalse((self.p/'private/route-diagnostic.json').exists())
    def test_invalid_address_not_passed_to_command(self):
        with mock.patch.object(v,'run') as run:
            with self.assertRaises(v.VPNError): v.route_interface('not an ip')
        run.assert_not_called()

class NetworkPhases(Fixture):
    def preflight_run(self,args,**kwargs):
        if args[0]=='/sbin/route': return NO_ROUTE if '-inet6' in args else reply('en0')
        if args[0]=='/sbin/ifconfig': return (1,b'',b'ifconfig: interface utun98 does not exist\n')
        raise AssertionError(args)
    def test_ipv4_only_preflight_can_continue(self):
        with mock.patch.object(v,'run',side_effect=self.preflight_run), mock.patch.object(v,'github_check'), mock.patch.object(v,'public_ip',return_value=('192.0.2.1',{})):
            base = v.baseline(self.report())
        self.assertEqual(base['ip'],'192.0.2.1')
        self.assertEqual(base['interface'],'en0')
    def test_postconnect_ipv6_absence_still_fails(self):
        with mock.patch.object(v,'alive',return_value=True), mock.patch.object(v,'interface_state',return_value=b'utun98: flags=8051<UP>\n'), mock.patch.object(v,'run',side_effect=lambda args,**kw: NO_ROUTE if '-inet6' in args else reply('utun98')):
            with self.assertRaises(v.VPNError): v.assert_routes()
    def test_postconnect_ipv6_direct_still_fails(self):
        with mock.patch.object(v,'alive',return_value=True), mock.patch.object(v,'interface_state',return_value=b'utun98: flags=8051<UP>\n'), mock.patch.object(v,'run',side_effect=lambda args,**kw: reply('en0' if '-inet6' in args else 'utun98')):
            with self.assertRaises(v.VPNError): v.assert_routes()
    def test_postconnect_all_routes_tunnel(self):
        with mock.patch.object(v,'alive',return_value=True), mock.patch.object(v,'interface_state',return_value=b'utun98: flags=8051<UP>\n'), mock.patch.object(v,'run',return_value=reply('utun98')):
            v.assert_routes()
    def test_stop_ipv4_only_no_false_failure(self):
        v.atomic_json(v.ACTIVE, {'name':'test'})
        with mock.patch.object(v,'info',return_value=''), mock.patch.object(v,'interface_state',return_value=None), mock.patch.object(v,'dns_cleanup_complete',return_value=True), mock.patch.object(v,'run',side_effect=self.preflight_run):
            v.stop()
        self.assertFalse(Path(v.ACTIVE).exists())
    def test_foreign_vpn_is_not_ignored(self):
        with mock.patch.object(v,'run',return_value=reply('utun3')):
            with self.assertRaises(v.VPNError): v.assert_no_other_vpn()
    def test_unknown_ipv6_preflight_stays_error(self):
        with mock.patch.object(v,'run',side_effect=lambda args,**kw:(0,b'',b'') if '-inet6' in args else reply()):
            with self.assertRaises(v.VPNError): v.assert_no_other_vpn()
    def test_no_ready_message_on_missing_post_v6(self):
        r=self.report()
        with mock.patch.object(v,'check_config'), mock.patch.object(v,'assert_routes',side_effect=v.VPNError('IPv6 missing')):
            with self.assertRaises(v.VPNError): v.verify(BASE,r)
        self.assertEqual(r.data['overall'],'RUNNING')
        self.assertFalse(any('ГОТОВО:' in str(x) for x in self.say.call_args_list))

class Startup(Fixture):
    def test_supervisor_errors_go_to_log_not_devnull(self):
        v.write_plist()
        data=plistlib.loads(Path(v.PLIST).read_bytes())
        self.assertEqual(data['StandardOutPath'],str(self.p/'private/startup.log'))
        self.assertEqual(data['StandardOutPath'],data['StandardErrorPath'])
        self.assertEqual(data['HardResourceLimits']['FileSize'],v.LIMIT)
        self.assertFalse(data['KeepAlive'])
    def test_startup_timeout_explicit_and_rollback(self):
        r=self.report()
        with self.connect_context(), mock.patch.object(v,'run',return_value=(0,b'',b'')), mock.patch.object(v,'CLOCK',side_effect=[0,31]), mock.patch.object(v,'rollback_new') as rollback, mock.patch.object(v,'assert_dns') as dns:
            with self.assertRaises(v.VPNError) as e: v.connect(BASE,r)
        self.assertIn('не стали готовы',str(e.exception))
        rollback.assert_called_once_with(r)
        dns.assert_not_called()
        self.assertFalse(Path(v.ACTIVE).exists())
    def test_success_requires_ready_dns_and_verify(self):
        with self.connect_context(), mock.patch.object(v,'run',return_value=(0,b'',b'')), mock.patch.object(v,'managed_dns_present',side_effect=[False,True]), mock.patch.object(v.time,'sleep'):
            self.assertEqual(v.connect(BASE,self.report()),'198.51.100.2')
        self.assertEqual(v.read_json(v.ACTIVE)['baseline'],BASE)
    def test_failed_verify_rolls_back(self):
        with self.connect_context(), mock.patch.object(v,'run',return_value=(0,b'',b'')), mock.patch.object(v,'verify',side_effect=v.VPNError('failed')), mock.patch.object(v,'rollback_new') as rb:
            with self.assertRaises(v.VPNError): v.connect(BASE,self.report())
        rb.assert_called_once()
    def test_core_stopped_before_dns_is_released(self):
        events=[]; process=mock.Mock();process.poll.return_value=1;session=mock.Mock()
        session.close.side_effect=lambda:events.append('dns-close')
        with mock.patch.object(v,'check_install'),mock.patch.object(v,'TemporaryDNS',return_value=session),mock.patch.object(v.subprocess,'Popen',return_value=process),mock.patch.object(v,'interface_state',return_value=b'utun98'),mock.patch.object(v,'install_temporary_dns'),mock.patch.object(v,'stop_service_child',side_effect=lambda p:events.append('core-stop')):
            with self.assertRaises(v.VPNError):v.serve()
        self.assertEqual(events,['core-stop','dns-close'])
    def test_dns_close_attempted_even_if_child_stop_fails(self):
        process=mock.Mock();process.poll.return_value=1;session=mock.Mock()
        with mock.patch.object(v,'check_install'),mock.patch.object(v,'TemporaryDNS',return_value=session),mock.patch.object(v.subprocess,'Popen',return_value=process),mock.patch.object(v,'interface_state',return_value=b'utun98'),mock.patch.object(v,'install_temporary_dns'),mock.patch.object(v,'stop_service_child',side_effect=OSError('stop')):
            with self.assertRaises(OSError):v.serve()
        session.close.assert_called_once()
    def test_cli_still_valid_bash(self):
        path=self.p/'cli.sh';path.write_text(v.CLI)
        subprocess.run(['/bin/bash','-n',str(path)],check=True)

class RetainedBehaviour(Fixture):
    def test_trojan_utf8_percent_strict(self):
        self.assertEqual(self.node['outbound']['password'],'test+password')
        with self.assertRaises(v.VPNError):v.parse_uri(NODE_URI.replace('%2B','%FF'))
    def test_config_has_no_direct_fallback(self):
        data=v.make_config(self.node,'test',True)
        self.assertEqual([n['tag'] for n in data['outbounds']],['proxy'])
        self.assertEqual(data['dns']['servers'][0]['detour'],'proxy')
        self.assertEqual(len(data['inbounds'][0]['address']),2)
    def test_plaintext_transport_rejected(self):
        with self.assertRaises(v.VPNError):v.parse_uri(NODE_URI.replace('security=tls','security=none'))
    def test_atomic_json_private(self):
        self.assertEqual(Path(v.CATALOG).stat().st_mode&0o777,0o600)
    def test_real_large_stdin_timeout(self):
        rc,_,_=v.run(['/bin/sleep','3'],data=b'x'*200000,timeout=0.1)
        self.assertEqual(rc,124)
    def test_real_process_io(self):
        rc,out,_=v.run(['/bin/cat'],data=b'hello')
        self.assertEqual((rc,out),(0,b'hello'))
    def test_verify_unchanged_ip_fails(self):
        with mock.patch.object(v,'check_config'),mock.patch.object(v,'assert_routes'),mock.patch.object(v,'assert_dns'),mock.patch.object(v,'github_check',return_value={'peer':'1.1.1.1'}),mock.patch.object(v,'public_ip',return_value=(BASE['ip'],{'peer':'1.1.1.1'})),mock.patch.object(v,'route_interface',return_value=v.IFACE):
            with self.assertRaises(v.VPNError):v.verify(BASE,self.report())
    def test_no_unconditional_ready_on_speed_failure(self):
        r=self.report();v.atomic_json(v.ACTIVE,{'name':'Test'})
        with mock.patch.object(v,'speed',side_effect=lambda r:r.mark('SPEED','WARN','unavailable')),mock.patch.object(v,'verify',return_value='198.51.100.2'):
            self.assertEqual(v.finish_connected(BASE,r),2)
        self.assertEqual(r.data['overall'],'READY_WITH_WARNINGS')

if __name__=='__main__':
    unittest.main(verbosity=2)
