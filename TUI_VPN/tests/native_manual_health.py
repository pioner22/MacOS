#!/usr/bin/env python3
"""Exercise manual selection beyond the 45-second health TTL, without TUN."""
import argparse
import http.server
import json
import ssl
import sys
import tempfile
import time
from pathlib import Path
from unittest import mock

import native_lab as lab


def scenario(core: Path, folder: Path) -> dict:
    key, cert = lab.certificate(folder)
    https = http.server.ThreadingHTTPServer(('127.0.0.1', 0), lab.HTTP)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    https.socket = context.wrap_socket(https.socket, server_side=True)
    peer = lab.SocksServer(('127.0.0.1', 0), lab.SOCKS)
    peer.target_port = https.server_port
    lab.start(https)
    lab.start(peer)
    try:
        return observe(core, folder, cert, https.server_port, peer)
    finally:
        peer.shutdown()
        peer.server_close()
        https.shutdown()
        https.server_close()


def observe(core: Path, folder: Path, cert: Path, tls_port: int, peer: object) -> dict:
    nodes = lab.assign_ids([{'name': 'Manual fixture', 'outbound': {
        'type': 'socks', 'server': '127.0.0.1', 'server_port': peer.server_address[1],
        'username': 'lab', 'password': 'lab', 'network': 'tcp'}}], 'manual-fixture')
    settings = lab.read_json(lab.ROOT / 'config/defaults.json')
    settings.update(probe_port=lab.port(), api_port=lab.port(), check_interval=5,
                    health_url='https://10.99.0.1:' + str(tls_port) + '/health')
    paths = lab.Paths(base=folder / 'runtime')
    paths.private.mkdir(mode=0o700, parents=True)
    engine = lab.Engine(paths, lab.ROOT, settings, core)
    lab.compatibility.ENV = dict(lab.compatibility.ENV, CURL_CA_BUNDLE=str(cert))
    try:
        with mock.patch('tui_vpn.engine.build', lab.fixture_config(cert, tls_port, paths.system)):
            engine.start(nodes, nodes[0]['id'], lambda: True, tun=False)
        initial = lab.wait(engine, nodes, lambda s: s['state'] == 'RUNNING')
        initial_history = engine.api('/proxies')['proxies'][nodes[0]['id']]['history']
        deadline = time.monotonic() + 48
        requests = 0
        while time.monotonic() < deadline:
            body, _meta = lab.compatibility.http(settings['health_url'], auth=engine.probe_secret, timeout=4)
            assert body == b'isolated-native-lab'
            requests += 1
            time.sleep(min(4, max(0, deadline - time.monotonic())))
        final = engine.observe(nodes)
        history = engine.api('/proxies')['proxies'][nodes[0]['id']]['history']
        unchanged = engine.api('/proxies/proxy')['now'] == nodes[0]['id']
        result = {'initial': initial['state'], 'final': final['state'],
                  'https_requests': requests, 'manual_selection_preserved': unchanged,
                  'history_refreshed': history != initial_history, 'elapsed_seconds': 48,
                  'system_tun_used': False, 'real_native_core': True}
        assert unchanged, result
        assert final['state'] == 'RUNNING' and history != initial_history, result
        result['status'] = 'PASS'
        return result
    finally:
        engine.stop()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--core', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='manual-health-') as directory:
        try:
            result = scenario(args.core.resolve(), Path(directory))
        except Exception as error:
            result = {'status': 'FAIL', 'error': str(error)}
            args.output.write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))
            sys.exit(1)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))


if __name__ == '__main__':
    main()
