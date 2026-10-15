#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Python 2.7/3 smoke tests. Never loads provider credentials or connects a VPN.
--native additionally tests macOS APIs using an isolated .invalid DNS suffix,
and checks the official core's config schema without starting the core/TUN.
"""
from __future__ import print_function, unicode_literals
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import types
import uuid

ROOT = os.path.dirname(os.path.abspath(__file__))
v = types.ModuleType('vpn_compat_runtime')
v.__file__ = os.path.join(ROOT, 'vpn-runtime.py')
with open(v.__file__, 'rb') as stream:
    source = stream.read()
exec(compile(source, v.__file__, 'exec'), v.__dict__)
TROJAN = 'trojan://test%2Bpassword@example.com:443?security=tls&type=tcp&sni=example.com#Test'


def portable():
    node = v.parse_uri(TROJAN)
    assert node['outbound']['password'] == 'test+password'
    assert v.parse_uri(TROJAN.replace('#Test', '#%D0%A2%D0%B5%D1%81%D1%82'))['name'] == '\u0422\u0435\u0441\u0442'
    try:
        v.parse_uri(TROJAN.replace('test%2Bpassword', 'test%ff'))
    except v.VPNError:
        pass
    else:
        raise AssertionError('Invalid UTF-8 was accepted')
    cfg = v.make_config(node, 'test-auth', True)
    assert cfg['dns']['servers'][0]['detour'] == 'proxy'
    assert cfg['inbounds'][0]['type'] == 'tun'
    assert cfg['route']['final'] == 'proxy'
    packet = b'ID' + struct.pack('!HHHHH', 0x8180, 1, 1, 0, 0) + b'\x08ifconfig\x02me\0\0\1\0\1'
    packet += b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + b'\xc0\0\2\1'
    v.validate_dns_answer(packet, b'ID')
    rc, out, _ = v.run(['/bin/cat'], data=b'hello')
    assert (rc, out) == (0, b'hello')
    rc, _, _ = v.run([sys.executable, '-c', 'import time; time.sleep(3)'], data=b'x' * 1048576, timeout=0.1)
    assert rc == 124
    print('PASS portable runtime smoke: Python ' + sys.version.split()[0])


def native():
    assert sys.platform == 'darwin', 'Native smoke requires macOS'
    assert os.geteuid() == 0, 'Native smoke requires root'
    # Temporary .invalid-only resolver, never the default domain and no TUN.
    name = 'bigsurvpnaudit' + uuid.uuid4().hex
    key = 'State:/Network/Service/' + name + '/DNS'
    domain = name + '.invalid'
    session, observer = v.TemporaryDNS(), v.TemporaryDNS()
    try:
        assert not observer.contains(key)
        session.add(key, {'ServerAddresses': ['127.0.0.1'], 'SupplementalMatchDomains': [domain],
                          'SupplementalMatchDomainsNoSearch': 1})
        assert observer.contains(key)
        try:
            observer.add(key, {'test': True})
        except v.VPNError:
            pass
        else:
            raise AssertionError('Temporary key was overwritten')
        deadline = time.time() + 10
        while time.time() < deadline:
            rc, out, _ = v.run(['/usr/sbin/scutil', '--dns'])
            if rc == 0 and domain.encode('ascii') in out:
                break
            time.sleep(0.2)
        else:
            raise AssertionError('Temporary supplemental resolver not published')
        session.close()
        deadline = time.time() + 10
        while time.time() < deadline:
            rc, out, _ = v.run(['/usr/sbin/scutil', '--dns'])
            if not observer.contains(key) and rc == 0 and domain.encode('ascii') not in out:
                break
            time.sleep(0.2)
        else:
            raise AssertionError('Temporary resolver not removed after session close')
    finally:
        session.close()
        observer.close()
    print('PASS native SystemConfiguration temporary add/no-overwrite/publish/cleanup')
    # Read-only checks of actual Darwin diagnostic formats.
    v.LABEL = name
    assert v.info() == ''
    v.IFACE = 'utun999'
    assert v.interface_state() is None
    assert v.route_interface('1.1.1.1')
    print('PASS native launchctl/ifconfig/route parsing')
    v.IFACE = 'utun98'
    folder = tempfile.mkdtemp(prefix='bigsur-vpn-schema-')
    try:
        archive = os.path.join(folder, 'core.tar.gz')
        subprocess.check_call(['/usr/bin/curl', '-q', '-fL', '--proto', '=https', '--proto-redir', '=https',
                               '--connect-timeout', '20', '--max-time', '180', v.CORE_URL, '-o', archive])
        assert v.digest(archive) == v.CORE_SHA
        core = os.path.join(folder, 'sing-box')
        v.extract_core(archive, core)
        rc, output, err = v.run([core, 'version'], timeout=20)
        assert rc == 0, 'Core version failed: ' + repr(err[:1000])
        print(output.decode('utf-8', 'replace'))
        config = v.make_config(v.parse_uri(TROJAN), 'schema-only', True)
        config['outbounds'][0]['server'] = '192.0.2.1'
        path = os.path.join(folder, 'sample.json')
        v.atomic_json(path, config)
        rc, _, err = v.run([core, 'check', '-c', path], timeout=20)
        assert rc == 0, 'Core schema check failed: ' + repr(err[:1000])
        print('PASS official legacy core version/check on this macOS (not Big Sur proof)')
    finally:
        shutil.rmtree(folder)


if __name__ == '__main__':
    portable()
    if '--native' in sys.argv[1:]:
        native()
