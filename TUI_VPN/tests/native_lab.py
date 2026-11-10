#!/usr/bin/env python3
"""Real native core in an isolated loopback lab; optional Linux network namespace.

Synthetic TLS and SOCKS5 peers reject every non-lab destination. No real keys,
provider credentials, system trust changes or system tunnel in default mode.
"""
import argparse
import http.server
import json
import select
import socket
import socketserver
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import Paths, read_json
from tui_vpn.engine import Engine
from tui_vpn.configuration import build
from tui_vpn.profiles import assign_ids
from vendor import legacy_runtime as compatibility


def port():
    with socket.socket() as stream:
        stream.bind(('127.0.0.1', 0))
        return stream.getsockname()[1]


def exact(connection, size):
    result = bytearray()
    while len(result) < size:
        data = connection.recv(size - len(result))
        if not data:
            raise OSError('lab peer closed')
        result.extend(data)
    return bytes(result)


class HTTP(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        body = b'198.51.100.77' if self.path == '/ip' else b'isolated-native-lab'
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        raw = self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 4096))
        # One controlled A query, preserving the question and DNS transaction ID.
        response = raw[:2] + b'\x81\x80\x00\x01\x00\x01\x00\x00\x00\x00' + raw[12:]
        response += b'\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x01\x00\x04' + socket.inet_aton('10.99.0.1')
        self.send_response(200)
        self.send_header('Content-Type', 'application/dns-message')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)


class SOCKS(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(8)
        try:
            self.handshake()
        except (OSError, ValueError):
            return

    def handshake(self):
        version, count = exact(self.request, 2)
        if version != 5 or 2 not in exact(self.request, count):
            raise ValueError('auth required')
        self.request.sendall(b'\x05\x02')
        if exact(self.request, 2) != b'\x01\x03' or exact(self.request, 3) != b'lab':
            raise ValueError('wrong user')
        length = exact(self.request, 1)[0]
        password = exact(self.request, length)
        if password != b'lab':
            self.request.sendall(b'\x01\x01')
            return
        self.request.sendall(b'\x01\x00')
        version, command, _reserved, kind = exact(self.request, 4)
        if version != 5 or command != 1:
            raise ValueError('CONNECT only')
        host = self.destination(kind)
        target_port = struct.unpack('!H', exact(self.request, 2))[0]
        if host not in ('10.99.0.1', '127.0.0.1', 'localhost') or target_port != self.server.target_port:
            self.request.sendall(b'\x05\x02\x00\x01' + b'\x00' * 6)
            raise ValueError('Non-lab target denied')
        with socket.create_connection(('127.0.0.1', target_port), timeout=5) as upstream:
            self.request.sendall(b'\x05\x00\x00\x01' + b'\x00' * 6)
            self.relay(upstream)

    def destination(self, kind):
        if kind == 1:
            return socket.inet_ntoa(exact(self.request, 4))
        if kind == 3:
            return exact(self.request, exact(self.request, 1)[0]).decode()
        raise ValueError('unsupported address')

    def relay(self, upstream):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            ready, _write, _error = select.select([self.request, upstream], [], [], 1)
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                (upstream if source is self.request else self.request).sendall(data)


class SocksServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = False


def start(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()


def wait(engine, nodes, condition, seconds=35):
    deadline = time.monotonic() + seconds
    last = {}
    while time.monotonic() < deadline:
        engine.touch()
        try:
            value = engine.observe(nodes)
            last = value
            if condition(value):
                return value
        except Exception as error:
            last = {'error_type': type(error).__name__}
            if engine.process.poll() is not None or isinstance(error, TypeError):
                break
        time.sleep(0.5)
    diagnostics = {'observation': last}
    for path in ('/proxies', '/connections'):
        try:
            diagnostics[path] = engine.api(path)
        except Exception as error:
            diagnostics[path] = type(error).__name__
    diagnostics['process_exit'] = engine.process.poll()
    for filename in ('core.log', 'core-stderr.log'):
        logfile = engine.paths.private.parent.parent / filename
        if logfile.is_file():
            lines = logfile.read_text().splitlines()[-12:]
            diagnostics[filename] = [line.replace(engine.api_secret, '[redacted]').replace(engine.probe_secret, '[redacted]') for line in lines]
    raise AssertionError('Native condition did not become true: ' + json.dumps(diagnostics))


def certificate(folder):
    config = folder / 'openssl.cnf'
    config.write_text('[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n'
        '[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.99.0.1\n')
    key, cert = folder / 'fixture.key', folder / 'fixture.crt'
    subprocess.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', str(key), '-out', str(cert), '-days', '1', '-config', str(config)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=20)
    key.chmod(0o600)
    return key, cert


def fixture_config(cert, tls_port, system):
    def configured(*args, **kwargs):
        value = build(*args, **kwargs)
        value['log'] = {'level': 'debug', 'output': str(cert.parent / 'core.log')}
        value['certificate'] = {'store': 'none', 'certificate_path': [str(cert)]}
        for server in value['dns']['servers']:
            server.update(server='127.0.0.1', server_port=tls_port, path='/dns-query',
                          tls={'enabled': True, 'server_name': 'localhost'})
        if system == 'linux':
            for outbound in value['outbounds']:
                if outbound['type'] in ('socks', 'direct'):
                    outbound['bind_interface'] = 'lo'
        return value
    return configured


def lab(core, folder, tun=False):
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    key, cert = certificate(folder)
    https_server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), HTTP)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    https_server.socket = context.wrap_socket(https_server.socket, server_side=True)
    start(https_server)
    peers = [SocksServer(('127.0.0.1', 0), SOCKS) for _ in range(2)]
    for peer in peers:
        peer.target_port = https_server.server_port
        start(peer)
    nodes = assign_ids([{'name': 'lab-' + str(index), 'outbound': {'type': 'socks', 'server': '127.0.0.1',
        'server_port': peer.server_address[1], 'username': 'lab', 'password': 'lab', 'network': 'tcp'}}
        for index, peer in enumerate(peers)], 'native-fixture')
    settings = read_json(ROOT / 'config/defaults.json')
    settings.update(probe_port=port(), api_port=port(), check_interval=5,
        health_url='https://10.99.0.1:' + str(https_server.server_port) + '/health',
        public_ip_url='https://10.99.0.1:' + str(https_server.server_port) + '/ip')
    paths = Paths(base=folder / 'runtime')
    paths.private.mkdir(mode=0o700, parents=True)
    engine = Engine(paths, ROOT, settings, core)
    compatibility.ENV = dict(compatibility.ENV, CURL_CA_BUNDLE=str(cert))
    result = {}
    real_popen = subprocess.Popen
    stderr_log = open(folder / 'core-stderr.log', 'wb')
    def launch(arguments, **kwargs):
        kwargs['stderr'] = stderr_log
        return real_popen(arguments, **kwargs)
    try:
        with mock.patch('tui_vpn.engine.build', fixture_config(cert, https_server.server_port, paths.system)), \
                mock.patch('tui_vpn.engine.subprocess.Popen', side_effect=launch):
            engine.start(nodes, 'auto', lambda: True, tun=tun)
        first = wait(engine, nodes, lambda v: v['state'] == 'RUNNING')
        result['initial'] = first
        other = next(n['id'] for n in nodes if n['id'] != first['selected'])
        engine.select(other)
        assert engine.api('/proxies/proxy')['now'] == other
        engine.select('auto')
        failing = next(i for i, n in enumerate(nodes) if n['id'] == first['selected'])
        peers[failing].shutdown()
        peers[failing].server_close()
        second = wait(engine, nodes, lambda v: v['state'] == 'RUNNING' and v['selected'] != first['selected'])
        assert second['rx_bytes'] > 0 and second['tx_bytes'] > 0
        result.update(failover=second, manual_selector=True, real_native_counters=True)
        if tun:
            try:
                result['system_test'] = engine.test()
            except Exception as error:
                diagnostics = {}
                for label, arguments in [('rules', ['-j', 'rule']),
                        ('routes', ['-j', 'route', 'show', 'table', 'all']),
                        ('tcp_route', ['-j', 'route', 'get', '1.1.1.1', 'ipproto', 'tcp', 'dport', '443'])]:
                    probe = subprocess.run(['/usr/sbin/ip'] + arguments, capture_output=True, text=True, timeout=3)
                    diagnostics[label] = probe.stdout
                raise AssertionError(str(error) + '; native routing: ' + json.dumps(diagnostics)) from error
            assert result['system_test']['ipv4'] == '198.51.100.77'
        result.update(status='PASS', tun_test=tun, real_provider_credentials=False,
                      allowed_targets='loopback SOCKS/TLS and synthetic 10.99.0.1 only')
    finally:
        engine.stop()
        stderr_log.close()
        for peer in peers:
            peer.shutdown()
            peer.server_close()
        https_server.shutdown()
        https_server.server_close()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--core', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tun', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='tui-vpn-native-') as temporary:
        try:
            result = lab(args.core.resolve(), Path(temporary), args.tun)
        except Exception as error:
            args.output.write_text(json.dumps({'status': 'FAIL', 'error': str(error)}, indent=2) + '\n')
            raise
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'status': result['status'], 'tun': args.tun,
                          'manual_selector': True, 'native_counters': True}))
