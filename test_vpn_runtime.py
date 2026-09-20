"""Offline tests: real parser/process/JSON IO; macOS network operations are mocked."""
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('vpn', ROOT / 'vpn-runtime.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
VLESS = ('vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&type=tcp'
         '&encryption=none&flow=xtls-rprx-vision&fp=chrome&pbk=' + 'A'*43 + '&sid=abcd&sni=www.example.com&spx=%2F#Test')
TROJAN = 'trojan://test%2Bpassword@example.com:443?security=tls&type=tcp&sni=example.com&alpn=http%2F1.1&fp=chrome#Test'
BASELINE = {'ip': '192.0.2.1', 'at': '2026-01-01T00:00:00Z'}
META = {'peer': '1.1.1.1', 'bytes': v.CORE_BYTES, 'seconds': 2, 'bytes_per_second': 12500000}

class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = Path(self.tmp.name)
        self.p = p
        (p / 'private').mkdir()
        (p / 'releases').mkdir()
        for name, val in {'BASE': str(p), 'PRIVATE': str(p / 'private'), 'CURRENT': str(p / 'current'),
                          'CATALOG': str(p / 'private/profiles.json'), 'CONFIG': str(p / 'private/config.json'),
                          'ACTIVE': str(p / 'private/active.json'), 'REPORT': str(p / 'private/report.json'),
                          'PLIST': str(p / 'private/runtime.plist')}.items():
            patch = mock.patch.object(v, name, val); patch.start(); self.addCleanup(patch.stop)
        patch = mock.patch.object(v, 'say'); self.say = patch.start(); self.addCleanup(patch.stop)
        self.profile = {'schema': 'bigsur-vpn-profile-v2', 'subscription': 'https://example.com/sub', 'bootstrap': [TROJAN,VLESS]}
        self.state = v.validate_profile(self.profile)
        v.atomic_json(v.CATALOG, self.state)
        self.profile_path = str(p / 'input-profile.json')
        v.atomic_json(self.profile_path, self.profile)
    def report(self):
        return v.Report('test')
    def verify_mocks(self, ip='198.51.100.2'):
        stack = contextlib.ExitStack()
        for name, retval in [('check_config', None), ('assert_routes',None), ('assert_dns',None),
                             ('github_check',META), ('public_ip',(ip,META)), ('route_interface',v.IFACE)]:
            stack.enter_context(mock.patch.object(v, name, return_value=retval))
        return stack

class Parser(Fixture):
    def test_vless(self):
        n=v.parse_uri(VLESS); self.assertEqual(n['outbound']['flow'],'xtls-rprx-vision'); self.assertTrue(n['spiderx_ignored'])
    def test_trojan(self):
        n=v.parse_uri(TROJAN); self.assertEqual(n['outbound']['password'],'test+password'); self.assertEqual(n['outbound']['tls']['alpn'],['http/1.1'])
    def test_unicode_label(self):
        self.assertEqual(v.parse_uri(TROJAN.rsplit('#',1)[0]+'#%D0%A2%D0%B5%D1%81%D1%82')['name'],'Тест')
    def test_raw_and_b64(self):
        raw=(VLESS+'\n'+TROJAN).encode()
        for value in (raw,base64.b64encode(raw),base64.urlsafe_b64encode(raw).rstrip(b'=')):
            self.assertEqual(len(v.parse_subscription(value)[0]),2)
    def test_dedup(self):
        self.assertEqual(len(v.parse_subscription((TROJAN+'\n'+TROJAN).encode())[0]),1)
    def test_skip(self):
        self.assertEqual(v.parse_subscription((TROJAN+'\nvmess://abc').encode())[1],1)
    def test_reject_unsupported(self):
        for text in (b'vmess://abc',b'<html>login</html>',b'{"outbounds":[]}',b'',b'A'*(v.LIMIT+1)):
            with self.subTest(text=text[:40]), self.assertRaises(v.VPNError): v.parse_subscription(text)
    def test_reject_bad_params(self):
        for param in ('allowInsecure=1','insecure=true','type=ws','x=1','sni=bad%0Afoo'):
            uri=TROJAN.replace('#Test','&'+param+'#Test')
            with self.subTest(param=param), self.assertRaises(v.VPNError): v.parse_uri(uri)
    def test_reject_cleartext(self):
        with self.assertRaises(v.VPNError): v.parse_uri(TROJAN.replace('security=tls','security=none'))
    def test_reject_xhttp(self):
        with self.assertRaises(v.VPNError): v.parse_uri(TROJAN.replace('type=tcp','type=xhttp'))
    def test_ws(self):
        n=v.parse_uri(TROJAN.replace('type=tcp','type=ws&path=%2Fws'))
        self.assertEqual(n['outbound']['transport']['path'],'/ws')
    def test_grpc(self):
        n=v.parse_uri(TROJAN.replace('type=tcp','type=grpc&serviceName=svc'))
        self.assertEqual(n['outbound']['transport']['service_name'],'svc')
    def test_bad_percent_and_port(self):
        for text in (TROJAN.replace('%2B','%XZ'),TROJAN.replace(':443?',':99999?')):
            with self.assertRaises(v.VPNError): v.parse_uri(text)
    def test_https_url_guard(self):
        for url in ('http://example.com/x','https://user:pw@example.com/x','https://example.com/x\nheader','https://example.com/x"','https://example.com/x#frag', None):
            with self.assertRaises(v.VPNError): v.url_ok(url)
    def test_profile_schema(self):
        with self.assertRaises(v.VPNError): v.validate_profile({'schema':'unknown'})
    def test_config_isolated_copy(self):
        n=v.parse_uri(TROJAN); c=v.make_config(n,'test',True); c['outbounds'][0]['server']='1.1.1.1'
        self.assertEqual(n['outbound']['server'],'example.com')
    def test_config_no_direct(self):
        c=v.make_config(v.parse_uri(VLESS),'test',True)
        self.assertEqual([o['tag'] for o in c['outbounds']],['proxy'])
        self.assertEqual(c['dns']['servers'][0]['detour'],'proxy')
        self.assertEqual(c['route']['final'],'proxy')
        self.assertEqual(len(c['inbounds'][0]['address']),2)
        self.assertTrue(c['log']['disabled'])
    def test_probe_no_tun(self):
        c=v.make_config(v.parse_uri(TROJAN),'secret',False)
        self.assertEqual(len(c['inbounds']),1); self.assertEqual(c['inbounds'][0]['listen'],'127.0.0.1')
    def test_preferred_dedup(self):
        s=self.state; s['nodes']=s['bootstrap']; s['preferred']=s['bootstrap'][1]['id']
        self.assertEqual(len(v.candidates(s)),2)
        self.assertEqual(v.candidates(s)[0]['id'],s['preferred'])

class IOTests(Fixture):
    def test_atomic_json_permissions(self):
        self.assertEqual(os.stat(v.CATALOG).st_mode & 0o777,0o600)
        self.assertEqual(v.read_json(v.CATALOG)['subscription'],self.profile['subscription'])
    def test_atomic_rejects_symlink(self):
        path=self.p/'link';path.symlink_to(self.p/'target')
        with self.assertRaises(v.VPNError):v.atomic_bytes(str(path),b'test')
    def test_process_timeout(self):
        rc,_,_=v.run(['/bin/sleep','2'],timeout=0.1)
        self.assertEqual(rc,124)
    def test_process_io(self):
        rc,out,_=v.run(['/bin/cat'],data=b'hello\n')
        self.assertEqual((rc,out),(0,b'hello\n'))
    def test_archive_valid(self):
        archive=self.p/'core.tgz'; target=self.p/'core'
        with tarfile.open(archive,'w:gz') as tf:
            m=tarfile.TarInfo('dir/sing-box');m.size=4;tf.addfile(m,io.BytesIO(b'test'))
        v.extract_core(str(archive),str(target));self.assertEqual(target.read_bytes(),b'test')
    def test_archive_paths(self):
        for i,name in enumerate(('../sing-box','/sing-box')):
            archive=self.p/('core%d.tgz'%i)
            with tarfile.open(archive,'w:gz') as tf:
                m=tarfile.TarInfo(name);m.size=4;tf.addfile(m,io.BytesIO(b'test'))
            with self.assertRaises(v.VPNError):v.extract_core(str(archive),str(self.p/'core'))
    def test_archive_symlink(self):
        archive=self.p/'core.tgz'
        with tarfile.open(archive,'w:gz') as tf:
            m=tarfile.TarInfo('sing-box');m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';tf.addfile(m)
        with self.assertRaises(v.VPNError):v.extract_core(str(archive),str(self.p/'core'))
    def test_report_skip_not_pass(self):
        r=self.report();r.mark('SPEED','SKIP','not available');self.assertTrue(r.warnings())
        r.end('READY_WITH_WARNINGS');self.assertEqual(v.read_json(v.REPORT)['overall'],'READY_WITH_WARNINGS')
    def test_plist_no_reboot_autostart(self):
        v.write_plist()
        import plistlib
        with open(v.PLIST,'rb') as f:d=plistlib.load(f)
        self.assertFalse(d['KeepAlive']);self.assertTrue(d['RunAtLoad'])
        self.assertEqual(d['HardResourceLimits']['FileSize'],v.LIMIT)
        self.assertNotIn('LaunchDaemons',v.PLIST)
    def test_cli_syntax(self):
        p=self.p/'cli';p.write_text(v.CLI)
        subprocess.run(['/bin/bash','-n',str(p)],check=True)

class HTTPTests(Fixture):
    def fake_run(self, body=b'198.51.100.2\n', code='200', rc=0):
        def call(args,data=None,**kw):
            Path(args[args.index('-o')+1]).write_bytes(body)
            return rc, ('%s\n1.1.1.1\n%d\n100\n0.1' % (code,len(body))).encode(), b''
        return call
    def test_ip_and_no_proxy(self):
        with mock.patch.object(v,'run',side_effect=self.fake_run()) as m:
            ip,_=v.public_ip()
        args=m.call_args.args[0]; data=m.call_args.args[1]
        self.assertEqual(ip,'198.51.100.2');self.assertIn('--proxy',args);self.assertIn('-4',args)
        self.assertIn(b'https://ifconfig.me/ip',data);self.assertNotIn('-k',args)
    def test_subscription_private_argv(self):
        url='https://example.com/private-token'
        with mock.patch.object(v,'run',side_effect=self.fake_run()) as m:
            v.http(url,subscription=True,auth='secret')
        self.assertNotIn('private-token',' '.join(m.call_args.args[0]))
        self.assertNotIn('secret',' '.join(m.call_args.args[0]))
        self.assertIn(b'proxy-user',m.call_args.args[1])
        self.assertNotIn('-L',m.call_args.args[0])
    def test_invalid_ip(self):
        for body in (b'<html>OK</html>',b'999.1.1.1',b'2001:db8::1',b'\xff\xff'):
            with mock.patch.object(v,'run',side_effect=self.fake_run(body)),self.assertRaises(v.VPNError):v.public_ip()
    def test_tls_failure(self):
        with mock.patch.object(v,'run',side_effect=self.fake_run(rc=60)),self.assertRaisesRegex(v.VPNError,'TLS'):v.public_ip()
    def test_reject_redirect(self):
        with mock.patch.object(v,'run',side_effect=self.fake_run(code='302')),self.assertRaises(v.VPNError):v.public_ip()
    def test_cleanup_http(self):
        with mock.patch.object(v,'run',side_effect=self.fake_run()):v.public_ip()
        self.assertEqual(list((self.p/'private').glob('.http-*')),[])

class Verification(Fixture):
    def test_changed_ip(self):
        r=self.report()
        with self.verify_mocks():self.assertEqual(v.verify(BASELINE,r),'198.51.100.2')
        self.assertFalse(r.warnings())
    def test_same_ip_fails(self):
        with self.verify_mocks('192.0.2.1'),self.assertRaises(v.VPNError):v.verify(BASELINE,self.report())
    def test_missing_baseline_warns(self):
        r=self.report()
        with self.verify_mocks():v.verify({},r)
        self.assertTrue(r.warnings());self.assertEqual(r.data['steps'][-1]['status'],'WARN')
    def test_process_alone_not_success(self):
        with mock.patch.object(v,'check_config'),mock.patch.object(v,'assert_routes',side_effect=v.VPNError('route')),self.assertRaises(v.VPNError):v.verify(BASELINE,self.report())
    def test_dns_failure(self):
        with self.verify_mocks(),mock.patch.object(v,'assert_dns',side_effect=v.VPNError('dns')),self.assertRaises(v.VPNError):v.verify(BASELINE,self.report())
    def test_http_peer_wrong_route(self):
        with self.verify_mocks(),mock.patch.object(v,'route_interface',return_value='en0'),self.assertRaises(v.VPNError):v.verify(BASELINE,self.report())
    def test_both_route_halves(self):
        queried=[]
        def route(ip,v6=False):queried.append((ip,v6));return v.IFACE
        with mock.patch.object(v,'alive',return_value=True),mock.patch.object(v,'run',return_value=(0,b'utun98: flags=8051<UP>\n',b'')),mock.patch.object(v,'route_interface',side_effect=route):v.assert_routes()
        self.assertEqual(queried,v.ROUTES);self.assertTrue(any(ip.startswith('208') for ip,_ in queried))
    def test_route_fails_no_process(self):
        with mock.patch.object(v,'alive',return_value=False),self.assertRaises(v.VPNError):v.assert_routes()
    def test_foreign_vpn_not_stopped(self):
        with mock.patch.object(v,'route_interface',return_value='utun3'),mock.patch.object(v,'stop') as m,self.assertRaises(v.VPNError):v.assert_no_other_vpn()
        m.assert_not_called()
    def test_baseline_no_internet(self):
        with mock.patch.object(v,'assert_no_other_vpn'),mock.patch.object(v,'github_check',side_effect=v.VPNError('offline')),self.assertRaises(v.VPNError):v.baseline(self.report())
    def test_baseline_ifconfig_unreachable(self):
        r=self.report()
        with mock.patch.object(v,'assert_no_other_vpn'),mock.patch.object(v,'github_check'),mock.patch.object(v,'public_ip',side_effect=v.VPNError('blocked')),mock.patch.object(v,'route_interface',return_value='en0'):
            self.assertIsNone(v.baseline(r)['ip'])
        self.assertTrue(r.warnings())

class Speed(Fixture):
    def test_no_native_uses_curl_no_disk(self):
        r=self.report()
        with mock.patch.object(v,'assert_routes'),mock.patch.object(v.os.path,'isfile',return_value=False),mock.patch.object(v,'http',return_value=(None,META)) as m:
            v.speed(r)
        self.assertEqual(m.call_args.kwargs['destination'],os.devnull)
        self.assertEqual(m.call_args.kwargs['interface'],v.IFACE)
        self.assertEqual(r.data['speed']['download_mbps'],100.0)
        self.assertIsNone(r.data['speed']['upload_mbps'])
    def test_short_transfer_warns(self):
        r=self.report();meta=dict(META,bytes=100)
        with mock.patch.object(v,'assert_routes'),mock.patch.object(v.os.path,'isfile',return_value=False),mock.patch.object(v,'http',return_value=(None,meta)):v.speed(r)
        self.assertEqual(r.data['steps'][-1]['status'],'WARN')
    def test_native_success(self):
        r=self.report()
        with mock.patch.object(v,'assert_routes'),mock.patch.object(v.os.path,'isfile',return_value=True),mock.patch.object(v.os,'access',return_value=True),mock.patch.object(v,'run',return_value=(0,b'Downlink capacity: 100.1 Mbps\nUplink capacity: 30.2 Mbps',b'')),mock.patch.object(v,'http') as http:
            v.speed(r)
        self.assertFalse(r.warnings());http.assert_not_called()
    def test_native_failure_no_fake_result(self):
        r=self.report()
        with mock.patch.object(v,'assert_routes'),mock.patch.object(v.os.path,'isfile',return_value=True),mock.patch.object(v.os,'access',return_value=True),mock.patch.object(v,'run',return_value=(124,b'failed',b'')):
            v.speed(r)
        self.assertTrue(r.warnings());self.assertNotIn('speed',r.data)
    def test_recheck_after_speed(self):
        v.atomic_json(v.ACTIVE,{'name':'test'})
        events=[]
        with mock.patch.object(v,'speed',side_effect=lambda r:events.append('speed')),mock.patch.object(v,'verify',side_effect=lambda b,r:(events.append('verify') or '198.51.100.2')):
            self.assertEqual(v.finish_connected(BASELINE,self.report()),0)
        self.assertEqual(events,['speed','verify'])
    def test_failure_no_ready_message(self):
        v.atomic_json(v.ACTIVE,{'name':'test'});r=self.report()
        with mock.patch.object(v,'speed'),mock.patch.object(v,'verify',side_effect=v.VPNError('dead')),self.assertRaises(v.VPNError):v.finish_connected(BASELINE,r)
        self.assertEqual(r.data['overall'],'RUNNING')
        self.assertFalse(any('ГОТОВО:' in str(x) for x in self.say.call_args_list))

class Workflow(Fixture):
    def connect_patches(self):
        stack=contextlib.ExitStack()
        for name,value in [('info',''),('assert_no_other_vpn',None),('refresh',None),('resolve_node',v.parse_uri(TROJAN)),
                           ('probe','198.51.100.2'),('check_config',None),('write_plist',None),('alive',True),('route_interface',v.IFACE)]:
            stack.enter_context(mock.patch.object(v,name,return_value=value))
        return stack
    def test_bad_server_no_launch(self):
        with self.connect_patches(),mock.patch.object(v,'probe',side_effect=v.VPNError('offline')),mock.patch.object(v,'run') as run,self.assertRaises(v.VPNError):v.connect(BASELINE,self.report())
        run.assert_not_called()
    def test_launch_error_stops_job(self):
        r=self.report()
        with self.connect_patches(),mock.patch.object(v,'run',return_value=(1,b'',b'')),mock.patch.object(v,'stop') as stop,self.assertRaises(v.VPNError):v.connect(BASELINE,r)
        stop.assert_called_once();self.assertFalse(Path(v.ACTIVE).exists())
    def test_verify_error_rolls_back(self):
        with self.connect_patches(),mock.patch.object(v,'run',return_value=(0,b'',b'')),mock.patch.object(v,'verify',side_effect=v.VPNError('same ip')),mock.patch.object(v,'stop') as stop,self.assertRaises(v.VPNError):v.connect(BASELINE,self.report())
        stop.assert_called_once()
    def test_connect_success_records_baseline(self):
        with self.connect_patches(),mock.patch.object(v,'run',return_value=(0,b'',b'')),mock.patch.object(v,'verify',return_value='198.51.100.2'):
            self.assertEqual(v.connect(BASELINE,self.report()),'198.51.100.2')
        self.assertEqual(v.read_json(v.ACTIVE)['baseline'],BASELINE)
    def test_subscription_failure_keeps_connection_warn(self):
        r=self.report()
        with self.connect_patches(),mock.patch.object(v,'refresh',side_effect=v.VPNError('blocked')),mock.patch.object(v,'run',return_value=(0,b'',b'')),mock.patch.object(v,'verify',return_value='198.51.100.2'),mock.patch.object(v,'stop') as stop:
            v.connect(BASELINE,r)
        self.assertTrue(r.warnings());stop.assert_not_called()
    def test_existing_same_no_reinstall(self):
        meta={'version':v.VERSION,'hashes':{'vpn-runtime.py':v.digest(v.__file__)},'profile_sha256':v.digest(self.profile_path)}
        v.atomic_json(v.ACTIVE,{'baseline':BASELINE})
        with mock.patch.object(v,'check_install',return_value=meta),mock.patch.object(v,'alive',return_value=True),mock.patch.object(v,'verify'),mock.patch.object(v,'finish_connected',return_value=0),mock.patch.object(v,'stage_install') as stage,mock.patch.object(v,'stop') as stop:
            self.assertEqual(v.setup(self.profile_path,self.report()),0)
        stage.assert_not_called();stop.assert_not_called()
    def test_preflight_before_install(self):
        events=[]
        with mock.patch.object(v,'check_install',side_effect=v.VPNError('not installed')),mock.patch.object(v,'info',return_value=''),mock.patch.object(v,'baseline',side_effect=lambda r:(events.append('baseline') or BASELINE)),mock.patch.object(v,'github_check'),mock.patch.object(v,'stage_install',side_effect=lambda *a:(events.append('stage') or (_ for _ in ()).throw(v.VPNError('download')))),self.assertRaises(v.VPNError):v.setup(self.profile_path,self.report())
        self.assertEqual(events,['baseline','stage'])
    def test_bad_download_does_not_stop_old_service(self):
        with mock.patch.object(v,'check_install',side_effect=v.VPNError('old')),mock.patch.object(v,'info',return_value='old service'),mock.patch.object(v,'github_check'),mock.patch.object(v,'stage_install',side_effect=v.VPNError('download failed')),mock.patch.object(v,'stop') as stop,self.assertRaises(v.VPNError):v.setup(self.profile_path,self.report())
        stop.assert_not_called()
    def test_core_hash_failure_not_executed(self):
        def fetch(url,destination=None,**kw):Path(destination).write_bytes(b'corrupt');return None,META
        with mock.patch.object(v,'http',side_effect=fetch),mock.patch.object(v,'run') as run,self.assertRaises(v.VPNError):v.stage_install(self.profile_path,self.report())
        run.assert_not_called();self.assertEqual(list((self.p/'releases').iterdir()),[])


class Bootstrap(Fixture):
    def source(self):
        return (ROOT/'vpn.sh').read_text()
    def test_bash_syntax(self):
        subprocess.run(['/bin/bash','-n',str(ROOT/'vpn.sh')],check=True)
    def test_exact_simple_command_and_no_key(self):
        text=self.source()
        self.assertIn('curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/vpn.sh | bash',text)
        self.assertNotIn('${VPN_INSTALL_KEY',text)
        self.assertNotIn('getpass.getpass',text)
    def test_pins(self):
        import re,hashlib
        for prefix,name in [('runtime','vpn-runtime.py'),('profile','vpn-profile.json')]:
            expected=re.search('local '+prefix+'_sha=([0-9a-f]{64})',self.source()).group(1)
            self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),expected)
    def test_truncated_without_invocation_no_execution(self):
        text=self.source().rsplit('bigsur_vpn_bootstrap "$@"',1)[0]
        p=subprocess.run(['/bin/bash'],input=text.encode(),capture_output=True,timeout=5)
        self.assertEqual(p.returncode,0);self.assertEqual(p.stdout,b'')
    def test_linux_rejected(self):
        p=subprocess.run(['/bin/bash',str(ROOT/'vpn.sh')],capture_output=True,timeout=5)
        self.assertNotEqual(p.returncode,0);self.assertNotIn(b'CORE_DOWNLOAD',p.stdout)
    def runner_call(self,bad=False):
        import re,hashlib,sys
        runner=re.search("  runner='(.*?)'\n  printf",self.source(),re.S).group(1)
        runner=runner.replace('dir="/private/var/tmp"','dir='+repr(str(self.p)))
        # This harness checks hash verification/root copy/argv only, not macOS.
        runner=runner.replace('if os.geteuid() != 0:', 'if False:')
        runtime=self.p/'fake-runtime.py';profile=self.p/'fake-profile.json'
        runtime.write_text('import json,sys\nassert sys.argv[1] == "setup"\nassert json.load(open(sys.argv[2]))["test"]\nprint("LAUNCHED_WITH_PROFILE")\n')
        profile.write_text('{"test":true}')
        hashes=[hashlib.sha256(p.read_bytes()).hexdigest() for p in (runtime,profile)]
        if bad:hashes[0]='0'*64
        return subprocess.run([sys.executable,'-c',runner,str(runtime),hashes[0],str(profile),hashes[1]],capture_output=True,timeout=5)
    def test_runner_executes_checked_profile(self):
        p=self.runner_call();self.assertEqual(p.returncode,0,p.stderr);self.assertIn(b'LAUNCHED_WITH_PROFILE',p.stdout)
    def test_runner_blocks_hash_mismatch(self):
        p=self.runner_call(bad=True);self.assertNotEqual(p.returncode,0);self.assertNotIn(b'LAUNCHED_WITH_PROFILE',p.stdout)

if __name__=='__main__':
    unittest.main(verbosity=2)
