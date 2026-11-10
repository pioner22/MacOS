"""Native selector + URLTest own manual selection and automatic failover."""
from __future__ import annotations
import copy

LINUX_INPUT_MARK = 0x2023  # Native sing-box auto_redirect input policy, pinned to 1.14.


def build(nodes: list, settings: dict, api_secret: str, probe_secret: str, system: str, selection: str='auto', tun: bool=True) -> dict:
    tags = [n['id'] for n in nodes]
    outbounds, endpoints = [], []
    for node in nodes:
        if 'endpoint' in node:
            endpoints.append(dict(copy.deepcopy(node['endpoint']), tag=node['id']))
        else:
            outbounds.append(dict(copy.deepcopy(node['outbound']), tag=node['id']))
    outbounds += [{'type': 'urltest', 'tag': 'auto', 'outbounds': tags, 'url': settings['health_url'],
         'interval': str(settings['check_interval']) + 's', 'idle_timeout': '24h',
         'tolerance': settings['tolerance_ms'], 'interrupt_exist_connections': True},
        {'type': 'selector', 'tag': 'proxy', 'outbounds': ['auto'] + tags,
         'default': selection if selection in tags else 'auto', 'interrupt_exist_connections': True}]
    config = {'log': {'disabled': True}, 'endpoints': endpoints, 'outbounds': outbounds,
        'inbounds': [{'type': 'mixed', 'tag': 'probe', 'listen': '127.0.0.1',
                     'listen_port': settings['probe_port'], 'users': [{'username': 'probe', 'password': probe_secret}]}],
        'experimental': {'clash_api': {'external_controller': '127.0.0.1:' + str(settings['api_port']),
                                       'secret': api_secret}},
        'dns': {'servers': [
            {'type': 'https', 'tag': 'bootstrap-dns', 'server': settings['bootstrap_dns'],
             'tls': {'enabled': True, 'server_name': settings['dns_tls_name']}},
            {'type': 'https', 'tag': 'remote-dns', 'server': settings['bootstrap_dns'],
             'tls': {'enabled': True, 'server_name': settings['dns_tls_name']}, 'detour': 'proxy'}],
            'final': 'remote-dns', 'strategy': 'prefer_ipv4'},
        'route': {'auto_detect_interface': True, 'default_domain_resolver': 'bootstrap-dns',
                  'final': 'proxy', 'rules': [{'port': 53, 'action': 'hijack-dns'}]}}
    if tun:
        inbound = {'type': 'tun', 'tag': 'tun', 'interface_name': settings['tun_macos' if system == 'darwin' else 'tun_linux'],
            'address': ['172.29.255.1/30', 'fd56:76aa:6273::1/126'], 'mtu': 1400,
            'auto_route': True, 'strict_route': True, 'dns_mode': 'hijack', 'stack': 'system'}
        if system == 'linux':
            inbound['auto_redirect'] = True
            inbound['auto_redirect_input_mark'] = LINUX_INPUT_MARK
        config['inbounds'].insert(0, inbound)
    return config
