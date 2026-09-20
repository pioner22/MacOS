# -*- coding: utf-8 -*-
from __future__ import unicode_literals
import base64
import copy
import importlib.util
import io
import json
import os
import tempfile
import tarfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('vpn', os.path.join(os.path.dirname(__file__), 'vpn-bigsur.py'))
vpn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpn)
VLESS = 'vless://00000000-0000-4000-8000-000000000001@example.com:443?security=reality&type=tcp&encryption=none&flow=xtls-rprx-vision&fp=chrome&pbk=' + 'A'*43 + '&sid=abcd&sni=www.example.com&spx=%2F#Test%20VLESS'
TROJAN = 'trojan://test%2Bpassword@example.com:443?security=tls&type=tcp&sni=example.com&alpn=http%2F1.1&fp=chrome#Test%20Trojan'

class ParserTests(unittest.TestCase):
    def test_vless(self):
        n = vpn.parse_uri(VLESS)
        self.assertEqual(n['outbound']['tls']['reality']['short_id'], 'abcd')
        self.assertEqual(n['outbound']['flow'], 'xtls-rprx-vision')
        self.assertTrue(n['spiderx_ignored'])
    def test_trojan_percent_and_alpn(self):
        n = vpn.parse_uri(TROJAN)
        self.assertEqual(n['outbound']['password'], 'test+password')
        self.assertEqual(n['outbound']['tls']['alpn'], ['http/1.1'])
    def test_raw(self):
        n, skipped = vpn.parse_subscription((VLESS+'\n'+TROJAN+'\n').encode())
        self.assertEqual((len(n),skipped),(2,0))
    def test_base64(self):
        n, skipped = vpn.parse_subscription(base64.b64encode((VLESS+'\n'+TROJAN).encode()).rstrip(b'='))
        self.assertEqual((len(n),skipped),(2,0))
    def test_urlsafe_base64(self):
        n, _ = vpn.parse_subscription(base64.urlsafe_b64encode(TROJAN.encode()))
        self.assertEqual(len(n),1)
    def test_deduplicate(self):
        self.assertEqual(len(vpn.parse_subscription((VLESS+'\n'+VLESS).encode())[0]),1)
    def test_skip_unsupported(self):
        nodes, skipped = vpn.parse_subscription((TROJAN+'\nvmess://abc').encode())
        self.assertEqual((len(nodes),skipped),(1,1))
    def test_no_supported(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_subscription(b'vmess://abc')
    def test_reject_html(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_subscription(b'<html>login</html>')
    def test_reject_arbitrary_json(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_subscription(b'{"outbounds":[]}')
    def test_reject_size(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_subscription(b'A'*(vpn.LIMIT+1))
    def test_no_insecure(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace('#Test','&allowInsecure=1#Test'))
    def test_no_cleartext(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(VLESS.replace('security=reality','security=none'))
    def test_no_duplicate_parameter(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace('#Test','&type=ws#Test'))
    def test_no_unknown_parameter(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace('#Test','&execute=whoami#Test'))
    def test_no_unknown_transport(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace('type=tcp','type=xhttp'))
    def test_no_control(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace('sni=example.com','sni=example.com%0Ahello'))
    def test_bad_percent(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace('sni=example.com','sni=example.com%ZZ'))
    def test_wrong_port(self):
        with self.assertRaises(vpn.VPNError): vpn.parse_uri(TROJAN.replace(':443?',':99999?'))
    def test_ws(self):
        n=vpn.parse_uri(TROJAN.replace('type=tcp','type=ws&path=%2Fws&host=example.com'))
        self.assertEqual(n['outbound']['transport']['path'],'/ws')
    def test_grpc(self):
        n=vpn.parse_uri(TROJAN.replace('type=tcp','type=grpc&serviceName=grpc'))
        self.assertEqual(n['outbound']['transport']['service_name'],'grpc')
    def test_url_https_only(self):
        for u in ['http://example.com/key','https://user:pass@example.com/key','https://example.com/"\\x','https://example.com/x\nheader']:
            with self.assertRaises(vpn.VPNError): vpn.url_ok(u)
    def test_resolve_only_endpoint(self):
        n=vpn.parse_uri(VLESS)
        with mock.patch.object(vpn.socket,'getaddrinfo',return_value=[(2,1,6,'',('192.0.2.1',443))]):
            resolved=vpn.resolve_node(n)
        self.assertEqual(n['outbound']['server'],'example.com')
        self.assertEqual(resolved['outbound']['server'],'192.0.2.1')
        self.assertEqual(resolved['outbound']['tls']['server_name'],'www.example.com')
    def test_config_no_direct_fallback(self):
        for uri in [VLESS,TROJAN]:
            n=vpn.parse_uri(uri); n['outbound']['server']='192.0.2.1'
            c=vpn.make_config(n,'test-password',True)
            self.assertEqual([x['tag'] for x in c['outbounds']],['proxy'])
            self.assertEqual(c['route']['final'],'proxy')
            self.assertEqual(c['dns']['servers'][0]['detour'],'proxy')
            self.assertNotIn('local',json.dumps(c['dns']))
            self.assertEqual(c['inbounds'][0]['dns_mode'],'hijack')
            self.assertEqual(len(c['inbounds'][0]['address']),2)
            self.assertTrue(c['log']['disabled'])
    def test_probe_no_tun(self):
        c=vpn.make_config(vpn.parse_uri(TROJAN),'test',False)
        self.assertEqual(len(c['inbounds']),1)
        self.assertEqual(c['inbounds'][0]['listen'],'127.0.0.1')
        self.assertEqual(c['inbounds'][0]['users'][0]['password'],'test')
    def test_preferred_first_and_dedup(self):
        a,b=vpn.parse_uri(VLESS),vpn.parse_uri(TROJAN)
        s={'bootstrap':[a,b],'nodes':[a,b], 'preferred':b['id']}
        ordered=vpn.nodes_ordered(s)
        self.assertEqual([n['id'] for n in ordered],[b['id'],a['id']])
    def test_atomic_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            p=d+'/state.json'; vpn.atomic_json(p,{'secret':'test'})
            self.assertEqual(os.stat(p).st_mode & 0o777,0o600)
            self.assertEqual(vpn.read_json(p),{'secret':'test'})
    def test_archive_safe(self):
        with tempfile.TemporaryDirectory() as d:
            a=d+'/test.tgz'; out=d+'/core'
            with tarfile.open(a,'w:gz') as tf:
                m=tarfile.TarInfo('dir/sing-box'); m.size=4
                tf.addfile(m,io.BytesIO(b'test'))
            vpn.extract_core(a,out)
            with open(out,'rb') as f: self.assertEqual(f.read(),b'test')
    def test_archive_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            a=d+'/test.tgz'
            with tarfile.open(a,'w:gz') as tf:
                m=tarfile.TarInfo('../sing-box'); m.size=1
                tf.addfile(m,io.BytesIO(b'x'))
            with self.assertRaises(vpn.VPNError): vpn.extract_core(a,d+'/out')
    def test_archive_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            a=d+'/test.tgz'
            with tarfile.open(a,'w:gz') as tf:
                m=tarfile.TarInfo('sing-box'); m.type=tarfile.SYMTYPE; m.linkname='/etc/passwd'
                tf.addfile(m)
            with self.assertRaises(vpn.VPNError): vpn.extract_core(a,d+'/out')
    def test_bootstrap_fail_no_routing(self):
        s={'bootstrap':[vpn.parse_uri(TROJAN)],'nodes':[]}
        with mock.patch.object(vpn,'alive',return_value=False), mock.patch.object(vpn,'stop') as stop, mock.patch.object(vpn,'run',return_value=(1,b'',b'')), mock.patch.object(vpn,'route_interface',return_value='en0'), mock.patch.object(vpn,'read_json',return_value=s), mock.patch.object(vpn,'resolve_node',side_effect=vpn.VPNError('mock failure')), mock.patch.object(vpn,'write_plist') as plist:
            with self.assertRaises(vpn.VPNError): vpn.connect()
            plist.assert_not_called()
            stop.assert_called_once_with(quiet=True)
    def test_tun_failure_rolls_back(self):
        n=vpn.parse_uri(TROJAN)
        s={'bootstrap':[n],'nodes':[]}
        calls=[]
        def run(args,*a,**kw):
            calls.append(args)
            if args[0] == '/sbin/ifconfig': return (1,b'',b'')
            if 'bootstrap' in args: return (1,b'',b'')
            return (0,b'',b'')
        with mock.patch.object(vpn,'alive',return_value=False), mock.patch.object(vpn,'stop') as stop, mock.patch.object(vpn,'run',side_effect=run), mock.patch.object(vpn,'route_interface',return_value='en0'), mock.patch.object(vpn,'read_json',return_value=s), mock.patch.object(vpn,'resolve_node',return_value=n), mock.patch.object(vpn,'probe_node',return_value='192.0.2.5'), mock.patch.object(vpn,'atomic_json'), mock.patch.object(vpn,'check_config'), mock.patch.object(vpn,'write_plist'):
            with self.assertRaises(vpn.VPNError): vpn.connect()
            self.assertEqual(stop.call_count,2)

if __name__=='__main__':
    unittest.main(verbosity=2)
