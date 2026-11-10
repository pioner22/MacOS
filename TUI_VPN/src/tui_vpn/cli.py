"""Normal commands use authenticated local IPC; only installation needs root."""
from __future__ import annotations
from typing import Any
import argparse
import json
import os
import platform
import sys
from .common import AppError, Paths


def show(value: Any) -> None:
    from .ui import STATES, human
    print('VPN: ' + STATES.get(value.get('state'), 'НЕТ НАБЛЮДЕНИЯ'))
    print('Режим: ' + ('автоматический' if value.get('selection') == 'auto' else 'ручной'))
    selected = next((n['name'] for n in value.get('servers', []) if n['id'] == value.get('selected')), '—')
    print('Сервер: ' + selected)
    print('Трафик: ↓ %s  ↑ %s' % (human(value.get('rx_rate'), True), human(value.get('tx_rate'), True)))
    if value.get('test'):
        print('Проверенный выходной IPv4: ' + value['test']['ipv4'])
    if value.get('stale'):
        print('Наблюдение устарело; наличие процесса не доказывает связь.')


def doctor(root: Any) -> None:
    import curses
    import ctypes
    import ssl
    import sqlite3
    paths = Paths()
    print(json.dumps({'platform': sys.platform, 'architecture': platform.machine(),
        'python': platform.python_version(), 'ssl': ssl.OPENSSL_VERSION,
        'sqlite': sqlite3.sqlite_version,
        'curses': bool(curses), 'ctypes': bool(ctypes), 'socket_present': paths.socket.exists(),
        'version': (root / 'VERSION').read_text().strip()}, ensure_ascii=False, indent=2))


def main(root: Any, argv: Any=None) -> int:
    parser = argparse.ArgumentParser(description='TUI VPN: терминальный интерфейс и постоянная служба')
    parser.add_argument('command', nargs='?', default='tui', choices=[
        'tui', 'status', 'on', 'off', 'test', 'logs', 'auto', 'doctor', 'update',
        'rollback', 'uninstall', '_daemon', '_fetch', '_install', '_maintain'])
    parser.add_argument('--demo', action='store_true')
    parser.add_argument('--python-tree')
    parser.add_argument('--core-file')
    parser.add_argument('--action', choices=['rollback', 'uninstall'])
    args = parser.parse_args(argv)
    if args.command.startswith('_'):
        internal(root, args)
    else:
        client(root, args)
    return 0


def internal(root: Any, args: Any) -> None:
    if args.command == '_fetch':
        from .network import fetch_https
        value = json.loads(sys.stdin.buffer.read(16385))
        sys.stdout.buffer.write(fetch_https(value['url']))
    elif args.command == '_daemon':
        from .service import daemon
        daemon(root)
    elif args.command == '_install':
        from .installation import install
        if os.geteuid() != 0:
            raise AppError('Установку выполняет системный установщик от root.')
        install(root, args.python_tree, args.core_file)
    elif args.command == '_maintain':
        from .installation import maintain
        if os.geteuid() != 0 or args.action is None:
            raise AppError('Для обслуживания нужна системная авторизация.')
        maintain(args.action)


def client(root: Any, args: Any) -> None:
    if args.command == 'doctor':
        doctor(root)
    elif args.command == 'update':
        from .updates import interactive_update
        interactive_update()
    elif args.command in ('rollback', 'uninstall'):
        from .installation import authorize_maintenance
        authorize_maintenance(args.command)
    elif args.command == 'tui':
        from .ui import main as tui
        tui(args.demo)
    else:
        from .ipc import request
        if args.command == 'logs':
            print(json.dumps(request('status')['events'], ensure_ascii=False, indent=2))
        else:
            value = request('select', {'id': 'auto'}) if args.command == 'auto' else request(args.command)
            show(value)
