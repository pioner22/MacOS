"""Manual SOCKS5 data stays inside the owner-authenticated service boundary."""
from __future__ import annotations

import copy
import ipaddress
import re
from typing import Any

from .common import AppError, clean
from .profiles import validate_outbound


def server_host(value: Any) -> str:
    if not isinstance(value, str):
        raise AppError('Укажите адрес SOCKS5-сервера.')
    host = value.strip()
    if host.startswith('[') and host.endswith(']'):
        host = host[1:-1]
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        pass
    try:
        host = host.encode('idna').decode('ascii').lower().rstrip('.')
    except UnicodeError:
        raise AppError('Неверный адрес SOCKS5-сервера.')
    labels = host.split('.')
    valid = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z')
    if not host or len(host) > 253 or any(not valid.fullmatch(part) for part in labels):
        raise AppError('Введите имя сервера или IP-адрес без схемы и пути.')
    return host


def server_port(port: Any) -> int:
    if isinstance(port, str) and port.isascii() and port.isdecimal():
        port = int(port)
    if type(port) is not int or not 1 <= port <= 65535:
        raise AppError('Порт должен быть числом от 1 до 65535.')
    return port


def authentication(args: dict, previous: dict | None = None) -> dict:
    user, password = args.get('username', ''), args.get('password')
    if password is None:
        password = (previous or {}).get('password', '')
    if not all(isinstance(value, str) for value in (user, password)):
        raise AppError('Логин и пароль должны быть текстом.')
    if not user and args.get('password') is None:
        password = ''  # Clearing the login explicitly removes saved authentication.
    if bool(user) != bool(password):
        raise AppError('Заполните логин и пароль вместе или оставьте оба пустыми.')
    if any(len(value.encode('utf-8')) > 255 or any(ord(c) < 32 for c in value)
           for value in (user, password)):
        raise AppError('Реквизиты SOCKS5 слишком длинные или содержат управляющие символы.')
    return {'username': user, 'password': password} if user else {}


def socks_profile(args: dict, previous: dict | None = None) -> dict:
    host, port = server_host(args.get('host', '')), server_port(args.get('port'))
    if not isinstance(args.get('name', ''), str):
        raise AppError('Название должно быть текстом.')
    outbound = dict(type='socks', server=host, server_port=port, **authentication(args, previous))
    return {'name': clean(args.get('name') or host, 120), 'outbound': validate_outbound(outbound)}


def find_local_socks(data: dict, node_id: str) -> tuple[dict, dict]:
    for source in data['subscriptions']:
        for node in source['nodes']:
            if node['id'] != node_id:
                continue
            if source.get('url') or node.get('outbound', {}).get('type') != 'socks':
                raise AppError('Редактировать можно локальное подключение SOCKS5. Серверы подписки обновляются по ссылке.')
            return source, node
    raise AppError('Подключение SOCKS5 не найдено.')


def socks_details(data: dict, node_id: str) -> dict:
    _source, node = find_local_socks(data, node_id)
    outbound = node['outbound']
    return {'id': node['id'], 'name': node['name'], 'host': outbound['server'],
            'port': outbound['server_port'], 'username': outbound.get('username', ''),
            'has_password': bool(outbound.get('password'))}


def edit_socks(data: dict, args: dict) -> dict:
    value = copy.deepcopy(data)
    source, node = find_local_socks(value, args.get('id', ''))
    changed = socks_profile(args, node['outbound'])
    node.update(changed)  # Keep the persistent node ID and manual selection.
    if len(source['nodes']) == 1:
        source['name'] = node['name']
    return value


def remove_local_node(data: dict, node_id: str) -> dict:
    value = copy.deepcopy(data)
    for source in value['subscriptions']:
        if not any(node['id'] == node_id for node in source['nodes']):
            continue
        if source.get('url'):
            raise AppError('Этот сервер получен по ссылке. Удалите источник на вкладке «Подписки».')
        source['nodes'] = [node for node in source['nodes'] if node['id'] != node_id]
        value['subscriptions'] = [item for item in value['subscriptions'] if item['nodes']]
        return value
    raise AppError('Сервер не найден.')
