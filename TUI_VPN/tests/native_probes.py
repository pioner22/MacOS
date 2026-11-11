#!/usr/bin/env python3
"""Native negative cases in a loopback lab; public-CA positives are qualified separately."""
import argparse
import http.server
import json
import socket
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import load_settings
from tui_vpn.profiles import assign_ids
from tui_vpn import probe_runtime
from native_lab import SOCKS, SocksServer, certificate, start


class HealthEndpoint(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    do_HEAD = do_GET


def run(core: Path, folder: Path) -> dict:
    key, cert = certificate(folder)
    https = http.server.ThreadingHTTPServer(('127.0.0.1', 0), HealthEndpoint)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    https.socket = tls.wrap_socket(https.socket, server_side=True)
    peer = SocksServer(('127.0.0.1', 0), SOCKS)
    peer.target_port = https.server_port
    start(https)
    start(peer)
    settings = load_settings(ROOT)
    settings.update(probe_timeout_ms=2000, probe_parallel=2,
                    health_url='https://10.99.0.1:' + str(https.server_port) + '/health')
    try:
        # Prove the fixture's authentication and HTTPS independently, with an
        # explicit per-command CA. This never changes the system trust store.
        curl = subprocess.run(['/usr/bin/curl', '--silent', '--show-error', '--fail',
            '--max-time', '8', '--cacert', str(cert), '--socks5-hostname',
            '127.0.0.1:' + str(peer.server_address[1]), '--proxy-user', 'lab:lab',
            settings['health_url']], capture_output=True, timeout=10)
        assert curl.returncode == 0, 'Synthetic authenticated HTTPS fixture is unavailable'
        with socket.socket() as closed:
            closed.bind(('127.0.0.1', 0))
            nodes = assign_ids([
                {'name': 'untrusted-tls', 'outbound': socks(peer.server_address[1], 'lab')},
                {'name': 'bad-password', 'outbound': socks(peer.server_address[1], 'wrong')},
                {'name': 'unavailable', 'outbound': socks(closed.getsockname()[1], 'lab')},
                {'name': 'untrusted-private-feed', 'outbound': socks(peer.server_address[1], 'lab')},
            ], 'isolated-native-probes')
            for index, node in enumerate(nodes):
                node['_manual_socks'] = index != 3
            results = []
            probe_runtime.run_batch(nodes, settings, core, folder, results.append)
            by_id = {result['id']: result for result in results}
            observed = [by_id[node['id']]['state'] for node in nodes]
            assert observed == ['failed', 'failed', 'failed', 'blocked'], observed
            assert not (folder / 'probe.json').exists()
            return {'status': 'PASS_NEGATIVE_CASES', 'real_native_api': True, 'synthetic_local_https': True,
                    'fixture_authentication_and_explicit_ca': True, 'wrong_password': observed[1],
                    'refused_port': observed[2], 'private_feed_blocked': observed[3],
                    'untrusted_tls_rejected': observed[0] == 'failed',
                    'native_positive': 'Qualified separately against owned Xray/SOCKS5 and public-CA HTTPS',
                    'tun_used': False, 'system_dns_changed': False,
                    'external_destinations_allowed': False}
    finally:
        peer.shutdown()
        peer.server_close()
        https.shutdown()
        https.server_close()


def socks(port: int, password: str) -> dict:
    return {'type': 'socks', 'server': '127.0.0.1', 'server_port': port,
            'username': 'lab', 'password': password, 'version': '5', 'network': 'tcp'}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--core', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.workspace.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='native-probes-', dir=args.workspace) as temporary:
        value = run(args.core, Path(temporary))
    args.output.write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value))


if __name__ == '__main__':
    main()
