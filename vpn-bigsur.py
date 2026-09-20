#!/usr/bin/python
# -*- coding: utf-8 -*-
"""BigSurVPN 1.0.0. Python 2.7/3 stdlib only; no shell evaluation of profiles.
Target: installed macOS 11 on Intel. Network/routing tests need a real Mac.
"""
from __future__ import print_function, unicode_literals
import base64
import binascii
import contextlib
import datetime
import fcntl
import getpass
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
try:
    from urllib.parse import urlsplit, parse_qsl, unquote
except ImportError:
    from urlparse import urlsplit, parse_qsl
    from urllib import unquote

BASE = '/Library/BigSurVPN'
PRIVATE = BASE + '/private'
CORE = BASE + '/sing-box'
CATALOG = PRIVATE + '/profiles.json'
CONFIG = PRIVATE + '/config.json'
ACTIVE = PRIVATE + '/active.json'
LABEL = 'ru.pioner22.bigsur-vpn'
PLIST = PRIVATE + '/runtime.plist'  # deliberately NOT in LaunchDaemons
IFACE = 'utun98'
PORT = 17890
LIMIT = 1024 * 1024
CURL = '/usr/bin/curl'
LAUNCH = '/bin/launchctl'
ENV = dict(os.environ, LC_ALL='C', LANG='C', PATH='/usr/bin:/bin:/usr/sbin:/sbin')
for _k in list(ENV):
    if _k.upper().endswith('_PROXY') or _k.startswith(('PYTHON', 'DYLD_')):
        ENV.pop(_k, None)
TEST_URLS = ['https://www.cloudflare.com/cdn-cgi/trace', 'https://api.github.com/']

try:
    text_type = unicode
except NameError:
    text_type = str

class VPNError(Exception):
    pass

def say(s):
    if sys.version_info[0] == 2:
        sys.stdout.write((s + '\n').encode('utf-8'))
    else:
        print(s)
    sys.stdout.flush()

def safe_name(s):
    return ''.join(c for c in s if c.isprintable())[:100] if sys.version_info[0] >= 3 else re.sub(r'[\x00-\x1f\x7f-\x9f]', '', s)[:100]

def b(s):
    return s.encode('utf-8') if not isinstance(s, bytes) else s

def read_json(path):
    with io.open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def atomic_json(path, obj):
    fd, temp = tempfile.mkstemp(prefix='.new-', dir=os.path.dirname(path))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(b(json.dumps(obj, ensure_ascii=True, sort_keys=True, indent=2) + '\n'))
            f.flush()
            os.fsync(f.fileno())
        os.rename(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

def run(args, data=None):
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, env=ENV, close_fds=True)
    out, err = p.communicate(data)
    return p.returncode, out, err

def url_ok(url):
    if len(url) > 4096 or re.search(r'[\x00-\x20\x7f"\\]', url):
        raise VPNError('Некорректная ссылка подписки.')
    try:
        u = urlsplit(url)
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.fragment:
            raise ValueError()
        if u.port is not None and not (1 <= u.port <= 65535):
            raise ValueError()
    except (ValueError, TypeError):
        raise VPNError('Для подписки требуется корректный HTTPS URL без логина/пароля URL.')
    return url

def percent(s):
    if re.search(r'%(?![0-9a-fA-F]{2})', s):
        raise VPNError('Некорректное percent-encoding.')
    result = unquote(s)
    if isinstance(result, bytes):
        result = result.decode('utf-8')
    if re.search(r'[\x00-\x1f\x7f]', result):
        raise VPNError('Управляющие символы в профиле запрещены.')
    return result

def parse_uri(uri):
    if len(uri) > 8192 or re.search(r'[\x00-\x20\x7f]', uri):
        raise VPNError('Некорректная длина/символы URI.')
    try:
        u = urlsplit(uri)
        proto = u.scheme.lower()
        if proto not in ('trojan', 'vless'):
            raise VPNError('Поддерживаются только VLESS и Trojan.')
        if not u.hostname or not u.username or u.password:
            raise VPNError('Некорректный адрес/идентификатор сервера.')
        port = u.port
        if port is None or not 1 <= port <= 65535:
            raise VPNError('Порт вне диапазона 1..65535.')
        host = u.hostname
        if not re.match(r'^[A-Za-z0-9.:-]+$', host) or len(host) > 253:
            raise VPNError('Некорректное имя сервера.')
        if re.search(r'%(?![0-9A-Fa-f]{2})', u.query):
            raise VPNError('Некорректное кодирование параметров.')
        items = parse_qsl(u.query, keep_blank_values=True)
        params = {}
        supported = set(('security','type','sni','peer','fp','alpn','pbk','sid',
                         'flow','encryption','spx','path','host','serviceName',
                         'mode','allowInsecure','insecure','headerType'))
        for k, v in items:
            if k in params or k not in supported:
                raise VPNError('Неизвестный или повторный параметр: ' + safe_name(k))
            if re.search(r'[\x00-\x1f\x7f]', v):
                raise VPNError('Управляющие символы в параметрах.')
            params[k] = v
        for k in ('allowInsecure', 'insecure'):
            if params.get(k, '0').lower() not in ('0', 'false', ''):
                raise VPNError('Профили с отключением TLS-проверки запрещены.')
        if params.get('headerType', 'none') != 'none':
            raise VPNError('TCP header disguise не поддерживается.')
        security = params.get('security', 'tls' if proto == 'trojan' else '')
        if security not in ('tls', 'reality') or (proto == 'trojan' and security != 'tls'):
            raise VPNError('Требуется TLS или VLESS REALITY; незашифрованный транспорт отклонён.')
        transport = params.get('type', 'tcp')
        if transport not in ('tcp', 'ws', 'grpc'):
            raise VPNError('Транспорт не поддерживается: ' + safe_name(transport))
        if params.get('mode', 'gun') != 'gun':
            raise VPNError('Поддерживается только обычный gRPC mode=gun.')
        server_name = params.get('sni') or params.get('peer') or host
        if not re.match(r'^[A-Za-z0-9.:-]+$', server_name):
            raise VPNError('Некорректный SNI.')
        tls = {'enabled': True, 'server_name': server_name, 'insecure': False}
        fp = params.get('fp', '')
        if fp and fp != 'none':
            if fp not in ('chrome','firefox','safari','ios','android','edge','360','qq','random','randomized'):
                raise VPNError('Неизвестный TLS fingerprint.')
            tls['utls'] = {'enabled': True, 'fingerprint': fp}
        if params.get('alpn'):
            tls['alpn'] = params['alpn'].split(',')
        if security == 'reality':
            pk, sid = params.get('pbk', ''), params.get('sid', '')
            if not re.match(r'^[A-Za-z0-9_-]{43}$', pk) or not re.match(r'^(?:[0-9a-fA-F]{2}){0,8}$', sid):
                raise VPNError('Некорректный ключ или short ID REALITY.')
            if transport != 'tcp':
                raise VPNError('В этой версии конвертера REALITY поддерживается только с TCP.')
            tls['reality'] = {'enabled': True, 'public_key': pk, 'short_id': sid}
            tls.setdefault('utls', {'enabled': True, 'fingerprint': 'chrome'})
        outbound = {'type': proto, 'tag': 'proxy', 'server': host, 'server_port': port, 'tls': tls}
        credential = percent(u.username)
        if proto == 'vless':
            if not re.match(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$', credential):
                raise VPNError('Некорректный VLESS UUID.')
            if params.get('encryption', 'none') != 'none':
                raise VPNError('Этот режим VLESS encryption не поддерживается.')
            flow = params.get('flow', '')
            if flow not in ('', 'xtls-rprx-vision') or (flow and transport != 'tcp'):
                raise VPNError('Не поддерживается VLESS flow.')
            outbound.update(uuid=credential)
            if flow:
                outbound['flow'] = flow
        else:
            if params.get('flow') or params.get('encryption', 'none') != 'none':
                raise VPNError('Некорректные параметры Trojan.')
            outbound['password'] = credential
        if transport == 'ws':
            path = params.get('path', '/')
            if not path.startswith('/') or '?' in path and 'ed=' in path:
                raise VPNError('Некорректный WS path; early-data не поддерживается.')
            tr = {'type': 'ws', 'path': path}
            if params.get('host'):
                tr['headers'] = {'Host': params['host']}
            outbound['transport'] = tr
        elif transport == 'grpc':
            outbound['transport'] = {'type': 'grpc', 'service_name': params.get('serviceName', '')}
        elif params.get('path') or params.get('host') or params.get('serviceName'):
            raise VPNError('Параметры транспорта не соответствуют TCP.')
        name = safe_name(percent(u.fragment)) or (proto.upper() + ' ' + host)
        return {'id': hashlib.sha256(b(uri)).hexdigest()[:20], 'name': name,
                'outbound': outbound, 'spiderx_ignored': 'spx' in params}
    except (ValueError, UnicodeError, TypeError):
        raise VPNError('Не удалось разобрать URI сервера.')

def parse_subscription(raw):
    if not raw or len(raw) > LIMIT:
        raise VPNError('Подписка пустая или превышает 1 МиБ.')
    try:
        text = raw.decode('utf-8-sig').strip()
        if not re.search(r'(?m)^(vless|trojan|vmess|ss|hysteria2|hy2)://', text):
            compact = re.sub(r'\s+', '', text)
            if not re.match(r'^[A-Za-z0-9_+/=-]+$', compact):
                raise VPNError('Ожидался список URI или Base64, получен другой формат (возможно HTML/JSON).')
            text = base64.urlsafe_b64decode(b(compact + '=' * (-len(compact) % 4))).decode('utf-8-sig')
    except (ValueError, UnicodeError, binascii.Error):
        raise VPNError('Подписка не является UTF-8/Base64 списком URI.')
    nodes, skipped, seen = [], 0, set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        try:
            node = parse_uri(line)
        except VPNError:
            skipped += 1
            continue
        if node['id'] not in seen:
            nodes.append(node)
            seen.add(node['id'])
        if len(nodes) > 256:
            raise VPNError('Слишком много профилей: максимум 256.')
    if not nodes:
        raise VPNError('Нет совместимых VLESS/Trojan-профилей. Старые настройки сохранены.')
    return nodes, skipped

def unlock(envelope_path, output):
    env = read_json(envelope_path)
    password = getpass.getpass('Installation key from chat (hidden): ')
    if not re.match(r'^[0-9a-f]{32}$', password):
        raise VPNError('Ключ должен содержать 32 строчные шестнадцатеричные цифры.')
    cipher = base64.b64decode(b(env['ciphertext']))
    mac_key = hashlib.sha256(b('BigSurVPN MAC v1\x00') + b(password)).digest()
    actual = hmac.new(mac_key, cipher, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(str(actual), str(env['hmac_sha256'])):
        raise VPNError('Ключ неверен или зашифрованный профиль повреждён.')
    fd, temp = tempfile.mkstemp(prefix='cipher-', dir=os.path.dirname(output))
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(cipher)
        rc, plain, _ = run(['/usr/bin/openssl','enc','-d','-aes-256-cbc','-md','sha256',
                             '-in',temp,'-pass','stdin'], b(password + '\n'))
        if rc:
            raise VPNError('Не удалось расшифровать профиль.')
        obj = json.loads(plain.decode('utf-8'))
        url_ok(obj['subscription'])
        bootstrap = [parse_uri(uri) for uri in obj['bootstrap']]
        if not bootstrap:
            raise VPNError('Нет резервных профилей.')
        state = {'subscription': obj['subscription'], 'bootstrap': bootstrap, 'nodes': [],
                 'preferred': '', 'updated_at': None}
        atomic_json(output, state)
        say('Подписка встроена локально. Резервные профили: %d. Ключ не сохраняется.' % len(bootstrap))
    finally:
        os.unlink(temp)

def extract_core(archive, dest):
    with tarfile.open(archive, 'r:gz') as tf:
        members = [m for m in tf.getmembers() if m.name.rsplit('/', 1)[-1] == 'sing-box']
        if len(members) != 1 or not members[0].isfile() or not 0 < members[0].size < 256 * 1024 * 1024:
            raise VPNError('Некорректный архив ядра.')
        member = members[0]
        if member.name.startswith('/') or '..' in member.name.split('/'):
            raise VPNError('Небезопасный путь в архиве.')
        src = tf.extractfile(member)
        try:
            with open(dest, 'wb') as out:
                shutil.copyfileobj(src, out, 1024 * 1024)
        finally:
            src.close()
    os.chmod(dest, 0o755)

def resolve_node(node):
    n = json.loads(json.dumps(node))
    host = n['outbound']['server']
    # Resolve just the VPN endpoint BEFORE the TUN is started. Never use a
    # direct DNS resolver for application traffic after the tunnel starts.
    try:
        addresses = socket.getaddrinfo(host, n['outbound']['server_port'], socket.AF_INET, socket.SOCK_STREAM)
    except socket.error:
        raise VPNError('Не удалось разрешить имя VPN-сервера до подключения.')
    if not addresses:
        raise VPNError('VPN-сервер не имеет доступного IPv4-адреса.')
    n['outbound']['server'] = addresses[0][4][0]
    return n

def make_config(node, auth, tun):
    config = {
        'log': {'disabled': True},  # no continuous per-connection disk writes
        'dns': {'servers': [{'type': 'https', 'tag': 'remote-dns', 'server': '1.1.1.1',
                            'server_port': 443, 'path': '/dns-query', 'detour': 'proxy',
                            'tls': {'enabled': True, 'server_name': 'cloudflare-dns.com'}}],
                'final': 'remote-dns', 'strategy': 'prefer_ipv4'},
        'inbounds': [{'type': 'mixed', 'tag': 'probe-in', 'listen': '127.0.0.1',
                      'listen_port': PORT, 'users': [{'username': 'probe', 'password': auth}]}],
        'outbounds': [node['outbound']],
        'route': {'auto_detect_interface': True, 'final': 'proxy',
                  'rules': [{'port': 53, 'action': 'hijack-dns'}]}}
    if tun:
        config['inbounds'].insert(0, {
            'type': 'tun', 'tag': 'tun-in', 'interface_name': IFACE,
            'address': ['172.29.255.1/30', 'fd56:76aa:6273::1/126'],
            'mtu': 1400, 'auto_route': True, 'strict_route': True,
            'dns_mode': 'hijack', 'stack': 'system'})
    return config

def check_config(path):
    rc, _, _ = run([CORE, 'check', '-c', path])
    if rc:
        raise VPNError('Ядро отклонило конфигурацию. Сеть не изменена.')

def port_free():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(('127.0.0.1', PORT))
    except socket.error:
        raise VPNError('Локальный порт %d занят. Остановите другой экземпляр/приложение.' % PORT)
    finally:
        sock.close()

def curl_request(url, auth=None, subscription=False):
    # Tokens/passwords go through curl's stdin config, not argv, env or logs.
    url_ok(url)
    cfg = 'url = "%s"\n' % url
    args = [CURL, '-q', '--config', '-', '-4', '-f', '-sS', '--globoff',
            '--proto', '=https', '--connect-timeout', '8', '--max-time', '25' if subscription else '15',
            '--max-filesize', str(LIMIT), '--max-redirs', '0']
    if auth:
        cfg += 'proxy = "socks5h://127.0.0.1:%d"\nproxy-user = "probe:%s"\nnoproxy = ""\n' % (PORT, auth)
    else:
        args += ['--proxy', '', '--noproxy', '*']
    if subscription:
        args += ['--user-agent', 'v2rayNG', '-H', 'Accept: text/plain', '-H', 'Accept-Encoding: identity']
    # File-backed, RLIMIT-bounded body even for old curl + chunked HTTP.
    fd, temp = tempfile.mkstemp(prefix='http-', dir=PRIVATE)
    os.close(fd)
    args += ['-o', temp, '-w', '%{http_code}']
    def limits():
        import resource
        resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT, LIMIT))
    try:
        p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=ENV, close_fds=True, preexec_fn=limits)
        out, _ = p.communicate(b(cfg))
        code = out.decode('ascii', 'replace').strip()
        if p.returncode or code != '200':
            raise VPNError('HTTPS-запрос не прошёл (curl=%d, HTTP=%s).' % (p.returncode, safe_name(code)))
        with open(temp, 'rb') as f:
            return f.read(LIMIT + 1)
    finally:
        os.unlink(temp)

def check_https(auth):
    last = None
    for url in TEST_URLS:
        try:
            body = curl_request(url, auth)
            if url == TEST_URLS[0]:
                m = re.search(br'(?m)^ip=([^\r\n]+)', body)
                if not m:
                    raise VPNError('Ответ тестового сервиса не содержит IP.')
                return m.group(1).decode('ascii', 'replace')
            obj = json.loads(body.decode('utf-8'))
            if not isinstance(obj, dict) or 'current_user_url' not in obj:
                raise VPNError('Неожиданный ответ GitHub.')
            return 'HTTPS OK; сервис определения IP недоступен'
        except (VPNError, ValueError, UnicodeError) as e:
            last = e
    raise VPNError('Не прошли оба HTTPS-теста. ' + text_type(last))

def probe_node(node, auth):
    port_free()
    path = PRIVATE + '/probe.json'
    atomic_json(path, make_config(node, auth, False))
    check_config(path)
    with open(os.devnull, 'wb') as null:
        p = subprocess.Popen([CORE, 'run', '-c', path], stdout=null, stderr=null,
                             env=ENV, close_fds=True)
        try:
            for _ in range(30):
                if p.poll() is not None:
                    raise VPNError('Ядро завершилось при предварительной проверке.')
                try:
                    sock = socket.create_connection(('127.0.0.1', PORT), 0.15)
                    sock.close()
                    break
                except socket.error:
                    time.sleep(0.1)
            return check_https(auth)
        finally:
            if p.poll() is None:
                p.terminate()
                for _ in range(50):
                    if p.poll() is not None:
                        break
                    time.sleep(0.1)
                if p.poll() is None:
                    p.kill()
            p.wait()
            if os.path.exists(path):
                os.unlink(path)

def job_info():
    rc, out, _ = run([LAUNCH, 'print', 'system/' + LABEL])
    return out.decode('utf-8', 'replace') if rc == 0 else ''

def alive():
    return bool(re.search(r'(?m)^\s*pid = [0-9]+\s*$', job_info()))

def route_interface(ip, v6=False):
    rc, out, _ = run(['/sbin/route', '-n', 'get', '-inet6' if v6 else '-inet', ip])
    if rc:
        return ''
    m = re.search(br'(?m)^\s*interface:\s*(\S+)', out)
    return m.group(1).decode('ascii') if m else ''

def stop(quiet=False):
    if job_info():
        rc, _, _ = run([LAUNCH, 'bootout', 'system/' + LABEL])
        if rc:
            raise VPNError('launchd не остановил службу. Не изменяю чужие маршруты/DNS.')
    for _ in range(50):
        if not alive():
            break
        time.sleep(0.1)
    if alive():
        raise VPNError('Служба ещё работает. Повторите off; принудительное удаление запрещено.')
    if os.path.exists(ACTIVE):
        os.unlink(ACTIVE)
    # sing-box owns the native DNS registration and utun routes; close gracefully.
    if not quiet:
        say('VPN выключен. Автозапуск после перезагрузки не настроен.')

def write_plist():
    import plistlib
    obj = {'Label': LABEL, 'ProgramArguments': [CORE, 'run', '-c', CONFIG],
           'RunAtLoad': True, 'KeepAlive': False, 'ExitTimeOut': 15,
           'WorkingDirectory': PRIVATE,
           'EnvironmentVariables': {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'},
           'StandardOutPath': '/dev/null', 'StandardErrorPath': PRIVATE + '/startup.log',
           'Umask': 0o077}
    # Per-connection logging disabled; truncate only while stopped, never tail-loop.
    with open(PRIVATE + '/startup.log', 'wb'):
        pass
    if sys.version_info[0] == 2:
        plistlib.writePlist(obj, PLIST)
    else:
        with open(PLIST, 'wb') as f:
            plistlib.dump(obj, f)
    os.chmod(PLIST, 0o600)

def refresh(auth):
    state = read_json(CATALOG)
    raw = curl_request(state['subscription'], auth=auth, subscription=True)
    nodes, skipped = parse_subscription(raw)
    state.update(nodes=nodes, updated_at=datetime.datetime.utcnow().isoformat() + 'Z')
    atomic_json(CATALOG, state)
    say('Подписка обновлена через VPN: %d совместимых, %d пропущено.' % (len(nodes), skipped))
    say('Текущее соединение не прерывалось. Новые профили применятся при следующем on.')

def nodes_ordered(state):
    nodes = state.get('nodes') or []
    preferred = state.get('preferred', '')
    chosen = [n for n in nodes + state['bootstrap'] if n['id'] == preferred]
    out, seen = [], set()
    for n in chosen + nodes[:5] + state['bootstrap']:
        if n['id'] not in seen:
            out.append(n)
            seen.add(n['id'])
    return out

def connect():
    if alive():
        say('Служба уже запущена. Для проверки канала: vpn-bigsur test')
        return
    stop(quiet=True)
    if run(['/sbin/ifconfig', IFACE])[0] == 0:
        raise VPNError(IFACE + ' уже существует. Чужой VPN не изменяю.')
    # Refuse to stack tunnels, including pre-existing split-default VPNs.
    for ip in ('1.1.1.1', '8.8.8.8'):
        if route_interface(ip).startswith(('utun', 'tun', 'ppp', 'ipsec')):
            raise VPNError('Обнаружен другой VPN-маршрут. Сначала отключите другой VPN.')
    state = read_json(CATALOG)
    auth = binascii.hexlify(os.urandom(24)).decode('ascii')
    selected = None
    for i, node in enumerate(nodes_ordered(state), 1):
        say('Проверка сервера %d: %s (системные маршруты пока не меняются).' % (i, node['name']))
        try:
            resolved = resolve_node(node)
            probe_ip = probe_node(resolved, auth)
            selected = resolved
            break
        except VPNError as e:
            say('  Не прошёл: ' + text_type(e))
    if selected is None:
        raise VPNError('Ни один сервер не прошёл проверку. VPN НЕ включён; обычная сеть не изменена. Резервные ключи могли устареть.')
    if selected.get('spiderx_ignored'):
        say('Примечание: Xray spiderX не переносится; HTTPS через REALITY проверен отдельно.')
    atomic_json(CONFIG, make_config(selected, auth, True))
    check_config(CONFIG)
    write_plist()
    ok = False
    try:
        rc, _, _ = run([LAUNCH, 'bootstrap', 'system', PLIST])
        if rc:
            raise VPNError('Не удалось запустить TUN через launchd.')
        for _ in range(60):
            if alive() and route_interface('1.1.1.1') == IFACE:
                break
            time.sleep(0.2)
        if not alive() or route_interface('1.1.1.1') != IFACE:
            raise VPNError('Не подтверждены процесс ядра и маршрут IPv4 через TUN.')
        if route_interface('2606:4700:4700::1111', True) != IFACE:
            raise VPNError('Маршрут IPv6 не захвачен: отключаю VPN, чтобы не оставлять обход по IPv6.')
        ip = check_https(None)  # NO explicit proxy: verify actual system route + DNS.
        now = datetime.datetime.utcnow().isoformat() + 'Z'
        atomic_json(ACTIVE, {'name': selected['name'], 'id': selected['id'], 'auth': auth,
                             'verified_at': now, 'ip': ip, 'interface': IFACE})
        ok = True
    finally:
        if not ok:
            stop(quiet=True)
    say('VPN ВКЛЮЧЁН: %s\nTUN: %s; HTTPS через системный маршрут подтверждён.\nВнешний IP: %s' % (selected['name'], IFACE, ip))
    say('Kill switch не установлен: при остановке/сбое ядра возможен обычный прямой интернет.')
    try:
        refresh(auth)
    except VPNError as e:
        say('VPN оставлен включённым, но подписка не обновилась: ' + text_type(e))
        say('Повторить обновление без разрыва: vpn-bigsur update')

def show_status():
    if not alive():
        say('VPN ВЫКЛЮЧЕН: запущенного процесса службы нет.')
        return
    say('Процесс VPN работает. IPv4-маршрут: ' + (route_interface('1.1.1.1') or 'не определён'))
    if os.path.exists(ACTIVE):
        active = read_json(ACTIVE)
        say('Сервер: %s\nПоследняя успешная проверка UTC: %s\nIP на момент проверки: %s' %
            (active['name'], active['verified_at'], active['ip']))
    say('Текущую доступность интернета проверяет команда: vpn-bigsur test')

def test_connection():
    if not alive() or route_interface('1.1.1.1') != IFACE:
        raise VPNError('VPN не работает или IPv4-маршрут проходит вне TUN.')
    if route_interface('2606:4700:4700::1111', True) != IFACE:
        raise VPNError('Маршрут IPv6 проходит вне TUN.')
    ip = check_https(None)
    state = read_json(ACTIVE)
    state.update(ip=ip, verified_at=datetime.datetime.utcnow().isoformat() + 'Z')
    atomic_json(ACTIVE, state)
    say('PASS: процесс, маршруты IPv4/IPv6 и HTTPS через системный TUN.\nВнешний IP: ' + ip)
    say('Это не полный аудит DNS-утечек, UDP или каждого приложения.')

def list_nodes(select=None):
    state = read_json(CATALOG)
    nodes = (state.get('nodes') or []) + state['bootstrap']
    if select is not None:
        try:
            index = int(select)
        except ValueError:
            raise VPNError('Укажите номер из vpn-bigsur list.')
        if not 1 <= index <= len(nodes):
            raise VPNError('Номер вне списка.')
        state['preferred'] = nodes[index - 1]['id']
        atomic_json(CATALOG, state)
        say('Выбран: ' + nodes[index - 1]['name'])
        say('Применить: vpn-bigsur off && vpn-bigsur on')
        return
    for i, node in enumerate(nodes, 1):
        reserve = ' [резерв из предыдущего подключения]' if i > len(state.get('nodes') or []) else ''
        mark = '*' if node['id'] == state.get('preferred') else ' '
        say('%s %d. %s%s' % (mark, i, node['name'], reserve))

def main():
    os.umask(0o077)
    if len(sys.argv) < 2:
        raise VPNError('Не задана команда.')
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'extract' and len(args) == 2:
        extract_core(*args)
        return
    if cmd == 'unlock' and len(args) == 2:
        unlock(*args)
        return
    if os.geteuid() != 0 or sys.platform != 'darwin':
        raise VPNError('Управление сетью доступно только root в macOS.')
    if not os.path.isfile(CATALOG):
        raise VPNError('Профиль не установлен. Сначала выполните install.')
    with open(PRIVATE + '/command.lock', 'a') as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError:
            raise VPNError('Другая команда VPN ещё выполняется.')
        if cmd == 'on':
            connect()
        elif cmd == 'off':
            stop()
        elif cmd == 'status':
            show_status()
        elif cmd == 'test':
            test_connection()
        elif cmd == 'list':
            list_nodes()
        elif cmd == 'select' and len(args) == 1:
            list_nodes(args[0])
        elif cmd == 'update':
            if not alive() or not os.path.exists(ACTIVE):
                raise VPNError('Сначала включите VPN. Подписка обновляется только через него.')
            refresh(read_json(ACTIVE)['auth'])
        elif cmd == 'logs':
            path = PRIVATE + '/startup.log'
            if os.path.isfile(path):
                with open(path, 'rb') as f:
                    data = f.read(65536).decode('utf-8', 'replace')
                data = re.sub(r'(?i)(vless|trojan)://\S+', '[PRIVATE URI]', data)
                say(safe_name(data) if '\n' not in data else data[-8000:])
            say('Подробный лог соединений отключён. Конфигурации/каталог private не публикуйте.')
        else:
            raise VPNError('Неизвестная команда или неверное число аргументов.')

if __name__ == '__main__':
    try:
        main()
    except VPNError as e:
        say('ОШИБКА: ' + text_type(e))
        sys.exit(1)
    except KeyboardInterrupt:
        say('Команда прервана. Состояние: vpn-bigsur status; выключить: vpn-bigsur off')
        sys.exit(130)
    except (IOError, OSError, ValueError, KeyError) as e:
        say('ОШИБКА локального состояния: ' + type(e).__name__ + '. Проверьте установку; секретные файлы не публикуйте.')
        sys.exit(1)
