#!/usr/bin/python
# -*- coding: utf-8 -*-
"""BigSurVPN 2.0.1. Python 2.7/3 stdlib. macOS 11 Intel, not Recovery.
Public provider preset is DATA. It must never be evaluated as shell/Python code.
The CLI manages a sing-box TUN launchd job, not an IKEv2/mobileconfig profile.
"""
from __future__ import print_function, unicode_literals
import base64
import binascii
import datetime
import fcntl
import hashlib
import io
import json
import math
import os
import re
import shutil
import signal
import socket
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
try:
    from urllib.parse import urlsplit, unquote_to_bytes as unquote
    from queue import Queue, Empty
except ImportError:
    from urlparse import urlsplit
    from urllib import unquote
    from Queue import Queue, Empty
try:
    text_type = unicode
except NameError:
    text_type = str

VERSION = '2.0.1'
BASE = '/Library/BigSurVPN'
PRIVATE = BASE + '/private'
CURRENT = BASE + '/current'
CORE = CURRENT + '/sing-box'
CONFIG = PRIVATE + '/config.json'
CATALOG = PRIVATE + '/profiles.json'
ACTIVE = PRIVATE + '/active.json'
REPORT = PRIVATE + '/last-report.json'
PLIST = PRIVATE + '/runtime.plist'
LABEL = 'ru.pioner22.bigsur-vpn'
IFACE = 'utun98'
PORT = 17890
DNS4 = '172.29.255.2'
DNS6 = 'fd56:76aa:6273::2'
CORE_VERSION = '1.14.0'
CORE_ASSET = 'sing-box-1.14.0-darwin-amd64-legacy-macos-10.13.tar.gz'
CORE_URL = 'https://github.com/SagerNet/sing-box/releases/download/v' + CORE_VERSION + '/' + CORE_ASSET
CORE_SHA = '99285bb2d30739dc8884144cf90f50538336eab9914ac4524290f5b82fdb5565'
CORE_BYTES = 26335501
IP_URL = 'https://ifconfig.me/ip'
CHECK_URL = 'https://api.github.com/'
CHECK_FALLBACK_URL = 'https://raw.githubusercontent.com/pioner22/MacOS/ccea27d1550fe9f079e3a1f413c0eeb6f4a9365b/vpn-runtime.py'
CHECK_FALLBACK_SHA = '25b6dab32d0e8753d52d1406e94dbb95b8593ad501cc018a4452411198164206'
CURL = '/usr/bin/curl'
LAUNCH = '/bin/launchctl'
NQ = '/usr/bin/networkQuality'
LIMIT = 1024 * 1024
ROUTES = [('1.1.1.1', False), ('208.67.222.222', False),
          ('2606:4700:4700::1111', True), ('8000::1', True)]
ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C', 'LANG': 'C',
       'HOME': '/var/root', 'TMPDIR': '/private/var/tmp'}
CLOCK = getattr(time, 'monotonic', time.time)

class VPNError(Exception):
    pass

def b(value):
    return value if isinstance(value, bytes) else value.encode('utf-8')

def safe(value, limit=2000):
    if isinstance(value, bytes):
        value = value.decode('utf-8', 'replace')
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f-\x9f]', '', text_type(value))[:limit]

def say(message):
    message = safe(message, 12000) + '\n'
    if sys.version_info[0] == 2:
        sys.stdout.write(message.encode('utf-8'))
    else:
        sys.stdout.write(message)
    sys.stdout.flush()

def now():
    return datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def read_json(path):
    with io.open(path, 'r', encoding='utf-8') as f:
        data = f.read(4 * LIMIT + 1)
    if len(data) > 4 * LIMIT:
        raise VPNError('Локальный JSON слишком велик.')
    return json.loads(data)

def atomic_bytes(path, data, mode=0o600):
    if os.path.islink(path):
        raise VPNError('Файл назначения является ссылкой: ' + path)
    fd, temp = tempfile.mkstemp(prefix='.new-', dir=os.path.dirname(path))
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.rename(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

def atomic_json(path, value):
    atomic_bytes(path, b(json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + '\n'))

def owned(path, directory=False, private=False):
    s = os.lstat(path)
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(s.st_mode) or s.st_uid != 0 or s.st_mode & (0o077 if private else 0o022):
        raise VPNError('Небезопасный владелец, тип или права: ' + path)
    if not directory and s.st_nlink != 1:
        raise VPNError('Файл имеет дополнительные жёсткие ссылки: ' + path)

def prepare_dirs():
    owned('/Library', directory=True)
    if not os.path.lexists(BASE):
        os.mkdir(BASE, 0o755)
    owned(BASE, directory=True)
    for path, mode in [(PRIVATE, 0o700), (BASE + '/releases', 0o755)]:
        if not os.path.lexists(path):
            os.mkdir(path, mode)
        owned(path, directory=True, private=(mode == 0o700))
    # Do not follow pre-existing links in any root-written private file.
    for name in os.listdir(PRIVATE):
        path = os.path.join(PRIVATE, name)
        if os.path.islink(path):
            raise VPNError('Ссылка в закрытом каталоге: ' + name)
        if os.path.isfile(path):
            owned(path, private=True)

class Report(object):
    def __init__(self, operation):
        self.data = {'version': VERSION, 'operation': operation, 'started_at': now(),
                     'steps': [], 'overall': 'RUNNING'}
    def mark(self, name, status, detail):
        say('[%s] %s: %s' % (status, name, detail))
        self.data['steps'].append({'name': name, 'status': status, 'detail': safe(detail, 1000), 'at': now()})
        atomic_json(REPORT, self.data)
    def end(self, overall):
        self.data.update(overall=overall, finished_at=now())
        atomic_json(REPORT, self.data)
    def warnings(self):
        return any(x['status'] in ('WARN', 'SKIP') for x in self.data['steps'])

# External processes are bounded in time and output. No shell=True, eval or sudo -E.
def kill_child(p):
    if p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except OSError:
            pass
        deadline = CLOCK() + 3
        while p.poll() is None and CLOCK() < deadline:
            time.sleep(0.1)
        if p.poll() is None:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except OSError:
                pass
    p.wait()

def run(args, data=None, timeout=30, file_limit=LIMIT):
    import resource
    def child_setup():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
    with tempfile.TemporaryFile() as inp, tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        if data:
            inp.write(data)
        inp.seek(0)
        p = subprocess.Popen(args, stdin=inp, stdout=out, stderr=err,
                             env=ENV, close_fds=True, preexec_fn=child_setup)
        expired = False
        try:
            deadline = CLOCK() + timeout
            while p.poll() is None:
                if CLOCK() >= deadline:
                    expired = True
                    kill_child(p)
                    break
                time.sleep(0.1)
        except BaseException:
            kill_child(p)
            raise
        out.seek(0)
        err.seek(0)
        return (124 if expired else p.returncode, out.read(LIMIT), err.read(65536))

def url_ok(url):
    if not isinstance(url, text_type) or len(url) > 4096 or re.search(r'[\x00-\x20\x7f"\\]', url):
        raise VPNError('Некорректный HTTPS URL.')
    try:
        u = urlsplit(url)
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.fragment:
            raise ValueError()
        if u.port is not None and not 1 <= u.port <= 65535:
            raise ValueError()
    except ValueError:
        raise VPNError('Требуется HTTPS без учётных данных в URL authority.')
    return url

def curl_error(rc, code):
    reasons = {5: 'DNS прокси', 6: 'DNS имени сервера', 7: 'TCP-соединение',
               22: 'HTTP-ошибка', 28: 'тайм-аут', 35: 'TLS-рукопожатие',
               60: 'проверка сертификата TLS', 63: 'размер ответа', 124: 'общий тайм-аут'}
    return 'curl=%s, HTTP=%s; этап: %s' % (rc, safe(code, 8), reasons.get(rc, 'передача/формат ответа'))

def http(url, auth=None, subscription=False, destination=None, redirects=False,
         max_bytes=LIMIT, timeout=25, interface=None):
    url_ok(url)
    cfg = 'url = "%s"\n' % url
    args = [CURL, '-q', '--config', '-', '-4', '-f', '-sS', '--globoff',
            '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '8',
            '--max-time', str(timeout), '--max-filesize', str(max_bytes)]
    if auth:
        cfg += 'proxy = "socks5h://127.0.0.1:%d"\nproxy-user = "probe:%s"\nnoproxy = ""\n' % (PORT, auth)
    else:
        args += ['--proxy', '', '--noproxy', '*']
    if interface:
        args += ['--interface', interface]
    if redirects:
        args += ['-L', '--max-redirs', '4']
    else:
        args += ['--max-redirs', '0']
    if subscription:
        args += ['--user-agent', 'v2rayNG', '-H', 'Accept: text/plain', '-H', 'Accept-Encoding: identity']
    fd, temp = tempfile.mkstemp(prefix='.http-', dir=PRIVATE)
    os.close(fd)
    target = destination or temp
    args += ['-o', target, '-w', '%{http_code}\n%{remote_ip}\n%{size_download}\n%{speed_download}\n%{time_total}']
    try:
        rc, out, _ = run(args, b(cfg), timeout=timeout + 5, file_limit=max_bytes + 4096)
        parts = out.decode('ascii', 'replace').strip().splitlines()
        code = parts[0] if parts else '000'
        if rc or code != '200' or len(parts) != 5:
            raise VPNError(curl_error(rc, code))
        try:
            meta = {'http': code, 'peer': parts[1], 'bytes': int(float(parts[2])),
                    'bytes_per_second': float(parts[3]), 'seconds': float(parts[4])}
        except (ValueError, OverflowError):
            raise VPNError('Некорректные метрики curl.')
        if not all(math.isfinite(x) if hasattr(math, 'isfinite') else not (math.isnan(x) or math.isinf(x))
                   for x in (meta['bytes_per_second'], meta['seconds'])):
            raise VPNError('Некорректные числовые метрики curl.')
        if meta['bytes_per_second'] < 0 or meta['seconds'] < 0 or float(parts[2]) != meta['bytes']:
            raise VPNError('Отрицательные или дробные метрики HTTP-ответа.')
        if meta['bytes'] < 0 or meta['bytes'] > max_bytes:
            raise VPNError('Размер HTTP-ответа вне разрешённого диапазона.')
        if destination:
            return None, meta
        with open(temp, 'rb') as f:
            body = f.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise VPNError('Ответ превышает ограничение размера.')
        return body, meta
    finally:
        os.unlink(temp)

def public_ip(auth=None):
    body, meta = http(IP_URL, auth=auth, timeout=18)
    try:
        value = body.decode('ascii', 'strict').strip()
        if not re.match(r'^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$', value):
            raise ValueError()
        socket.inet_pton(socket.AF_INET, str(value))
    except (ValueError, socket.error, UnicodeError):
        raise VPNError('ifconfig.me вернул не IPv4-адрес.')
    return value, meta

def github_check(auth=None):
    # API rate limits/outages do not prove that GitHub raw downloads are down.
    errors = []
    try:
        body, meta = http(CHECK_URL, auth=auth, timeout=18)
        value = json.loads(body.decode('utf-8'))
        if not isinstance(value, dict) or 'current_user_url' not in value:
            raise VPNError('HTTPS GitHub API вернул неожиданный ответ.')
        return meta
    except (VPNError, ValueError, UnicodeError) as e:
        errors.append(text_type(e))
    try:
        body, meta = http(CHECK_FALLBACK_URL, auth=auth, timeout=18)
        if hashlib.sha256(body).hexdigest() != CHECK_FALLBACK_SHA:
            raise VPNError('Контрольный файл GitHub raw не совпал с SHA-256.')
        return meta
    except VPNError as e:
        errors.append(text_type(e))
    raise VPNError('Оба HTTPS-теста GitHub не прошли: ' + '; '.join(errors))

def percent(value):
    if re.search(r'%(?![0-9a-fA-F]{2})', value):
        raise VPNError('Некорректное percent-encoding.')
    value = unquote(b(value))
    if isinstance(value, bytes):
        value = value.decode('utf-8')
    if re.search(r'[\x00-\x1f\x7f]', value):
        raise VPNError('Управляющие символы в URI.')
    return value

def parse_uri(uri):
    if not isinstance(uri, text_type) or len(uri) > 8192 or re.search(r'[\x00-\x20\x7f]', uri):
        raise VPNError('Некорректные символы или длина URI.')
    try:
        u = urlsplit(uri)
        if u.scheme not in ('trojan', 'vless') or not u.username or u.password:
            raise VPNError('Поддерживаются URI Trojan и VLESS без дополнительных URL credentials.')
        host, port = u.hostname, u.port
        if not host or not re.match(r'^[A-Za-z0-9.:-]+$', host) or len(host) > 253 or not port or not 1 <= port <= 65535:
            raise VPNError('Некорректное имя/порт сервера.')
        q = {}
        allowed = set(('security','type','sni','peer','fp','alpn','pbk','sid','flow','encryption',
                       'spx','path','host','serviceName','mode','allowInsecure','insecure','headerType'))
        for item in u.query.split('&'):
            if not item:
                continue
            key, sep, value = item.partition('=')
            key, value = percent(key.replace('+', ' ')), percent(value.replace('+', ' '))
            if not sep or key not in allowed or key in q:
                raise VPNError('Повторный или неподдерживаемый параметр URI.')
            q[key] = value
        if any(q.get(k, '0').lower() not in ('0','false','') for k in ('insecure','allowInsecure')):
            raise VPNError('Отключение TLS-проверки запрещено.')
        if q.get('headerType','none') != 'none' or q.get('mode','gun') != 'gun':
            raise VPNError('Этот режим транспорта не поддерживается.')
        sec = q.get('security','tls' if u.scheme == 'trojan' else '')
        transport = q.get('type','tcp')
        if sec not in ('tls','reality') or (u.scheme == 'trojan' and sec != 'tls'):
            raise VPNError('Нужен TLS или VLESS REALITY.')
        if transport not in ('tcp','ws','grpc') or (sec == 'reality' and transport != 'tcp'):
            raise VPNError('Этот транспорт не поддерживается.')
        sni = q.get('sni') or q.get('peer') or host
        if not re.match(r'^[A-Za-z0-9.:-]+$', sni):
            raise VPNError('Некорректный SNI.')
        tls = {'enabled': True, 'insecure': False, 'server_name': sni}
        fp = q.get('fp','')
        if fp and fp != 'none':
            if fp not in ('chrome','firefox','safari','ios','android','edge','360','qq','random','randomized'):
                raise VPNError('Неизвестный TLS fingerprint.')
            tls['utls'] = {'enabled': True, 'fingerprint': fp}
        if q.get('alpn'):
            tls['alpn'] = q['alpn'].split(',')
        if sec == 'reality':
            pk, sid = q.get('pbk',''), q.get('sid','')
            if not re.match(r'^[A-Za-z0-9_-]{43}$', pk) or not re.match(r'^(?:[0-9a-fA-F]{2}){0,8}$', sid):
                raise VPNError('Некорректный ключ REALITY.')
            tls['reality'] = {'enabled': True, 'public_key': pk, 'short_id': sid}
            tls.setdefault('utls', {'enabled': True, 'fingerprint': 'chrome'})
        out = {'type': u.scheme, 'tag': 'proxy', 'server': host, 'server_port': port, 'tls': tls}
        credential = percent(u.username)
        if u.scheme == 'vless':
            if not re.match(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$', credential):
                raise VPNError('Некорректный VLESS UUID.')
            flow = q.get('flow','')
            if q.get('encryption','none') != 'none' or flow not in ('','xtls-rprx-vision') or (flow and transport != 'tcp'):
                raise VPNError('Этот режим VLESS не поддерживается.')
            out['uuid'] = credential
            if flow:
                out['flow'] = flow
        else:
            if q.get('flow') or q.get('encryption','none') != 'none':
                raise VPNError('Параметры Trojan некорректны.')
            out['password'] = credential
        if transport == 'ws':
            path = q.get('path','/')
            if not path.startswith('/') or ('?' in path and 'ed=' in path):
                raise VPNError('WS path/early data не поддерживается.')
            out['transport'] = {'type': 'ws', 'path': path}
            if q.get('host'):
                out['transport']['headers'] = {'Host': q['host']}
        elif transport == 'grpc':
            out['transport'] = {'type': 'grpc', 'service_name': q.get('serviceName','')}
        elif any(q.get(k) for k in ('path','host','serviceName')):
            raise VPNError('Параметры не соответствуют TCP.')
        return {'id': hashlib.sha256(b(uri)).hexdigest()[:20],
                'name': safe(percent(u.fragment) or (u.scheme.upper() + ' ' + host), 100),
                'outbound': out, 'spiderx_ignored': 'spx' in q}
    except (ValueError, TypeError, UnicodeError):
        raise VPNError('Некорректный URI сервера.')

def parse_subscription(raw):
    if not raw or len(raw) > LIMIT:
        raise VPNError('Подписка пустая или слишком большая.')
    try:
        text = raw.decode('utf-8-sig').strip()
        if not re.search(r'(?m)^[a-z0-9]+://', text):
            compact = re.sub(r'\s+', '', text)
            if not re.match(r'^[A-Za-z0-9_+/=-]+$', compact):
                raise VPNError('Ожидался список URI/Base64, не HTML/JSON.')
            text = base64.urlsafe_b64decode(b(compact + '=' * (-len(compact) % 4))).decode('utf-8-sig')
    except (ValueError, UnicodeError, binascii.Error):
        raise VPNError('Подписка не является корректным UTF-8/Base64.')
    nodes, skipped, seen = [], 0, set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        try:
            n = parse_uri(line)
        except VPNError:
            skipped += 1
            continue
        if n['id'] not in seen:
            nodes.append(n)
            seen.add(n['id'])
        if len(nodes) > 256:
            raise VPNError('Превышен лимит 256 профилей.')
    if not nodes:
        raise VPNError('Нет совместимых VLESS/Trojan-профилей; старые настройки не заменены.')
    return nodes, skipped

def validate_profile(value):
    if not isinstance(value, dict) or value.get('schema') != 'bigsur-vpn-profile-v2':
        raise VPNError('Неизвестная схема файла профиля.')
    url_ok(value.get('subscription'))
    if not isinstance(value.get('bootstrap'), list) or not 1 <= len(value['bootstrap']) <= 8:
        raise VPNError('Не задан резервный список профилей.')
    return {'subscription': value['subscription'], 'bootstrap': [parse_uri(u) for u in value['bootstrap']],
            'nodes': [], 'preferred': '', 'updated_at': None}

def resolve_node(node):
    copy = json.loads(json.dumps(node))
    host = copy['outbound']['server']
    q = Queue()
    def worker():
        try:
            q.put(socket.getaddrinfo(host, copy['outbound']['server_port'], socket.AF_INET, socket.SOCK_STREAM))
        except Exception:
            q.put(None)
    t = threading.Thread(target=worker)
    t.daemon = True
    t.start()
    try:
        addresses = q.get(timeout=12)
    except Empty:
        addresses = None
    if not addresses:
        raise VPNError('DNS VPN-сервера: не удалось получить IPv4 за 12 секунд.')
    copy['outbound']['server'] = addresses[0][4][0]
    return copy

def make_config(node, auth, tun):
    value = {'log': {'disabled': True},
             'dns': {'servers': [{'type': 'https', 'tag': 'remote-dns', 'server': '1.1.1.1',
                                 'server_port': 443, 'path': '/dns-query', 'detour': 'proxy',
                                 'tls': {'enabled': True, 'server_name': 'cloudflare-dns.com'}}],
                     'final': 'remote-dns', 'strategy': 'prefer_ipv4'},
             'inbounds': [{'type': 'mixed', 'tag': 'probe-in', 'listen': '127.0.0.1', 'listen_port': PORT,
                           'users': [{'username': 'probe', 'password': auth}]}],
             'outbounds': [json.loads(json.dumps(node['outbound']))],
             'route': {'auto_detect_interface': True, 'final': 'proxy',
                       'rules': [{'port': 53, 'action': 'hijack-dns'}]}}
    if tun:
        value['inbounds'].insert(0, {'type': 'tun', 'tag': 'tun-in', 'interface_name': IFACE,
            'address': ['172.29.255.1/30', 'fd56:76aa:6273::1/126'], 'mtu': 1400,
            'auto_route': True, 'strict_route': True, 'dns_mode': 'hijack', 'stack': 'system'})
    return value

def check_config(path=CONFIG, core=CORE):
    rc, _, err = run([core, 'check', '-c', path], timeout=20)
    if rc:
        atomic_bytes(PRIVATE + '/config-check.log', err[:65536])
        raise VPNError('Ядро отклонило JSON (код %s). Диагностика: vpn-bigsur logs' % rc)

def info():
    rc, out, err = run([LAUNCH, 'print', 'system/' + LABEL], timeout=10)
    if rc == 0:
        text = out.decode('utf-8', 'replace')
        if not text.strip():
            raise VPNError('launchctl вернул пустое состояние; отсутствие службы не подтверждено.')
        return text
    diagnostic = (out + err).decode('utf-8', 'replace').lower()
    if rc in (3, 113) and 'could not find service' in diagnostic and LABEL in diagnostic:
        return ''
    raise VPNError('Не удалось прочитать состояние launchd (код %s). Это не означает, что VPN выключен.' % rc)

def alive():
    return bool(re.search(r'(?m)^\s*pid = [0-9]+\s*$', info()))

def interface_state():
    rc, out, err = run(['/sbin/ifconfig', IFACE], timeout=8)
    if rc == 0 and out.startswith(b(IFACE + ':')):
        return out
    diagnostic = (out + err).decode('utf-8', 'replace').lower()
    if rc == 1 and ('interface ' + IFACE + ' does not exist') in diagnostic:
        return None
    raise VPNError('Не удалось определить состояние %s (ifconfig=%s).' % (IFACE, rc))

def route_interface(ip, v6=False):
    try:
        socket.inet_pton(socket.AF_INET6 if v6 else socket.AF_INET, str(ip))
    except (socket.error, ValueError, TypeError):
        raise VPNError('Некорректный IP для проверки маршрута.')
    rc, out, err = run(['/sbin/route', '-n', 'get', '-inet6' if v6 else '-inet', str(ip)], timeout=8)
    if rc == 0:
        match = re.search(br'(?m)^\s*interface:\s*(\S+)', out)
        if match:
            return match.group(1).decode('ascii')
    diagnostic = (out + err).decode('utf-8', 'replace').lower()
    if rc == 1 and any(x in diagnostic for x in ('not in table', 'network is unreachable', 'no such process')):
        return ''
    raise VPNError('Не удалось проверить маршрут %s (route=%s).' % (ip, rc))

def assert_routes():
    if not alive():
        raise VPNError('Служба launchd не имеет работающего процесса.')
    out = interface_state()
    if not out or not re.search(br'<(?:[^>]*,)?UP(?:,|>)', out.splitlines()[0]):
        raise VPNError('Интерфейс TUN не поднят.')
    for ip, v6 in ROUTES:
        if route_interface(ip, v6) != IFACE:
            raise VPNError('Маршрут %s не проходит через %s.' % (ip, IFACE))

# Validate the actual DNS message, not just the declared answer count.
def dns_name(data, offset):
    labels, visited, end = [], set(), None
    for _ in range(128):
        if offset >= len(data) or offset in visited:
            raise VPNError('DNS: некорректное сжатие имени.')
        visited.add(offset)
        length = bytearray(data[offset:offset + 1])[0]
        if length & 0xc0 == 0xc0:
            if offset + 2 > len(data):
                raise VPNError('DNS: оборванный указатель.')
            target = ((length & 0x3f) << 8) | bytearray(data[offset + 1:offset + 2])[0]
            if target >= offset:
                raise VPNError('DNS: недопустимый указатель имени.')
            if end is None:
                end = offset + 2
            offset = target
            continue
        if length & 0xc0 or offset + 1 + length > len(data):
            raise VPNError('DNS: некорректная метка имени.')
        offset += 1
        if not length:
            name = b'.'.join(labels)
            if len(name) > 253:
                raise VPNError('DNS: имя слишком длинное.')
            return name.lower(), (offset if end is None else end)
        labels.append(data[offset:offset + length])
        offset += length
    raise VPNError('DNS: превышен лимит меток имени.')

def validate_dns_answer(data, query_id):
    if len(data) < 12:
        raise VPNError('DNS: короткий ответ.')
    _, flags, qd, an, _, _ = struct.unpack('!HHHHHH', data[:12])
    if data[:2] != query_id or not flags & 0x8000 or flags & 0x7a0f or qd != 1 or not 1 <= an <= 128:
        raise VPNError('DNS: ошибка, усечение или отсутствие ответа.')
    question, pos = dns_name(data, 12)
    if question != b'ifconfig.me' or data[pos:pos + 4] != b'\x00\x01\x00\x01':
        raise VPNError('DNS: ответ на другой вопрос.')
    pos += 4
    addresses, aliases = set(), {}
    for _ in range(an):
        owner, pos = dns_name(data, pos)
        if pos + 10 > len(data):
            raise VPNError('DNS: оборванная запись ответа.')
        kind, cls, _, length = struct.unpack('!HHIH', data[pos:pos + 10])
        pos += 10
        end = pos + length
        if end > len(data):
            raise VPNError('DNS: неполные данные ответа.')
        if cls == 1 and kind == 1:
            if length != 4:
                raise VPNError('DNS: некорректная запись A.')
            addresses.add(owner)
        elif cls == 1 and kind == 5:
            alias, consumed = dns_name(data, pos)
            if consumed != end:
                raise VPNError('DNS: некорректная запись CNAME.')
            aliases[owner] = alias
        pos = end
    current, seen = question, set()
    while current not in seen:
        if current in addresses:
            return
        seen.add(current)
        if current not in aliases:
            break
        current = aliases[current]
    raise VPNError('DNS: нет записи A для запрошенного имени или его CNAME.')

def native_dns_registered(out):
    for block in re.split(br'resolver #[0-9]+', out):
        servers = re.findall(br'(?m)^\s*nameserver\[[0-9]+\]\s*:\s*(\S+)\s*$', block)
        interfaces = re.findall(br'(?m)^\s*if_index\s*:\s*[0-9]+\s*\(([^)]+)\)', block)
        if b(DNS4) in servers and (b(IFACE) in interfaces or not interfaces):
            return True
    return False

def assert_dns():
    rc, out, _ = run(['/usr/sbin/scutil', '--dns'], timeout=10)
    if rc or not native_dns_registered(out) or not managed_dns_present() or route_interface(DNS4) != IFACE:
        raise VPNError('Не подтверждён DNS-резолвер %s на %s.' % (DNS4, IFACE))
    query_id = os.urandom(2)
    question = b'\x08ifconfig\x02me\x00\x00\x01\x00\x01'
    packet = query_id + b'\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00' + question
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(6)
    try:
        sock.connect((str(DNS4), 53))
        sock.send(packet)
        validate_dns_answer(sock.recv(4096), query_id)
    except socket.error:
        raise VPNError('DNS через TUN не ответил за 6 секунд.')
    finally:
        sock.close()

def assert_no_other_vpn():
    for ip, v6 in ROUTES:
        interface = route_interface(ip, v6)
        if interface.startswith(('utun','tun','ppp','ipsec')):
            raise VPNError('Уже есть VPN-маршрут через %s. Чужой VPN не изменён.' % interface)
    if interface_state() is not None:
        raise VPNError(IFACE + ' занят другим интерфейсом; запуск отменён.')

def stop():
    if info():
        rc, _, _ = run([LAUNCH, 'bootout', 'system/' + LABEL], timeout=25)
        if rc:
            raise VPNError('launchd не остановил службу. Чужие маршруты вручную не удаляю.')
    deadline = CLOCK() + 15
    while CLOCK() < deadline:
        if not info() and interface_state() is None and dns_cleanup_complete():
            break
        time.sleep(0.3)
    else:
        raise VPNError('После остановки остались служба, TUN или DNS. Откат не подтверждён.')
    for ip, v6 in ROUTES:
        if route_interface(ip, v6) == IFACE:
            raise VPNError('После остановки остался маршрут через utun98.')
    if os.path.exists(ACTIVE):
        os.unlink(ACTIVE)

class TemporaryDNS(object):
    """A SystemConfiguration session owns temporary keys; no networksetup writes.

    configd removes these keys when the owning process/session disconnects,
    unless another privileged session has replaced them. CoreFoundation objects
    are released explicitly. All calls use declared 64-bit-safe ctypes ABIs.
    """
    def __init__(self):
        import ctypes as c
        self.c, self.store = c, None
        self.cf = c.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        self.sc = c.CDLL('/System/Library/Frameworks/SystemConfiguration.framework/SystemConfiguration')
        ptr, index = c.c_void_p, c.c_long
        declarations = [(self.cf, 'CFStringCreateWithCString', [ptr, c.c_char_p, c.c_uint32], ptr),
                        (self.cf, 'CFDataCreate', [ptr, ptr, index], ptr),
                        (self.cf, 'CFPropertyListCreateWithData', [ptr, ptr, c.c_ulong, ptr, ptr], ptr),
                        (self.cf, 'CFRelease', [ptr], None),
                        (self.sc, 'SCDynamicStoreCreate', [ptr, ptr, ptr, ptr], ptr),
                        (self.sc, 'SCDynamicStoreAddTemporaryValue', [ptr, ptr, ptr], c.c_ubyte),
                        (self.sc, 'SCDynamicStoreCopyValue', [ptr, ptr], ptr),
                        (self.sc, 'SCError', [], c.c_int)]
        for lib, name, args, result in declarations:
            fn = getattr(lib, name)
            fn.argtypes, fn.restype = args, result
        name = self.string(LABEL)
        try:
            self.store = self.sc.SCDynamicStoreCreate(None, name, None, None)
        finally:
            self.cf.CFRelease(name)
        if not self.store:
            raise VPNError('Не удалось открыть временную DNS-сессию SystemConfiguration.')

    def string(self, text):
        value = self.cf.CFStringCreateWithCString(None, b(text), 0x08000100)
        if not value:
            raise VPNError('Не удалось создать CFString.')
        return value

    def add(self, key, value):
        import plistlib
        data = plistlib.writePlistToString(value) if sys.version_info[0] == 2 else plistlib.dumps(value)
        raw = self.cf.CFDataCreate(None, self.c.cast(self.c.c_char_p(data), self.c.c_void_p), len(data))
        if not raw:
            raise VPNError('Не удалось создать CFData для DNS.')
        try:
            obj = self.cf.CFPropertyListCreateWithData(None, raw, 0, None, None)
        finally:
            self.cf.CFRelease(raw)
        if not obj:
            raise VPNError('Не удалось сформировать DNS property list.')
        name = None
        try:
            name = self.string(key)
            if not self.sc.SCDynamicStoreAddTemporaryValue(self.store, name, obj):
                raise VPNError('Временный DNS-ключ уже занят или недоступен; чужая настройка не заменена.')
        finally:
            if name:
                self.cf.CFRelease(name)
            self.cf.CFRelease(obj)

    def contains(self, key):
        name = self.string(key)
        try:
            obj = self.sc.SCDynamicStoreCopyValue(self.store, name)
            if obj:
                self.cf.CFRelease(obj)
                return True
            if self.sc.SCError() == 1004:  # kSCStatusNoKey
                return False
            raise VPNError('Не удалось прочитать временный DNS-ключ; отсутствие не подтверждено.')
        finally:
            self.cf.CFRelease(name)

    def close(self):
        if self.store:
            self.cf.CFRelease(self.store)
            self.store = None

def managed_dns_key():
    return 'State:/Network/Service/' + LABEL + '/DNS'

def managed_dns_present():
    session = TemporaryDNS()
    try:
        return session.contains(managed_dns_key())
    finally:
        session.close()

def install_temporary_dns(session):
    prefix = 'State:/Network/Service/' + LABEL + '/'
    session.add(prefix + 'IPv4', {'InterfaceName': IFACE, 'Addresses': ['172.29.255.1'],
                                  'SubnetMasks': ['255.255.255.252']})
    session.add(prefix + 'IPv6', {'InterfaceName': IFACE, 'Addresses': ['fd56:76aa:6273::1'],
                                  'PrefixLength': [126]})
    session.add(prefix + 'DNS', {'ServerAddresses': [DNS4, DNS6], 'SupplementalMatchDomains': [''],
                                'SupplementalMatchDomainsNoSearch': 1, 'SupplementalMatchOrders': [100]})

def dns_cleanup_complete():
    session = TemporaryDNS()
    try:
        prefix = 'State:/Network/Service/' + LABEL + '/'
        if any(session.contains(prefix + suffix) for suffix in ('DNS', 'IPv4', 'IPv6')):
            return False
    finally:
        session.close()
    rc, out, _ = run(['/usr/sbin/scutil', '--dns'], timeout=10)
    if rc:
        raise VPNError('Не удалось проверить DNS после остановки.')
    servers = re.findall(br'(?m)^\s*nameserver\[[0-9]+\]\s*:\s*(\S+)\s*$', out)
    return not any(b(address) in servers for address in (DNS4, DNS6))

def stop_service_child(process):
    if process.poll() is None:
        try:
            process.terminate()
        except OSError:
            if process.poll() is None:
                raise
        deadline = CLOCK() + 15
        while process.poll() is None and CLOCK() < deadline:
            time.sleep(0.1)
        if process.poll() is None:
            try:
                process.kill()
            except OSError:
                if process.poll() is None:
                    raise
    process.wait()

def serve():
    # launchd owns this supervisor and its process group. Keep children in that
    # group so launchd also cleans them if the supervisor dies unexpectedly.
    check_install()
    session, core = None, None
    try:
        session = TemporaryDNS()
        with open(os.devnull, 'rb') as null:
            core = subprocess.Popen([os.path.realpath(CORE), 'run', '-c', CONFIG],
                                    stdin=null, env=ENV, close_fds=True)
        deadline = CLOCK() + 25
        while interface_state() is None:
            if core.poll() is not None:
                raise VPNError('Ядро завершилось до создания TUN.')
            if CLOCK() >= deadline:
                raise VPNError('Ядро не создало TUN за время ожидания.')
            time.sleep(0.2)
        install_temporary_dns(session)
        while core.poll() is None:
            time.sleep(0.2)
        raise VPNError('Ядро VPN завершилось; временная DNS-сессия закрывается.')
    except KeyboardInterrupt:
        return 0
    finally:
        try:
            if session is not None:
                session.close()
        finally:
            if core is not None:
                stop_service_child(core)

def write_plist():
    import plistlib
    log = PRIVATE + '/startup.log'
    if os.path.exists(log):
        os.rename(log, log + '.previous')
    atomic_bytes(log, b'')
    value = {'Label': LABEL, 'ProgramArguments': ['/usr/bin/python', '-E', '-s', '-B',
                                                  os.path.realpath(CURRENT + '/vpn-runtime.py'), '_serve'],
             'WorkingDirectory': PRIVATE, 'RunAtLoad': True, 'KeepAlive': False, 'ExitTimeOut': 20, 'AbandonProcessGroup': False,
             'EnvironmentVariables': ENV, 'StandardOutPath': '/dev/null', 'StandardErrorPath': log,
             'Umask': 0o077, 'SoftResourceLimits': {'FileSize': LIMIT},
             'HardResourceLimits': {'FileSize': LIMIT}}
    if sys.version_info[0] == 2:
        data = plistlib.writePlistToString(value)
    else:
        data = plistlib.dumps(value)
    atomic_bytes(PLIST, data)

def probe(node, auth):
    sock = socket.socket()
    try:
        sock.bind(('127.0.0.1', PORT))
    except socket.error:
        raise VPNError('Локальный порт 17890 занят.')
    finally:
        sock.close()
    path = PRIVATE + '/probe.json'
    atomic_json(path, make_config(node, auth, False))
    check_config(path)
    with open(os.devnull, 'r+b') as null:
        p = subprocess.Popen([os.path.realpath(CORE), 'run', '-c', path], stdin=null,
                             stdout=null, stderr=null, env=ENV, close_fds=True, preexec_fn=os.setsid)
        try:
            for _ in range(40):
                if p.poll() is not None:
                    raise VPNError('Ядро завершилось во время предварительной проверки.')
                try:
                    s = socket.create_connection(('127.0.0.1', PORT), 0.1)
                    s.close()
                    break
                except socket.error:
                    time.sleep(0.1)
            github_check(auth)
            try:
                ip, _ = public_ip(auth)
            except VPNError:
                ip = None
            return ip
        finally:
            kill_child(p)
            os.unlink(path)

def refresh(auth, report):
    state = read_json(CATALOG)
    body, _ = http(state['subscription'], auth=auth, subscription=True)
    nodes, skipped = parse_subscription(body)
    state.update(nodes=nodes, updated_at=now())
    atomic_json(CATALOG, state)
    report.mark('SUBSCRIPTION', 'PASS', 'Получено %s совместимых серверов; пропущено %s.' % (len(nodes), skipped))

def candidates(state):
    seen, result = set(), []
    all_nodes = state.get('nodes', []) + state.get('bootstrap', [])
    preferred = [x for x in all_nodes if x['id'] == state.get('preferred')]
    for n in preferred + state.get('nodes', [])[:6] + state.get('bootstrap', []):
        if n['id'] not in seen:
            result.append(n)
            seen.add(n['id'])
    return result[:9]

def baseline(report):
    assert_no_other_vpn()
    github_check()
    report.mark('INTERNET_BEFORE', 'PASS', 'HTTPS GitHub доступен; сертификат проверен.')
    result = {'ip': None, 'at': now(), 'interface': route_interface('1.1.1.1')}
    try:
        result['ip'], _ = public_ip()
        report.mark('IP_BEFORE', 'PASS', 'ifconfig.me: ' + result['ip'])
    except VPNError as e:
        report.mark('IP_BEFORE', 'WARN', 'IP не определён: ' + text_type(e))
    report.data['baseline'] = result
    return result

def verify(baseline_value, report):
    check_config()
    report.mark('CONFIG', 'PASS', 'JSON принят установленным sing-box.')
    assert_routes()
    report.mark('SERVICE_TUN_ROUTES', 'PASS', 'Процесс, utun98 и обе половины IPv4/IPv6-маршрутов.')
    assert_dns()
    report.mark('DNS', 'PASS', 'Резолвер macOS на TUN и DNS-ответ через него подтверждены.')
    peer = github_check()['peer']
    if route_interface(peer) != IFACE:
        raise VPNError('Реальный адрес HTTPS GitHub маршрутизируется вне TUN.')
    assert_routes()
    report.mark('HTTPS_AFTER', 'PASS', 'HTTPS GitHub через системный TUN, без явного прокси.')
    ip, meta = public_ip()
    if route_interface(meta['peer']) != IFACE:
        raise VPNError('Реальный адрес ifconfig.me маршрутизируется вне TUN.')
    assert_routes()
    report.mark('IP_AFTER', 'PASS', 'curl https://ifconfig.me/ip -> ' + ip)
    before = baseline_value.get('ip') if baseline_value else None
    if before:
        if ip == before:
            report.mark('IP_CHANGED', 'FAIL', 'Адрес не изменился: ' + ip)
            raise VPNError('Критерий смены IP не выполнен. Это не доказательство обхода, но готовность не подтверждена.')
        report.mark('IP_CHANGED', 'PASS', '%s -> %s (исходный замер: %s).' % (before, ip, baseline_value.get('at','неизвестно')))
    else:
        report.mark('IP_CHANGED', 'WARN', 'Исходный IP неизвестен: сравнение не выполнено, не PASS.')
    report.data['ip_after'] = ip
    return ip

def speed(report):
    assert_routes()
    if os.path.isfile(NQ) and os.access(NQ, os.X_OK):
        report.mark('SPEED_START', 'INFO', 'Apple networkQuality: до 120 секунд, возможен значительный трафик.')
        rc, out, _ = run([NQ, '-I', IFACE, '-v'], timeout=120)
        assert_routes()
        atomic_bytes(PRIVATE + '/network-quality.log', out)
        text = safe(out, 12000)
        say(text)
        capacities = {}
        for direction, value, unit in re.findall(r'(?im)^\s*(Downlink|Download|Uplink|Upload) capacity:\s*([0-9]+(?:\.[0-9]+)?)\s*([KMG]bps)\s*$', text):
            number = float(value) * {'kbps': 1e-3, 'mbps': 1.0, 'gbps': 1e3}[unit.lower()]
            capacities['download' if direction.lower() in ('downlink', 'download') else 'upload'] = number
        if rc or any(k not in capacities or capacities[k] <= 0 or math.isinf(capacities[k]) for k in ('download', 'upload')):
            report.mark('SPEED', 'WARN', 'networkQuality не завершила полный замер (код %s). VPN не объявляется неисправным только из-за этого.' % rc)
            return
        report.mark('SPEED', 'PASS', 'Штатный тест Apple завершён; значения показаны выше.')
        report.data['speed'] = {'method': 'Apple networkQuality', 'output': text,
                                'download_mbps': capacities['download'], 'upload_mbps': capacities['upload']}
        return
    report.mark('NETWORKQUALITY', 'SKIP', 'Штатная /usr/bin/networkQuality отсутствует (обычно Big Sur). Сторонний Speedtest не устанавливается.')
    report.mark('SPEED_START', 'INFO', 'Резерв: системный curl, один HTTPS-поток, 26.3 МБ с GitHub CDN в /dev/null; до 90 секунд.')
    try:
        _, meta = http(CORE_URL, destination=os.devnull, redirects=True, max_bytes=CORE_BYTES,
                       timeout=90, interface=IFACE)
        assert_routes()
        if route_interface(meta['peer']) != IFACE:
            raise VPNError('Конечный адрес теста скорости маршрутизируется вне TUN.')
        if meta['bytes'] != CORE_BYTES or meta['seconds'] <= 0 or meta['bytes_per_second'] <= 0:
            raise VPNError('Тестовый объект не скачан полностью или метрики нулевые.')
        rate = meta['bytes_per_second'] * 8.0 / 1000000.0
        report.data['speed'] = {'method': 'curl single HTTPS download', 'download_mbps': rate,
                                'bytes': meta['bytes'], 'seconds': meta['seconds'], 'upload_mbps': None}
        report.mark('DOWNLOAD_SPEED', 'PASS', '%.2f Мбит/с. Только загрузка с GitHub CDN; не максимальная полоса и не тест отдачи/RPM.' % rate)
    except VPNError as e:
        report.mark('DOWNLOAD_SPEED', 'WARN', 'Замер не завершён: ' + text_type(e))

def connect(base, report):
    if info():
        raise VPNError('Перед новым подключением осталась служба. Выполните vpn-bigsur off.')
    assert_no_other_vpn()
    try:
        refresh(None, report)
    except VPNError as e:
        report.mark('SUBSCRIPTION_DIRECT', 'INFO', 'Прямое обновление недоступно; пробую сохранённые/резервные профили. ' + text_type(e))
    state = read_json(CATALOG)
    auth = binascii.hexlify(os.urandom(24)).decode('ascii')
    selected = None
    for index, n in enumerate(candidates(state), 1):
        report.mark('SERVER_PROBE', 'INFO', '%s. %s; системные маршруты ещё не меняются.' % (index, n['name']))
        try:
            resolved = resolve_node(n)
            exit_ip = probe(resolved, auth)
            if base.get('ip') and exit_ip == base['ip']:
                raise VPNError('Предварительный выходной IP совпадает с исходным.')
            selected = resolved
            break
        except VPNError as e:
            report.mark('SERVER_ATTEMPT', 'INFO', 'Этот сервер не прошёл: ' + text_type(e))
    if selected is None:
        raise VPNError('Ни один профиль не прошёл HTTPS-проверку. Системный VPN не запущен; ключи/серверы могут быть недоступны.')
    if selected.get('spiderx_ignored'):
        report.mark('REALITY', 'INFO', 'spiderX не переносится в sing-box; соединение проверено HTTPS-запросом.')
    atomic_json(CONFIG, make_config(selected, auth, True))
    check_config()
    write_plist()
    report.mark('PROFILE', 'PASS', 'Профиль sing-box и конфигурация службы установлены локально (root, 0600).')
    try:
        rc, _, _ = run([LAUNCH, 'bootstrap', 'system', PLIST], timeout=20)
        if rc:
            raise VPNError('launchctl bootstrap завершился с кодом %s. Журнал: vpn-bigsur logs' % rc)
        deadline = CLOCK() + 20
        while CLOCK() < deadline:
            if alive() and route_interface('1.1.1.1') == IFACE and managed_dns_present():
                break
            time.sleep(0.3)
        # configd/mDNSResponder can publish resolver state after the TUN route.
        for attempt in range(3):
            try:
                assert_dns()
                break
            except VPNError:
                if attempt == 2:
                    raise
                time.sleep(0.5)
        ip = verify(base, report)
        atomic_json(ACTIVE, {'baseline': base, 'name': selected['name'], 'id': selected['id'],
                            'auth': auth, 'ip': ip, 'verified_at': now(), 'version': VERSION})
        try:
            refresh(auth, report)
        except VPNError as e:
            report.mark('SUBSCRIPTION', 'WARN', 'VPN подключён, но актуальная подписка не получена: ' + text_type(e))
        return ip
    except BaseException:
        rollback_new(report)
        raise

def rollback_new(report):
    try:
        stop()
        status, detail = 'PASS', 'Собственная служба и маршруты TUN остановлены. Прямой интернет возможен.'
    except BaseException as e:
        status, detail = 'FAIL', 'Остановка не подтверждена: ' + safe(e)
    try:
        report.mark('ROLLBACK', status, detail)
    except Exception:
        say('[%s] ROLLBACK: %s (отчёт на диск не записан).' % (status, detail))


CLI = '''#!/bin/bash
set +x
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset PYTHONPATH PYTHONHOME BASH_ENV ENV CDPATH
if [ "$EUID" -ne 0 ]; then exec /usr/bin/sudo /bin/bash /Library/BigSurVPN/vpn-bigsur.sh "$@"; fi
exec /usr/bin/python -E -s -B /Library/BigSurVPN/current/vpn-runtime.py "${@:-status}"
'''

def extract_core(archive, output):
    with tarfile.open(archive, 'r:gz') as tf:
        members = [m for m in tf.getmembers() if m.name.rsplit('/',1)[-1] == 'sing-box']
        if len(members) != 1:
            raise VPNError('В архиве не найдено ровно одно ядро.')
        m = members[0]
        if not m.isfile() or not 0 < m.size <= 256 * LIMIT or m.name.startswith('/') or '..' in m.name.split('/'):
            raise VPNError('Небезопасный элемент архива.')
        src = tf.extractfile(m)
        try:
            with open(output, 'wb') as f:
                shutil.copyfileobj(src, f, LIMIT)
        finally:
            src.close()
    os.chmod(output, 0o755)

def check_install():
    if not os.path.islink(CURRENT):
        raise VPNError('Нет установки версии 2. Запустите команду установки с GitHub.')
    release = os.path.realpath(CURRENT)
    if os.path.dirname(release) != BASE + '/releases':
        raise VPNError('Некорректный путь установленной версии.')
    owned(release, directory=True)
    owned(release + '/manifest.json')
    meta = read_json(release + '/manifest.json')
    for name in ('vpn-runtime.py','sing-box'):
        path = release + '/' + name
        owned(path)
        if digest(path) != meta['hashes'][name]:
            raise VPNError('Нарушена целостность ' + name + '. Повторите установку.')
    return meta

def stage_install(profile_path, report):
    profile = read_json(profile_path)
    state = validate_profile(profile)
    own_hash, profile_hash = digest(os.path.realpath(__file__)), digest(profile_path)
    stage = tempfile.mkdtemp(prefix='.stage-', dir=BASE + '/releases')
    try:
        archive = stage + '/core.tar.gz'
        report.mark('CORE_DOWNLOAD', 'INFO', 'Официальное legacy-ядро, GitHub Release, 26.3 МБ.')
        http(CORE_URL, destination=archive, redirects=True, max_bytes=64 * LIMIT, timeout=900)
        if digest(archive) != CORE_SHA:
            raise VPNError('SHA-256 архива ядра не совпадает; код не запущен.')
        extract_core(archive, stage + '/sing-box')
        os.unlink(archive)
        rc, out, _ = run([stage + '/sing-box','version'], timeout=15)
        if rc or ('sing-box version ' + CORE_VERSION) not in out.decode('utf-8','replace').splitlines():
            raise VPNError('Legacy-ядро не запускается на этом Mac или версия не совпадает.')
        report.mark('CORE', 'PASS', 'SHA-256 архива и запуск sing-box ' + CORE_VERSION + ' на этом Mac.')
        # Schema validation by the actual installed core, before network changes.
        sample = make_config(state['bootstrap'][0], 'schema-check', True)
        # Avoid resolving a sample hostname in core check; retain the original SNI.
        sample['outbounds'][0]['server'] = '192.0.2.1'
        sample_path = stage + '/sample.json'
        atomic_json(sample_path, sample)
        check_config(sample_path, stage + '/sing-box')
        os.unlink(sample_path)
        # make_config shares outbound data: restore a newly validated catalog.
        state = validate_profile(profile)
        shutil.copyfile(os.path.realpath(__file__), stage + '/vpn-runtime.py')
        os.chmod(stage + '/vpn-runtime.py', 0o644)
        meta = {'version': VERSION, 'created_at': now(), 'profile_sha256': profile_hash,
                'hashes': {'vpn-runtime.py': own_hash, 'sing-box': digest(stage + '/sing-box')}}
        atomic_json(stage + '/manifest.json', meta)
        os.chmod(stage, 0o755)
        report.mark('STAGED', 'PASS', 'Новая версия и профиль проверены; активация ещё не выполнена.')
        return stage, state, profile, meta
    except BaseException:
        shutil.rmtree(stage)
        raise

def activate_install(stage, state, profile, meta, report):
    # New release installed beside previous releases. The old release is retained.
    cli_path = '/usr/local/bin/vpn-bigsur'
    if os.path.lexists(cli_path) and not (os.path.islink(cli_path) and os.readlink(cli_path) == BASE + '/vpn-bigsur.sh'):
        raise VPNError('Имя /usr/local/bin/vpn-bigsur уже занято; чужой файл не перезаписываю.')
    for path in ('/usr/local','/usr/local/bin'):
        if os.path.islink(path):
            raise VPNError(path + ' является ссылкой; установка команды отменена.')
    if os.path.lexists(CURRENT) and not os.path.islink(CURRENT):
        raise VPNError('current должен быть ссылкой управляемой установки.')
    release = BASE + '/releases/' + VERSION + '-' + meta['hashes']['vpn-runtime.py'][:12] + '-' + binascii.hexlify(os.urandom(3)).decode('ascii')
    os.rename(stage, release)
    # Preserve a bounded backup of private configuration, never source arbitrary data.
    for name in ('profiles.json','config.json','runtime.plist','provider-profile.json'):
        source = PRIVATE + '/' + name
        if os.path.isfile(source):
            shutil.copyfile(source, source + '.previous')
            os.chmod(source + '.previous', 0o600)
    if os.path.isfile(CATALOG):
        old = read_json(CATALOG)
        if old.get('subscription') == state['subscription']:
            state['nodes'] = old.get('nodes', [])
            state['preferred'] = old.get('preferred','')
            state['updated_at'] = old.get('updated_at')
    atomic_json(CATALOG, state)
    atomic_json(PRIVATE + '/provider-profile.json', profile)
    atomic_bytes(BASE + '/vpn-bigsur.sh', b(CLI), 0o755)
    link = BASE + '/.current-' + binascii.hexlify(os.urandom(8)).decode('ascii')
    os.symlink('releases/' + os.path.basename(release), link)
    os.rename(link, CURRENT)
    if not os.path.isdir('/usr/local/bin'):
        os.makedirs('/usr/local/bin', 0o755)
    if not os.path.lexists(cli_path):
        os.symlink(BASE + '/vpn-bigsur.sh', cli_path)
    atomic_bytes(BASE + '/VERSION', b(VERSION + '\n'), 0o644)
    report.mark('INSTALLED', 'PASS', 'Команда vpn-bigsur, отдельный профиль и версия ' + VERSION + ' установлены.')

# Final recheck happens after the potentially long speed measurement.
def finish_connected(base, report):
    speed(report)
    ip = verify(base, report)
    active = read_json(ACTIVE)
    active.update(ip=ip, verified_at=now())
    atomic_json(ACTIVE, active)
    report.data['profile_name'] = active['name']
    if report.warnings():
        report.end('READY_WITH_WARNINGS')
        say('VPN ПОДКЛЮЧЁН И ПРОВЕРЕН. Есть ограничения/непроверенные пункты выше; это не полный PASS всех тестов.')
        code = 2
    else:
        report.end('READY')
        say('ГОТОВО: VPN успешно установлен, настроен, подключён и готов к работе. Все предусмотренные проверки пройдены.')
        code = 0
    say('IP через VPN: %s\nПрофиль: %s\nОтчёт: vpn-bigsur report\nВыключить: vpn-bigsur off' % (ip, active['name']))
    say('Нет kill switch: при выключении/аварии возможен прямой интернет. Автозапуск после перезагрузки не настроен.')
    return code

def setup(profile_path, report):
    validate_profile(read_json(profile_path))
    try:
        installed = check_install()
    except (VPNError, IOError, OSError, ValueError, KeyError):
        installed = None
    same = installed and installed.get('version') == VERSION and installed['hashes']['vpn-runtime.py'] == digest(os.path.realpath(__file__)) and installed.get('profile_sha256') == digest(profile_path)
    if same and alive() and os.path.isfile(ACTIVE):
        report.mark('REUSE', 'PASS', 'Установка не менялась и служба запущена. Проверяю её без отключения.')
        base = read_json(ACTIVE).get('baseline', {})
        report.data['baseline'] = base
        verify(base, report)
        return finish_connected(base, report)
    staged = None
    existing_job = bool(info())
    base = None if existing_job else baseline(report)
    # Download and validate new code BEFORE stopping an existing working tunnel.
    if not same:
        github_check()
        report.mark('BOOTSTRAP_INTERNET', 'PASS', 'HTTPS GitHub доступен для загрузки.')
        staged = stage_install(profile_path, report)
    try:
        if existing_job:
            report.mark('RECONNECT', 'INFO', 'Останавливаю только собственную службу для нового исходного замера IP; прямой интернет временно возможен.')
            stop()
        if base is None:
            base = baseline(report)
        if staged:
            activate_install(staged[0], staged[1], staged[2], staged[3], report)
            staged = None
        else:
            report.mark('REUSE', 'PASS', 'Используется установленная проверенная версия и локальный профиль.')
        check_install()
        connect(base, report)
        try:
            return finish_connected(base, report)
        except BaseException:
            rollback_new(report)
            raise
    finally:
        if staged and os.path.isdir(staged[0]):
            shutil.rmtree(staged[0])

def record_verification(ip):
    state = read_json(ACTIVE)
    state.update(ip=ip, verified_at=now())
    atomic_json(ACTIVE, state)

def turn_on(report):
    started = False
    if alive() and os.path.isfile(ACTIVE):
        base = read_json(ACTIVE).get('baseline', {})
    else:
        if info():
            stop()
        base = baseline(report)
        connect(base, report)  # connect rolls back its own failed/cancelled launch.
        started = True
    try:
        report.data['baseline'] = base
        ip = verify(base, report)
        record_verification(ip)
        report.end('CONNECTED_WITH_WARNINGS' if report.warnings() else 'CONNECTED')
        say('VPN подключён. IP: %s. Замер скорости: vpn-bigsur speed' % ip)
        return 2 if report.warnings() else 0
    except BaseException:
        if started:
            rollback_new(report)
        raise

def list_nodes(select=None):
    state = read_json(CATALOG)
    nodes = state.get('nodes', []) + state['bootstrap']
    if select is not None:
        index = int(select)
        if not 1 <= index <= len(nodes):
            raise VPNError('Номер профиля вне списка.')
        state['preferred'] = nodes[index - 1]['id']
        atomic_json(CATALOG, state)
        say('Приоритет: ' + nodes[index - 1]['name'] + '. Применить: vpn-bigsur off && vpn-bigsur on')
    else:
        for i, n in enumerate(nodes, 1):
            say('%s %s. %s' % ('*' if state.get('preferred') == n['id'] else ' ', i, n['name']))

def interrupt(signum, frame):
    raise KeyboardInterrupt()

def main():
    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGHUP, interrupt)
    os.umask(0o077)
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise VPNError('Нужны установленная macOS и права администратора.')
    if run(['/usr/bin/sw_vers','-productVersion'])[1].split(b'.')[0] != b'11' or run(['/usr/bin/uname','-m'])[1].strip() != b'x86_64':
        raise VPNError('Эта версия рассчитана на macOS Big Sur 11.x Intel.')
    if not os.path.isdir('/System/Volumes/Data'):
        raise VPNError('Internet Recovery не поддерживается.')
    prepare_dirs()
    if sys.argv[1:] == ['_serve']:
        return serve()
    with open(PRIVATE + '/command.lock','a') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError:
            raise VPNError('Другая команда VPN ещё выполняется.')
        cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
        args = sys.argv[2:]
        arities = {'setup': 1, 'select': 1, 'on': 0, 'off': 0, 'status': 0, 'test': 0, 'speed': 0,
                   'list': 0, 'update': 0, 'report': 0, 'logs': 0, 'uninstall': 0}
        if cmd not in arities or len(args) != arities[cmd]:
            raise VPNError('Неизвестная команда или неверное число аргументов. Пример: vpn-bigsur select 2')
        if cmd == 'report':
            say(json.dumps(read_json(REPORT), ensure_ascii=False, indent=2))
            return 0
        if cmd == 'logs':
            for name in ('startup.log','config-check.log'):
                path = PRIVATE + '/' + name
                if os.path.isfile(path):
                    with open(path,'rb') as f:
                        text = f.read(8192).decode('utf-8','replace')
                    text = re.sub(r'(?i)(?:https?|vless|trojan)://\S+', '[URL]', text)
                    text = re.sub(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}', '[UUID]', text)
                    say(name + ':\n' + text)
            return 0
        if cmd == 'off':
            stop()
            say('VPN выключен; отсутствие службы и utun-маршрутов проверено.')
            return 0
        if cmd == 'uninstall':
            check_install()
            stop()
            link = '/usr/local/bin/vpn-bigsur'
            if os.path.islink(link) and os.readlink(link) == BASE + '/vpn-bigsur.sh':
                os.unlink(link)
            shutil.rmtree(BASE)
            say('BigSurVPN удалён вместе с локальными профилями и отчётами.')
            return 0
        if cmd == 'status':
            say('Служба: ' + ('ПРОЦЕСС ЗАПУЩЕН' if alive() else 'НЕ ЗАПУЩЕН'))
            say('IPv4-маршрут: ' + (route_interface('1.1.1.1') or 'нет данных'))
            if os.path.isfile(ACTIVE):
                a = read_json(ACTIVE)
                say('Последняя проверка: %s; IP тогда: %s. Новый тест: vpn-bigsur test' % (a.get('verified_at'), a.get('ip')))
            return 0
        if cmd in ('list','select'):
            list_nodes(args[0] if cmd == 'select' and len(args) == 1 else None)
            return 0
        report = Report(cmd)
        try:
            if cmd == 'setup' and len(args) == 1:
                return setup(args[0], report)
            check_install()
            if cmd == 'on':
                return turn_on(report)
            if cmd in ('test','speed'):
                if not os.path.isfile(ACTIVE):
                    raise VPNError('Нет активной сессии. Сначала vpn-bigsur on.')
                base = read_json(ACTIVE).get('baseline', {})
                report.data['baseline'] = base
                verify(base, report)
                if cmd == 'speed':
                    return finish_connected(base, report)
                record_verification(report.data['ip_after'])
                report.end('PASS_WITH_WARNINGS' if report.warnings() else 'PASS')
                return 2 if report.warnings() else 0
            if cmd == 'update':
                assert_routes()
                refresh(read_json(ACTIVE)['auth'], report)
                report.end('UPDATED')
                say('Подписка обновлена. Текущее соединение не прерывалось; новые серверы применятся при следующем on.')
                return 0
            raise VPNError('Команды: on, off, status, test, speed, list, select N, update, logs, report.')
        except BaseException as e:
            report.mark('ERROR','FAIL', text_type(e) if isinstance(e, VPNError) else type(e).__name__)
            report.end('FAILED')
            raise

if __name__ == '__main__':
    try:
        sys.exit(main())
    except VPNError as e:
        say('ОШИБКА: ' + text_type(e))
        sys.exit(1)
    except KeyboardInterrupt:
        say('Прервано. Проверить: vpn-bigsur status. Остановить: vpn-bigsur off')
        sys.exit(130)
    except (IOError, OSError, ValueError, KeyError, UnicodeError) as e:
        say('ОШИБКА локального состояния: ' + type(e).__name__ + '. Профили и ключи не публикуйте в отчётах.')
        sys.exit(1)
