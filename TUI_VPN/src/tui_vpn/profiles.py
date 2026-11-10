"""Import protocol data only. Subscription content never supplies files or code."""
from __future__ import annotations
from typing import Any
import base64
import configparser
import copy
import hashlib
import json
import re
from urllib.parse import unquote, urlsplit
from .common import AppError, clean
from vendor import legacy_runtime

KINDS = {'vless', 'trojan', 'socks', 'shadowsocks', 'vmess', 'hysteria2'}
FORBIDDEN = {'detour', 'bind_interface', 'routing_mark', 'network_namespace', 'protect_path',
             'plugin', 'plugin_opts', 'script', 'command', 'executable'}


def no_files(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN or key.endswith(('_path', '_file')):
                raise AppError('Внешние пути и параметры системного доступа запрещены.')
            no_files(child)
    elif isinstance(value, list):
        for child in value:
            no_files(child)


def validate_outbound(value: Any) -> dict:
    value = copy.deepcopy(value)
    no_files(value)
    if value.get('type') not in KINDS or not isinstance(value.get('server'), str):
        raise AppError('Неподдерживаемый профиль сервера.')
    if not re.fullmatch(r'[A-Za-z0-9.:%_-]{1,253}', value['server']):
        raise AppError('Неверный адрес сервера.')
    if type(value.get('server_port')) is not int or not 1 <= value['server_port'] <= 65535:
        raise AppError('Неверный порт сервера.')
    tls = value.get('tls', {})
    if tls.get('insecure') or value['type'] in ('trojan', 'vless') and not tls.get('enabled'):
        raise AppError('Для Trojan/VLESS нужна проверка TLS; insecure запрещён.')
    value.pop('tag', None)
    if value['type'] == 'socks':
        value.update(version='5', network='tcp')
    return value


def socks_uri(uri: str) -> dict:
    value = urlsplit(uri)
    if not value.hostname or not value.port:
        raise AppError('В SOCKS5 URI нужен адрес и порт.')
    result = {'type': 'socks', 'server': value.hostname, 'server_port': value.port}
    if value.username is not None:
        result.update(username=unquote(value.username), password=unquote(value.password or ''))
    return result


def parse_uri(uri: str) -> dict:
    try:
        if uri.startswith(('socks5://', 'socks://')):
            value = socks_uri(uri)
        else:
            value = legacy_runtime.parse_uri(uri)['outbound']
        return {'name': clean(unquote(urlsplit(uri).fragment) or value['server']),
                'outbound': validate_outbound(value)}
    except (ValueError, KeyError, legacy_runtime.VPNError):
        raise AppError('URI не поддерживается. Используйте VLESS/Trojan TLS или SOCKS5.')


def decode64(value: Any) -> bytes:
    value = value.strip()
    return base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)


def parse_feed(raw: Any) -> list:
    if not raw or len(raw) > 2097152:
        raise AppError('Пустая или слишком большая подписка.')
    text = raw.decode('utf-8-sig').strip()
    if text.startswith(('{', '[')):
        return json_feed(json.loads(text))
    if '://' not in text:
        text = decode64(text).decode('utf-8-sig')
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith('#')]
    if not 1 <= len(lines) <= 200:
        raise AppError('Подписка должна содержать от 1 до 200 серверов.')
    return [parse_uri(line) for line in lines]


def json_feed(value: Any) -> list:
    entries = value if isinstance(value, list) else value.get('outbounds', [value])
    nodes = []
    for item in entries:
        if not isinstance(item, dict) or item.get('type') not in KINDS:
            continue
        nodes.append({'name': clean(item.get('tag', item.get('server', 'Сервер'))),
                      'outbound': validate_outbound(item)})
    if not 1 <= len(nodes) <= 200:
        raise AppError('В JSON нет поддерживаемых серверов либо их больше 200.')
    return nodes


def assign_ids(nodes: list, source_id: str) -> list:
    result = []
    for index, node in enumerate(nodes):
        node = copy.deepcopy(node)
        public = '%s:%s:%s:%s' % (source_id, index, node['name'], node.get('outbound', {}).get('server', 'wg'))
        node['id'] = 'n-' + hashlib.sha256(public.encode()).hexdigest()[:16]
        result.append(node)
    return result


def wg_key(value: Any) -> str:
    try:
        if len(base64.b64decode(value, validate=True)) != 32:
            raise ValueError()
    except (ValueError, TypeError):
        raise AppError('Неверный ключ WireGuard; значение скрыто.')
    return value


def wireguard(raw: Any) -> dict:
    if len(raw) > 65536:
        raise AppError('Профиль WireGuard слишком большой.')
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    parser.read_string(raw.decode('utf-8-sig'))
    if parser.sections() != ['Interface', 'Peer']:
        raise AppError('Нужен обычный WireGuard: один Interface и один Peer.')
    interface, peer = parser['Interface'], parser['Peer']
    allowed_i = {'privatekey', 'address', 'dns', 'mtu', 'listenport'}
    allowed_p = {'publickey', 'presharedkey', 'endpoint', 'allowedips', 'persistentkeepalive'}
    if set(interface) - allowed_i or set(peer) - allowed_p:
        raise AppError('Скрипты и расширения AmneziaWG не поддерживаются.')
    endpoint = urlsplit('//' + peer['endpoint'])
    addresses = [x.strip() for x in interface['address'].split(',')]
    routes = [x.strip() for x in peer['allowedips'].split(',')]
    import ipaddress
    for address in addresses + routes:
        ipaddress.ip_interface(address)
    if '0.0.0.0/0' not in routes or not endpoint.hostname or not endpoint.port:
        raise AppError('Нужен WireGuard с полным IPv4-маршрутом и endpoint.')
    mtu, keepalive = int(interface.get('mtu', '1400')), int(peer.get('persistentkeepalive', '25'))
    if not 576 <= mtu <= 1500 or not 0 <= keepalive <= 300:
        raise AppError('Неверный MTU или keepalive WireGuard.')
    target = {'address': endpoint.hostname, 'port': endpoint.port, 'public_key': wg_key(peer['publickey']),
              'allowed_ips': routes, 'persistent_keepalive_interval': keepalive}
    if 'presharedkey' in peer:
        target['pre_shared_key'] = wg_key(peer['presharedkey'])
    return {'name': 'WireGuard ' + clean(endpoint.hostname), 'endpoint': {
        'type': 'wireguard', 'system': False, 'address': addresses, 'mtu': mtu,
        'private_key': wg_key(interface['privatekey']), 'peers': [target]}}
