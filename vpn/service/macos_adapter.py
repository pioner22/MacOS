#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Actual macOS adapter for the approved legacy runtime, not an ICMP pinger.

Use only with the service command lock held. The adapter never refreshes a
subscription during failover and never sends a candidate through another VPN.
Native execution is not validated by the portable tests.
"""
from __future__ import print_function, unicode_literals
import binascii
import hashlib
import json
import os
import re
import resource
import subprocess
import tempfile
import time
from service_common import (BASE, PRIVATE, SERVICE, ENV, CLOCK, ServiceError, Cancelled,
                            read_json, cancel_check, run, kill, load_runtime)

PROBE_PORT = 17891
PROBE_URLS = ('https://www.gstatic.com/generate_204', 'https://cp.cloudflare.com/generate_204')


def nodes_from_catalog(runtime, catalog):
    """All cached compatible profiles, all SOCKS IPs, no subscription download."""
    socks = catalog.get('socks5_nodes') or ([catalog['socks5']] if catalog.get('socks5') else [])
    nodes = list(socks) + list(catalog.get('nodes', [])) + list(catalog.get('bootstrap', []))
    # Migrate only the owner's specifically authorized endpoint, not unrelated credentials.
    for node in list(socks):
        out = node.get('outbound', {})
        if out.get('server') == '144.31.180.114' and out.get('server_port') == 45004:
            if not any(n.get('outbound', {}).get('server') == '87.251.86.229' for n in socks):
                extra = json.loads(json.dumps(node))
                extra['outbound']['server'] = '87.251.86.229'
                extra['id'] = hashlib.sha256(('socks5-extra:' + str(node['id'])).encode('utf-8')).hexdigest()[:20]
                extra['name'] = 'SOCKS5 87.251.86.229'
                nodes.insert(len(socks), extra)
            break
    result, seen = [], set()
    for node in nodes:
        if node.get('enabled', True) is not True: continue
        out = node.get('outbound', {})
        if out.get('type') not in ('socks', 'vless', 'trojan'): continue
        if not isinstance(node.get('id'), (str, type(u''))) or not re.match(r'^[a-f0-9]{20,64}\Z', node['id']):
            raise ServiceError('Invalid cached profile identifier')
        if out.get('type') == 'socks':
            runtime.validate_socks({'server': out.get('server'), 'port': out.get('server_port'),
                                    'username': out.get('username'), 'password': out.get('password')})
        # Do not carry custom local-file or arbitrary outbound types into a root service.
        if not out.get('server') or type(out.get('server_port')) is not int:
            raise ServiceError('Invalid cached endpoint')
        key = (out['type'], out['server'], out['server_port'], node['id'])
        if key in seen: continue
        if any(n['id'] == node['id'] for n in result): raise ServiceError('Ambiguous profile ID')
        seen.add(key); result.append(node)
    if not result or len(result) > 264: raise ServiceError('No usable cached profiles or too many profiles')
    return result


def probe_round(interface=None, auth=None, check=None, timeout=2.0):
    """Two independent TLS-verified HTTPS 204 probes; one common deadline.

    A successful request must be explicitly bound to the TUN or use the
    candidate-only authenticated local proxy. Direct fallback is impossible.
    Credentials are passed via stdin, not argv or logs. No redirect is followed.
    """
    if bool(interface) == bool(auth): raise ServiceError('Probe transport must be explicit')
    processes, handles = [], []
    deadline = CLOCK() + timeout
    def child_setup():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_FSIZE, (8192, 8192))
    try:
        for url in PROBE_URLS:
            if check: check()
            inp, out, err = tempfile.TemporaryFile(), tempfile.TemporaryFile(), tempfile.TemporaryFile()
            handles.extend((inp, out, err))
            cfg = 'url = "%s"\n' % url
            if auth:
                if not re.match(r'^[a-f0-9]{48}\Z', auth): raise ServiceError('Invalid probe token')
                cfg += 'proxy = "socks5h://127.0.0.1:%s"\nproxy-user = "probe:%s"\nnoproxy = ""\n' % (PROBE_PORT, auth)
            inp.write(cfg.encode('ascii')); inp.seek(0)
            args = ['/usr/bin/curl', '-q', '--config', '-', '-4', '-sS', '--globoff',
                    '--proto', '=https', '--connect-timeout', '1.5', '--max-time', str(timeout),
                    '--max-redirs', '0', '--max-filesize', '1024', '-o', '/dev/null',
                    '-w', '%{http_code} %{size_download}']
            if interface: args += ['--proxy', '', '--noproxy', '*', '--interface', interface]
            p = subprocess.Popen(args, stdin=inp, stdout=out, stderr=err, env=ENV,
                                 close_fds=True, preexec_fn=child_setup)
            processes.append((p, out))
        while CLOCK() < deadline:
            if check: check()
            all_done = True
            for p, out in processes:
                if p.poll() is None: all_done = False; continue
                if p.returncode == 0:
                    out.seek(0)
                    if out.read(256).strip() == b'204 0': return True
            if all_done: break
            time.sleep(0.025)
        return False
    finally:
        for p, _ in processes: kill(p)
        for handle in handles: handle.close()


class MacAdapter(object):
    def __init__(self, generation):
        self.runtime = load_runtime()
        self.generation = generation
        self.probe_process = None
        self.probe_path = PRIVATE + '/service-probe.json'
        self.probe_auth = binascii.hexlify(os.urandom(24)).decode('ascii')
        self.prepared = None
        self.deadline = None
        self.runtime.run = self.runtime_run

    def check(self):
        cancel_check(self.generation)
        if self.deadline is not None and CLOCK() >= self.deadline:
            raise ServiceError('Operation deadline exceeded')

    def runtime_run(self, args, data=None, timeout=30, file_limit=1048576):
        if self.deadline is not None: timeout = min(timeout, max(0.1, self.deadline - CLOCK()))
        return run(args, data, timeout, file_limit, self.check)

    def nodes(self):
        return nodes_from_catalog(self.runtime, read_json(self.runtime.CATALOG, 4 * 1024 * 1024))

    def current_id(self):
        if self.runtime.alive() and os.path.exists(self.runtime.ACTIVE):
            return read_json(self.runtime.ACTIVE).get('id')
        return None

    def network_available(self):
        # Physical link state, not a request that could leak outside the VPN.
        rc, text, _ = run(['/sbin/route', '-n', 'get', 'default'], timeout=2, check=self.check)
        match = re.search(br'(?m)^\s*interface:\s*(en[0-9]+)\s*$', text)
        if rc or not match: return False
        name = match.group(1).decode('ascii')
        rc, text, _ = run(['/sbin/ifconfig', name], timeout=2, check=self.check)
        return not rc and b'status: active' in text

    def close_probe(self):
        if self.probe_process is not None:
            if self.probe_process.stdin: self.probe_process.stdin.close()
            kill(self.probe_process); self.probe_process = None
        if os.path.exists(self.probe_path): os.unlink(self.probe_path)
        self.prepared = None

    def disconnect(self):
        self.close_probe()
        old = self.runtime.run
        # Cleanup is deliberately allowed after cancellation. A new activation
        # cannot start until this synchronous cleanup has confirmed completion.
        self.runtime.run = lambda args, data=None, timeout=30, file_limit=1048576: run(args, data, timeout, file_limit)
        try: self.runtime.stop()
        finally: self.runtime.run = old

    def prepare(self, node):
        if self.prepared == node['id'] and self.probe_process is not None and self.probe_process.poll() is None:
            return
        self.check()
        self.disconnect()
        self.check()
        self.runtime.assert_no_other_vpn()
        # No global routes for candidate probes. Interface autodetection now sees
        # the real underlying network, not a previously failed TUN.
        config = self.runtime.make_config(node, self.probe_auth, False)
        config['inbounds'][0]['listen_port'] = PROBE_PORT
        self.runtime.atomic_json(self.probe_path, config)
        self.runtime.check_config(self.probe_path)
        self.check()
        with open(os.devnull, 'r+b') as null:
            self.probe_process = subprocess.Popen(['/usr/bin/python', '-E', '-s', '-B', SERVICE + '/current/probe_guard.py'],
                stdin=subprocess.PIPE, stdout=null, stderr=null, env=ENV, close_fds=True, preexec_fn=os.setsid)
        self.prepared = node['id']

    def probe(self, node, active):
        self.check()
        if active:
            try:
                if not self.runtime.alive() or self.runtime.route_interface('1.1.1.1') != self.runtime.IFACE:
                    return False
                result = probe_round(interface=self.runtime.IFACE, check=self.check)
                # Bind protects transport, this guards stale route observations.
                return result and self.runtime.route_interface('1.1.1.1') == self.runtime.IFACE
            except self.runtime.VPNError: return False
        self.prepare(node)
        if self.probe_process.poll() is not None: return False
        return probe_round(auth=self.probe_auth, check=self.check)

    def activate(self, node):
        self.check()
        self.close_probe()
        rt = self.runtime
        self.deadline = CLOCK() + 45.0
        try:
            self.check()
            rt.atomic_json(rt.CONFIG, rt.make_config(node, self.probe_auth, True))
            rt.check_config(); rt.write_plist()
            self.check()  # Stop wins even after preparation completed.
            rc, _, _ = rt.run([rt.LAUNCH, 'bootstrap', 'system', rt.PLIST], timeout=15)
            if rc: raise ServiceError('launchctl bootstrap failed')
            until = CLOCK() + 15
            while CLOCK() < until:
                self.check()
                if rt.alive() and rt.route_interface('1.1.1.1') == rt.IFACE and rt.managed_dns_present(): break
                time.sleep(0.1)
            else: raise ServiceError('TUN did not become ready')
            rt.assert_routes(); rt.assert_dns()
            self.check()
            if not self.probe(node, True): raise ServiceError('Active TUN HTTPS test failed')
            self.check()
            # Do not rewrite the user's profile catalog or subscription while switching.
            # Actual selected transport is recorded separately in active.json.
            out = node['outbound']
            rt.atomic_json(rt.ACTIVE, {'baseline': {'ip': None, 'at': rt.now()},
                'name': node['name'], 'id': node['id'], 'auth': self.probe_auth,
                'ip': None, 'verified_at': rt.now(), 'version': rt.VERSION,
                'backend': 'socks5' if out['type'] == 'socks' else 'xray',
                'server': out['server'], 'server_port': out['server_port']})
            return True
        except BaseException:
            self.deadline = None
            self.disconnect()
            raise
        finally: self.deadline = None
