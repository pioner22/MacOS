"""Persistent requested state and bounded RPC, separate from core supervision."""
from __future__ import annotations
from typing import Any
import copy
import signal
import threading
import time
from pathlib import Path
from .catalog import Catalog
from .common import AppError, Paths, clean, digest, read_json, read_private_json, load_settings, owner_lock
from .engine import Engine
from .health_checks import HealthChecks
from .manual_profiles import socks_profile, socks_details, edit_socks, remove_local_node
from .network import fetch_worker
from .profiles import parse_feed, parse_uri, wireguard, json_feed


class Manager:
    def __init__(self, paths: Any, root: Any, engine: Any=None) -> None:
        self.paths, self.root = paths, Path(root)
        self.settings = load_settings(root)
        self.version = (self.root / 'VERSION').read_text().strip()
        self.source_sha = digest(self.root / 'manifest.json')
        self.catalog = Catalog(paths)
        self.engine = engine or Engine(paths, root, self.settings)
        self.health = HealthChecks(paths, root, self.settings)
        self.control_generation = 0
        self.lock, self.operation = threading.RLock(), threading.Lock()
        self.stop_event = threading.Event()
        self.changed = threading.Event()
        self.view = {'state': 'OFF', 'selected': None, 'health': {}, 'rx_bytes': 0,
                     'tx_bytes': 0, 'rx_rate': 0, 'tx_rate': 0, 'connections': 0, 'memory_bytes': 0}
        self.events, self.pending = [], None
        self.active_revision, self.busy, self.updated_at = -1, '', time.time()
        if self.catalog.state['enabled']:
            self.view['state'] = 'STARTING'

    def event(self, message: str) -> None:
        with self.lock:
            self.events.append({'at': time.time(), 'message': clean(message, 180)})
            self.events = self.events[-100:]

    def wanted(self) -> bool:
        return not self.stop_event.is_set() and self.catalog.state['enabled']

    def status(self) -> dict:
        with self.lock:
            value = copy.deepcopy(self.view)
            nodes = self.probe_nodes()
            reachability, checks = self.health.snapshot(nodes)
            value.update(enabled=self.catalog.state['enabled'], selection=self.catalog.state['selection'],
                subscriptions=self.catalog.public_subscriptions(), busy=self.busy, events=self.events[-40:],
                updated_at=self.updated_at, stale=time.time() - self.updated_at > 8)
            value['snapshot_at'] = time.monotonic()
            value.update(version=self.version, source_sha256=self.source_sha)
            sources = {n['id']: source for source in self.catalog.data['subscriptions'] for n in source['nodes']}
            value['servers'] = [dict(public_node(n, value.get('health', {}).get(n['id'], {})),
                reachability=reachability[n['id']], source_id=sources[n['id']]['id'],
                source_name=sources[n['id']]['name'], remote=bool(sources[n['id']].get('url')))
                for n in nodes]
            value['probes'] = checks
            return value

    def probe_nodes(self) -> list:
        return [dict(copy.deepcopy(node), _manual_socks=not source.get('url')
                     and node.get('outbound', {}).get('type') == 'socks')
                for source in self.catalog.data['subscriptions'] for node in source['nodes']]

    def dispatch(self, command: str, args: Any) -> dict:
        if not isinstance(args, dict):
            raise AppError('Неверные параметры команды.')
        if command == 'status':
            return self.status()
        if command == 'socks_details':
            with self.lock:
                return {'socks_form': socks_details(self.catalog.data, args.get('id', ''))}
        if command == 'probe':
            with self.lock:
                nodes = self.probe_nodes()
                if not nodes:
                    raise AppError('Сначала добавьте подписку или подключение SOCKS5.')
                started = self.health.start(nodes)
                return dict(self.status(), probe_started=started)
        actions = {'on': self.on, 'off': self.off, 'select': self.select, 'test': self.test,
            'subscription_add': self.add, 'subscription_refresh': self.refresh,
            'subscription_edit': self.edit,
            'subscription_delete': self.delete, 'uri_add': self.uri,
            'wireguard_add': self.wg, 'import_existing': self.import_existing,
            'socks_save': self.socks_save, 'server_delete': self.server_delete}
        if command not in actions:
            raise AppError('Неизвестная команда управления.')
        if command in ('on', 'off'):
            return actions[command](args)
        if not self.operation.acquire(blocking=False):
            raise AppError('Другая операция ещё выполняется.')
        try:
            self.busy = command
            return actions[command](args)
        finally:
            self.busy = ''
            self.operation.release()

    def on(self, _args: Any) -> dict:
        with self.lock:
            if not self.catalog.nodes():
                raise AppError('Сначала добавьте подписку или профиль сервера.')
            if self.catalog.state['enabled']:
                return self.status()
            self.control_generation += 1
            generation = self.control_generation
        try:
            self.engine.guard()
        except Exception:
            raise AppError('Проверьте интернет и отключите другой VPN перед включением.') from None
        with self.lock:
            if generation != self.control_generation:
                return self.status()
            if not self.catalog.nodes():
                raise AppError('Сначала добавьте подписку или профиль сервера.')
            self.catalog.enable(True)
            if self.view['state'] == 'OFF':
                self.view['state'] = 'STARTING'
            self.event('VPN: включение запрошено')
            self.changed.set()
        return self.status()

    def off(self, _args: Any) -> dict:
        with self.lock:
            self.control_generation += 1
            self.pending = None
            self.catalog.enable(False)
            self.view['state'] = 'STOPPING' if self.engine.process else 'OFF'
            self.event('VPN: ручное выключение сохранено')
            self.changed.set()
        self.health.cancel()
        return self.status()

    def select(self, args: Any) -> dict:
        node_id = args.get('id', 'auto')
        with self.lock:
            previous = self.catalog.state['selection']
            self.catalog.select(node_id)
        try:
            self.engine.select(node_id)
        except Exception:
            with self.lock:
                self.catalog.select(previous)
            raise AppError('Ядро не подтвердило выбор сервера. Прежний выбор сохранён.')
        self.event('Выбран автоматический режим' if node_id == 'auto' else 'Выбран сервер вручную')
        return self.status()

    def test(self, _args: Any) -> dict:
        if not self.wanted() or not self.engine.process:
            raise AppError('VPN выключен или ещё запускается.')
        result = self.engine.test()
        self.event('Системные маршруты и HTTPS: проверка успешна')
        return dict(self.status(), test=result)

    def apply(self, candidate: Any, allow_fallback: bool=True) -> dict:
        with self.lock:
            if candidate == self.catalog.data:
                self.event('Список подключений уже актуален')
                return self.status()
        nodes = [n for s in candidate['subscriptions'] for n in s['nodes']]
        self.engine.check(nodes, self.catalog.state['selection'])
        with self.lock:
            old = copy.deepcopy(self.catalog.data)
            was_healthy = self.view['state'] == 'RUNNING'
            self.catalog.commit(candidate)
            self.health.invalidate(self.probe_nodes())
            if not nodes:
                self.catalog.enable(False)
            self.pending = (self.catalog.revision, old, time.monotonic() + 60) if was_healthy and nodes and allow_fallback else None
            self.changed.set()
        self.event('Список серверов обновлён; данные предыдущей версии сохранены')
        return self.status()

    def add(self, args: Any) -> dict:
        url = args.get('url', '').strip()
        nodes = parse_feed(fetch_worker(self.root, url, self.settings['fetch_timeout']))
        return self.apply(self.catalog.candidate(nodes, args.get('name', ''), url))

    def refresh(self, args: Any) -> dict:
        item = next((s for s in self.catalog.data['subscriptions'] if s['id'] == args.get('id')), None)
        if item is None or not item.get('url'):
            raise AppError('У выбранного профиля нет ссылки подписки.')
        nodes = parse_feed(fetch_worker(self.root, item['url'], self.settings['fetch_timeout']))
        return self.apply(self.catalog.candidate(nodes, item['name'], item['url'], item['id']))

    def edit(self, args: dict) -> dict:
        item = next((s for s in self.catalog.data['subscriptions'] if s['id'] == args.get('id')), None)
        if item is None:
            raise AppError('Подписка не найдена.')
        url = args.get('url', '').strip()
        nodes = parse_feed(fetch_worker(self.root, url, self.settings['fetch_timeout']))
        return self.apply(self.catalog.candidate(nodes, item['name'], url, item['id']))

    def socks_save(self, args: dict) -> dict:
        if args.get('id'):
            candidate = edit_socks(self.catalog.data, args)
        else:
            node = socks_profile(args)
            candidate = self.catalog.candidate([node], node['name'])
        return self.apply(candidate)

    def server_delete(self, args: dict) -> dict:
        return self.apply(remove_local_node(self.catalog.data, args.get('id', '')), allow_fallback=False)

    def delete(self, args: Any) -> dict:
        value = copy.deepcopy(self.catalog.data)
        before = len(value['subscriptions'])
        value['subscriptions'] = [s for s in value['subscriptions'] if s['id'] != args.get('id')]
        if len(value['subscriptions']) == before:
            raise AppError('Подписка не найдена.')
        return self.apply(value, allow_fallback=False)

    def uri(self, args: Any) -> dict:
        node = parse_uri(args.get('uri', ''))
        return self.apply(self.catalog.candidate([node], args.get('name') or node['name']))

    def wg(self, args: Any) -> dict:
        node = wireguard(args.get('text', '').encode())
        return self.apply(self.catalog.candidate([node], args.get('name') or node['name']))

    def import_existing(self, _args: Any) -> dict:
        if self.paths.system != 'darwin':
            raise AppError('Импорт BigSurVPN доступен только на Mac.')
        path = Path('/Library/BigSurVPN/auto/private/profiles.json')
        if path.is_file():
            value = read_json(path)
            entries = [value[k] for k in ('xray', 'socks5') if value.get(k)]
        else:
            value = read_json('/Library/BigSurVPN/private/profiles.json')
            entries = [n['outbound'] for n in value.get('nodes', [])]
            if value.get('socks5', {}).get('outbound'):
                entries.append(value['socks5']['outbound'])
        return self.apply(self.catalog.candidate(json_feed({'outbounds': entries}), 'Импорт BigSurVPN'))

    def supervise(self) -> None:
        retry = 2
        while not self.stop_event.is_set():
            try:
                self._cycle()
                retry = 2
            except Exception:
                self.engine.stop()
                with self.lock:
                    self.view.update(state='RETRYING' if self.wanted() else 'OFF', selected=None)
                    self.updated_at = time.time()
                self.event('Запуск не подтверждён; проверьте доступность и другой активный VPN')
                self.changed.wait(retry)
                self.changed.clear()
                retry = min(retry * 2, 30)
        self.engine.stop()

    def _cycle(self) -> None:
        if not self.wanted():
            self.engine.stop()
            self.active_revision = -1
            with self.lock:
                self.view.update(state='OFF', selected=None, health={}, rx_rate=0, tx_rate=0, connections=0, memory_bytes=0)
                self.updated_at = time.time()
            self.stop_event.wait(0.25)
            return
        if self.active_revision != self.catalog.revision or self.engine.process is None:
            self.engine.stop()
            with self.lock:
                nodes, selection, revision = copy.deepcopy(self.catalog.nodes()), self.catalog.state['selection'], self.catalog.revision
                self.view.update(state='STARTING', health={}, selected=None, rx_rate=None, tx_rate=None)
            self.engine.start(nodes, selection, self.wanted)
            self.active_revision = revision
        if self.engine.process and self.engine.process.poll() is not None:
            raise AppError('Ядро завершилось.')
        self._rollback_pending()
        self.stop_event.wait(0.25)

    def _rollback_pending(self) -> None:
        with self.lock:
            if not self.pending:
                return
            revision, previous, deadline = self.pending
            if revision != self.catalog.revision or self.view['state'] == 'RUNNING':
                self.pending = None
            elif time.monotonic() > deadline:
                self.catalog.commit(previous)
                self.health.invalidate(self.probe_nodes())
                self.pending = None
                self.event('Новая подписка не подтвердила связь: возвращён предыдущий список')

    def monitor(self) -> None:
        while not self.stop_event.wait(1):
            if self.engine.process and self.wanted():
                try:
                    process, revision = self.engine.process, self.active_revision
                    value = self.engine.observe(self.catalog.nodes())
                    with self.lock:
                        if self.wanted() and self.engine.process is process and revision == self.active_revision == self.catalog.revision:
                            self.view.update(value)
                            self.updated_at = time.time()
                except Exception:
                    with self.lock:
                        if self.wanted():
                            self.view.update(state='CHECKING', rx_rate=None, tx_rate=None, memory_bytes=None)

    def touch(self) -> None:
        while not self.stop_event.is_set():
            if self.wanted():
                self.engine.touch()
            self.stop_event.wait(self.settings['check_interval'])


def public_node(node: Any, health: dict) -> dict:
    value = node.get('outbound', {})
    if 'endpoint' in node:
        value = dict(node['endpoint'], server=node['endpoint']['peers'][0]['address'],
                     server_port=node['endpoint']['peers'][0]['port'])
    return dict(health, id=node['id'], name=node['name'], kind=value['type'],
                host=value['server'], port=value['server_port'])


def daemon(root: Any) -> None:
    import os
    import socket
    import stat
    from .ipc import Server
    if os.geteuid() != 0:
        raise AppError('Служба запускается только системным менеджером от root.')
    paths = Paths()
    manager = Manager(paths, root)
    with owner_lock(paths.private / 'daemon.lock'):
        # A crashed daemon may leave only its socket inode. The exclusive lock
        # proves there is no live owner; never replace an arbitrary file.
        if os.path.lexists(str(paths.socket)):
            if not stat.S_ISSOCK(paths.socket.lstat().st_mode):
                raise AppError('Путь сокета занят неизвестным объектом.')
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.3)
                try:
                    probe.connect(str(paths.socket))
                except ConnectionRefusedError:
                    pass
                else:
                    raise AppError('На этом сокете уже работает другой процесс.')
            paths.socket.unlink()
        owner = read_private_json(paths.private / 'owner.json')['uid']
        if type(owner) is not int or owner < 0:
            raise AppError('Неверный владелец управления.')
        server = Server(paths, owner, manager)
        signal.signal(signal.SIGTERM, lambda *_: (manager.stop_event.set(), manager.changed.set()))
        signal.signal(signal.SIGINT, lambda *_: (manager.stop_event.set(), manager.changed.set()))
        threads = [threading.Thread(target=target, daemon=True) for target in
                   (server.serve_forever, manager.monitor, manager.touch)]
        for thread in threads:
            thread.start()
        try:
            manager.supervise()
        finally:
            manager.stop_event.set()
            manager.health.close()
            server.shutdown()
            server.server_close()
            paths.socket.unlink(missing_ok=True)
