"""One native sing-box process. No system DNS file edits or direct VPN fallback."""
from __future__ import annotations
from typing import Any
import datetime
import json
import os
import re
import secrets
import signal
import subprocess
import time
from pathlib import Path
from urllib.request import Request, ProxyHandler, build_opener
from .common import AppError, read_json, write_json, digest
from .configuration import build, LINUX_INPUT_MARK
from vendor import legacy_runtime as mac


class Counters:
    def __init__(self) -> None:
        self.previous = None

    def update(self, rx: int, tx: int, stamp: float) -> dict:
        rates = (0.0, 0.0)
        if self.previous:
            old_rx, old_tx, old_stamp = self.previous
            elapsed = max(0.01, stamp - old_stamp)
            rates = (max(0, rx - old_rx) / elapsed, max(0, tx - old_tx) / elapsed)
        self.previous = (rx, tx, stamp)
        return {'rx_bytes': rx, 'tx_bytes': tx, 'rx_rate': rates[0], 'tx_rate': rates[1]}


def run(args: Any, timeout: int=15) -> subprocess.CompletedProcess:
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=timeout, check=False)
    return result


def stop_process(process: Any) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        process.wait()
        return
    try:
        process.wait(6)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(3)


class Engine:
    def __init__(self, paths: Any, root: Any, settings: dict, core: Any=None) -> None:
        self.paths, self.root, self.settings = paths, Path(root), settings
        self.core = Path(core or paths.current / 'core/sing-box')
        self.process, self.dns = None, None
        self.api_secret, self.probe_secret = secrets.token_hex(24), secrets.token_hex(24)
        self.counters, self.started = Counters(), 0
        if paths.system == 'darwin':
            self._mac_values()
        else:
            mac.ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': '/root', 'TMPDIR': '/var/tmp', 'LANG': 'C'}

    def _mac_values(self) -> None:
        for name, value in {'BASE': str(self.paths.base), 'PRIVATE': str(self.paths.private),
            'CORE': str(self.core), 'CONFIG': str(self.paths.private / 'config.json'),
            'LABEL': self.paths.label, 'IFACE': self.settings['tun_macos'],
            'PORT': self.settings['probe_port'], 'IP_URL': self.settings['public_ip_url']}.items():
            setattr(mac, name, value)

    def check(self, nodes: list, selection: str='auto') -> None:
        if not nodes:
            return
        value = build(nodes, self.settings, self.api_secret, self.probe_secret, self.paths.system, selection)
        path = self.paths.private / 'candidate.json'
        write_json(path, value)
        if run([str(self.core), 'check', '-c', str(path)], 20).returncode:
            raise AppError('Ядро отклонило конфигурацию. Прежняя подписка сохранена.')

    def guard(self) -> None:
        if self.paths.system == 'darwin':
            mac.assert_no_other_vpn()
            return
        if Path('/sys/class/net', self.settings['tun_linux']).exists():
            raise AppError('VPN-интерфейс уже занят; чужой интерфейс не изменён.')
        result = run(['/usr/sbin/ip', '-j', 'route', 'get', '1.1.1.1'])
        if result.returncode:
            raise AppError('Нет исходного маршрута в интернет.')
        device = json.loads(result.stdout)[0].get('dev', '')
        if device.startswith(('tun', 'tap', 'wg', 'awg', 'ppp', 'utun')):
            raise AppError('Обнаружен другой VPN. Сначала выключите его.')

    def start(self, nodes: list, selection: str, wanted: Any, tun: bool=True) -> None:
        self.guard() if tun else None
        receipt = self.core.parent.parent / 'receipt.json'
        if receipt.is_file() and digest(self.core) != read_json(receipt)['core_sha256']:
            raise AppError('Контрольная сумма ядра изменилась.')
        config = build(nodes, self.settings, self.api_secret, self.probe_secret, self.paths.system, selection, tun)
        path = self.paths.private / 'config.json'
        write_json(path, config)
        self.process = subprocess.Popen([str(self.core), 'run', '-c', str(path)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True, close_fds=True)
        self.started, self.counters = time.monotonic(), Counters()
        self._wait_interface(wanted, tun)

    def _wait_interface(self, wanted: Any, tun: bool) -> None:
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if not wanted():
                return
            if self.process.poll() is not None:
                raise AppError('Ядро завершилось при запуске.')
            if not tun:
                return
            if self.paths.system == 'darwin' and mac.interface_state() is not None:
                self.dns = mac.TemporaryDNS()
                mac.install_temporary_dns(self.dns)
                return
            if self.paths.system == 'linux' and Path('/sys/class/net', self.settings['tun_linux']).exists():
                return
            time.sleep(0.2)
        raise AppError('Не удалось создать VPN-интерфейс.')

    def stop(self) -> None:
        try:
            stop_process(self.process)
        finally:
            self.process = None
            if self.dns:
                self.dns.close()
                self.dns = None

    def api(self, resource: str, data: Any=None) -> dict:
        raw = None if data is None else json.dumps(data).encode()
        request = Request('http://127.0.0.1:' + str(self.settings['api_port']) + resource,
            data=raw, headers={'Authorization': 'Bearer ' + self.api_secret, 'Content-Type': 'application/json'},
            method='GET' if raw is None else 'PUT')
        with build_opener(ProxyHandler({})).open(request, timeout=1.5) as response:
            value = response.read(1048577)
            if len(value) > 1048576:
                raise AppError('Ответ локального API слишком большой.')
            return json.loads(value) if value else {}

    def select(self, node_id: str) -> None:
        if self.process and self.process.poll() is None:
            self.api('/proxies/proxy', {'name': node_id})

    def observe(self, nodes: list) -> dict:
        if self.process is None or self.process.poll() is not None:
            raise AppError('Процесс ядра не работает.')
        proxies = self.api('/proxies')['proxies']
        selected = proxies.get('proxy', {}).get('now')
        if selected == 'auto':
            selected = proxies.get('auto', {}).get('now')
        health = {node['id']: native_health(proxies.get(node['id'], {})) for node in nodes}
        snapshot = self.api('/connections')
        metrics = self.counters.update(int(snapshot['downloadTotal']), int(snapshot['uploadTotal']), time.monotonic())
        phase = 'RUNNING' if health.get(selected, {}).get('healthy') else 'CHECKING'
        if phase == 'CHECKING' and time.monotonic() - self.started > 45:
            phase = 'NO_HEALTHY_PATH'
        memory = snapshot.get('memory')
        return dict(metrics, state=phase, selected=selected, health=health,
                    memory_bytes=memory if type(memory) is int else None,
                    connections=len(snapshot.get('connections', [])))

    def touch(self) -> None:
        if not self.process or self.process.poll() is not None:
            return
        # The pinned helper reads credentials from a private curl config, not argv.
        mac.PRIVATE, mac.PORT = str(self.paths.private), self.settings['probe_port']
        try:
            mac.http(self.settings['health_url'], auth=self.probe_secret, timeout=6, max_bytes=4096)
        except mac.VPNError:
            pass  # HTTP 204 still activates URLTest.Touch(). This is not a success verdict.

    def test(self) -> dict:
        process = self.process
        if process is None or process.poll() is not None:
            raise AppError('VPN ещё не запущен.')
        self.assert_routes()
        mac.IP_URL = self.settings['public_ip_url']
        ip, _metadata = mac.public_ip()
        self.assert_routes()
        if self.process is not process or process.poll() is not None:
            raise AppError('Подключение изменилось во время проверки; повторите test.')
        return {'ipv4': ip, 'system_https': True, 'routes': True}

    def assert_routes(self) -> None:
        if self.paths.system == 'darwin':
            mac.assert_routes()
            mac.assert_dns()
        else:
            # nftables applies this native mark before the kernel reroutes a flow.
            # A plain route query intentionally sees the physical default route.
            result = run(['/usr/sbin/ip', '-j', 'route', 'get', '1.1.1.1', 'mark', hex(LINUX_INPUT_MARK)])
            if result.returncode or json.loads(result.stdout)[0].get('dev') != self.settings['tun_linux']:
                raise AppError('Системный маршрут не подтверждён через VPN.')


def native_health(proxy: dict) -> dict:
    try:
        last = proxy.get('history', [])[-1]
        whole_seconds = re.sub(r'\.\d+(?=Z$|[+-]\d\d:\d\d$)', '', last['time'])
        stamp = datetime.datetime.fromisoformat(whole_seconds.replace('Z', '+00:00')).timestamp()
        delay = last['delay']
        healthy = type(delay) in (int, float) and delay >= 0 and 0 <= time.time() - stamp <= 45
        return {'healthy': healthy, 'delay_ms': delay if healthy else None}
    except (KeyError, IndexError, TypeError, ValueError):
        return {'healthy': False, 'delay_ms': None}
