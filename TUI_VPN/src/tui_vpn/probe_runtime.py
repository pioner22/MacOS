"""A bounded helper checks native proxy outbounds without TUN or DNS changes."""
from __future__ import annotations

import copy
import ipaddress
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener

from .common import AppError, digest, read_json, validate_probe_settings
from .profiles import validate_outbound


def physical_interface(system: str) -> str:
    args = (['/sbin/route', '-n', 'get', 'default'] if system == 'darwin'
            else ['/usr/sbin/ip', '-j', 'route', 'show', 'table', 'main', 'default'])
    try:
        value = subprocess.run(args, capture_output=True, text=True, timeout=3)
        if value.returncode:
            return ''
        if system == 'darwin':
            match = re.search(r'^\s*interface:\s*(\S+)', value.stdout, re.M)
            name = match.group(1) if match else ''
        else:
            routes = sorted(json.loads(value.stdout), key=lambda item: item.get('metric', 0))
            name = next((item.get('dev', '') for item in routes if item.get('dev')), '')
        if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,32}', name):
            return ''
        return '' if name.startswith(('utun', 'tun', 'tap', 'wg', 'awg', 'ppp')) else name
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return ''


def allowed_address(address: str, manual: bool) -> bool:
    value = ipaddress.ip_address(address)
    if value.is_unspecified or value.is_multicast or value.is_link_local:
        return False
    return value.is_global or manual and (value.is_loopback or value.is_private)


def resolve_addresses(host: str, port: int, manual: bool) -> list:
    try:
        addresses = [str(ipaddress.ip_address(host))]
    except ValueError:
        records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = list(dict.fromkeys(item[4][0] for item in records))
    if not addresses or any(not allowed_address(item, manual) for item in addresses):
        raise AppError('blocked_address')
    return sorted(addresses, key=lambda item: ':' in item)[:4]


def result(node_id: str, state: str, path: str, delay: int | None = None,
           error: str = '') -> dict:
    return {'id': node_id, 'state': state, 'delay_ms': delay,
            'checked_at': time.time(), 'path': path, 'error': error}


def prepare_nodes(nodes: list, interface: str, timeout_ms: int,
                  emit: Callable[[dict], None]) -> tuple[list, dict]:
    outbounds, tags = [], {}
    path = 'direct:' + interface if interface else 'current'
    for node in nodes:
        node_id = node['id']
        if 'outbound' not in node:
            emit(result(node_id, 'unsupported', path, error='wireguard'))
            continue
        try:
            outbound = validate_outbound(node['outbound'])
            host = outbound['server']
            manual = node.get('_manual_socks') is True and outbound['type'] == 'socks'
            addresses = resolve_addresses(host, outbound['server_port'], manual)
        except AppError:
            emit(result(node_id, 'blocked', path, error='address'))
            continue
        except (OSError, ValueError):
            emit(result(node_id, 'error', path, error='dns'))
            continue
        tags[node_id] = {'members': [], 'path': probe_context(addresses, interface)}
        for index, address in enumerate(addresses):
            tag = node_id + '-probe-' + str(index)
            tags[node_id]['members'].append(tag)
            outbounds.append(pinned_outbound(outbound, address, tag, interface, timeout_ms))
    return outbounds, tags


def probe_context(addresses: list, interface: str) -> str:
    if all(ipaddress.ip_address(address).is_loopback for address in addresses):
        return 'local'
    return 'direct:' + interface if interface else 'current'


def pinned_outbound(outbound: dict, address: str, tag: str, interface: str, timeout_ms: int) -> dict:
    value = copy.deepcopy(outbound)
    value.update(tag=tag, server=address, connect_timeout=str(timeout_ms) + 'ms')
    if value.get('tls', {}).get('enabled') and not value['tls'].get('server_name'):
        value['tls']['server_name'] = outbound['server']
    if interface and not ipaddress.ip_address(address).is_loopback:
        for key in ('network_strategy', 'network_type', 'fallback_network_type'):
            value.pop(key, None)
        value['bind_interface'] = interface
    return value


class NativeProbe:
    def __init__(self, core: Path, workspace: Path, outbounds: list) -> None:
        self.core, self.workspace = core, workspace
        self.secret, self.process = secrets.token_hex(24), None
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            self.port = listener.getsockname()[1]
        self.config = {'log': {'disabled': True}, 'inbounds': [], 'outbounds': outbounds,
                       'route': {'final': outbounds[0]['tag']},
                       'experimental': {'clash_api': {
                           'external_controller': '127.0.0.1:' + str(self.port),
                           'secret': self.secret}}}
        self.path = workspace / 'probe.json'

    def start(self) -> None:
        receipt = self.core.parent.parent / 'receipt.json'
        if receipt.is_file() and digest(self.core) != read_json(receipt)['core_sha256']:
            raise AppError('core_integrity')
        with self.path.open('x') as stream:
            os.chmod(self.path, 0o600)
            json.dump(self.config, stream)
        checked = subprocess.run([str(self.core), 'check', '-c', str(self.path)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)
        if checked.returncode:
            raise AppError('core_config')
        self.process = subprocess.Popen([str(self.core), 'run', '-c', str(self.path)],
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, close_fds=True)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise AppError('core_start')
            try:
                with socket.create_connection(('127.0.0.1', self.port), timeout=0.15):
                    return
            except OSError:
                time.sleep(0.05)
        raise AppError('core_timeout')

    def delay(self, tag: str, url: str, timeout_ms: int) -> int:
        query = urlencode({'url': url, 'timeout': timeout_ms})
        request = Request('http://127.0.0.1:' + str(self.port) + '/proxies/' + tag + '/delay?' + query,
                          headers={'Authorization': 'Bearer ' + self.secret})
        with build_opener(ProxyHandler({})).open(request, timeout=timeout_ms / 1000 + 1) as response:
            value = json.loads(response.read(4096))
        delay = value.get('delay')
        if type(delay) is not int or not 0 <= delay <= 65535:
            raise AppError('invalid_reply')
        return delay

    def close(self) -> None:
        if self.process is not None and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        self.path.unlink(missing_ok=True)


def check_node(probe: NativeProbe, node_id: str, tags: list, settings: dict, path: str) -> dict:
    deadline = time.monotonic() + settings['probe_timeout_ms'] / 1000
    for index, tag in enumerate(tags):
        remaining = int((deadline - time.monotonic()) * 1000)
        if remaining < 100:
            break
        allowance = max(100, remaining // (len(tags) - index))
        try:
            delay = probe.delay(tag, settings['health_url'], allowance)
            return result(node_id, 'ok', path, delay)
        except (OSError, ValueError, AppError):
            continue
    return result(node_id, 'failed', path, error='connection')


def run_batch(nodes: list, settings: dict, core: Path, workspace: Path,
              emit: Callable[[dict], None],
              system: str | None = None) -> None:
    interface = physical_interface(system or sys.platform)
    outbounds, tags = prepare_nodes(nodes, interface, settings['probe_timeout_ms'], emit)
    if not outbounds:
        return
    probe = NativeProbe(core, workspace, outbounds)
    try:
        probe.start()
        with ThreadPoolExecutor(max_workers=settings['probe_parallel']) as pool:
            jobs = [pool.submit(check_node, probe, identity, value['members'], settings, value['path'])
                    for identity, value in tags.items()]
            for job in as_completed(jobs):
                emit(job.result())
    except (OSError, ValueError, AppError, subprocess.TimeoutExpired):
        for identity in tags:
            emit(result(identity, 'error', tags[identity]['path'], error='probe'))
    finally:
        probe.close()


def worker(root: Path, payload: dict) -> None:
    workspace = Path(payload['workspace'])
    info = workspace.lstat()
    if (workspace.resolve() != workspace or not workspace.is_dir()
            or not workspace.name.startswith('probe-') or info.st_uid != os.geteuid()
            or info.st_mode & 0o077):
        raise AppError('Небезопасный каталог проверки.')
    nodes, settings = payload['nodes'], payload['settings']
    validate_probe_settings(settings)
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 200:
        raise AppError('Неверный список проверки.')
    if any(not re.fullmatch(r'n-[a-f0-9]{16}', node.get('id', '')) for node in nodes):
        raise AppError('Неверный идентификатор подключения.')
    emit = lambda value: print(json.dumps(value), flush=True)
    run_batch(nodes, settings, root.parent / 'core/sing-box', workspace, emit)
