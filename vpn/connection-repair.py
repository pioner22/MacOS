#!/usr/bin/python
# -*- coding: utf-8 -*-
"""One-shot recovery of an existing verified BigSurVPN installation.

No background job, no updater, no credentials in this file. Keeps the existing
runtime/core. Reads local credentials only for the two owner-approved endpoints.
All network checks run on the user's Mac; portable tests do not prove connectivity.
"""
from __future__ import print_function, unicode_literals
import copy
import fcntl
import hashlib
import json
import os
import re
import signal
import socket
import stat
import sys
import types

BASE = '/Library/BigSurVPN'
HOSTS = ('87.251.86.229', '144.31.180.114')
PORT = 45004
APPROVED = {
    '966a6d63a7968113af5c713b5595c9c9c53628fb80e83badd31bedb84d24b877': '2.1.3',
    'a77fa93e468dd4ef4f8a6b2213917547fc9af1292f8be6467c7f3ab87256d756': '2.1.4',
}
CHECKS = ('https://ifconfig.me/ip', 'https://www.cloudflare.com/cdn-cgi/trace')
try:
    text_type = unicode
except NameError:
    text_type = str

class RepairError(Exception):
    pass

def say(message):
    text = message + '\n'
    sys.stdout.write(text.encode('utf-8') if sys.version_info[0] == 2 else text)
    sys.stdout.flush()

def checked_dir(path, private=False):
    s = os.lstat(path)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & (0o077 if private else 0o022):
        raise RepairError('Небезопасный каталог: ' + path)

def read_checked(path, private=False, limit=4 * 1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        if (not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or
                s.st_mode & (0o077 if private else 0o022) or s.st_size > limit):
            raise RepairError('Небезопасный файл или недопустимый размер: ' + path)
        value = f.read(limit + 1)
        if len(value) > limit:
            raise RepairError('Файл превышает ограничение размера: ' + path)
        return value

def load_runtime():
    for path in ('/Library', BASE, BASE + '/releases'):
        checked_dir(path)
    checked_dir(BASE + '/private', private=True)
    current = BASE + '/current'
    s = os.lstat(current)
    if not stat.S_ISLNK(s.st_mode) or s.st_uid != 0:
        raise RepairError('Не найдена штатная ссылка текущей версии VPN.')
    release = os.path.realpath(current)
    if os.path.dirname(release) != BASE + '/releases':
        raise RepairError('Неизвестный путь установленной версии.')
    checked_dir(release)
    path = release + '/vpn-runtime.py'
    source = read_checked(path)
    digest = hashlib.sha256(source).hexdigest()
    if digest not in APPROVED:
        raise RepairError('Неизвестная версия VPN. Автоматическая подмена программы запрещена.')
    manifest = json.loads(read_checked(release + '/manifest.json').decode('utf-8'))
    if manifest.get('hashes', {}).get('vpn-runtime.py') != digest:
        raise RepairError('Нарушена целостность установленного runtime.')
    core = read_checked(release + '/sing-box', limit=256 * 1024 * 1024)
    if hashlib.sha256(core).hexdigest() != manifest.get('hashes', {}).get('sing-box'):
        raise RepairError('Нарушена целостность установленного sing-box.')
    module = types.ModuleType(str('verified_vpn_runtime'))
    module.__file__ = path
    exec(compile(source, path, 'exec'), module.__dict__)
    if module.VERSION != APPROVED[digest] or module.BASE != BASE:
        raise RepairError('Версия или путь runtime не соответствует ожидаемому.')
    return module

def secrets_in(value):
    result = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in ('password', 'username', 'uuid', 'auth', 'subscription') and isinstance(child, text_type):
                result.append(child)
            result.extend(secrets_in(child))
    elif isinstance(value, list):
        for child in value:
            result.extend(secrets_in(child))
    return result

def redact(value, secrets):
    if isinstance(value, bytes):
        value = value.decode('utf-8', 'replace')
    value = text_type(value)
    for secret in sorted(set(secrets), key=len, reverse=True):
        if secret:
            value = value.replace(secret, '[СКРЫТО]')
    value = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', value)
    value = re.sub(r'(?i)(?:https?|socks5h?|vless|trojan)://\S+', '[URL]', value)
    return re.sub(r'[\x00-\x08\x0b-\x1f\x7f-\x9f]', '', value)[:2000]

def quote_config(value):
    if re.search(r'[\x00-\x1f\x7f]', value):
        raise RepairError('Управляющие символы в реквизитах; запрос не отправлен.')
    return value.replace('\\', '\\\\').replace('"', '\\"')

def local_credentials(runtime, catalog):
    node = catalog.get('socks5', {})
    outbound = node.get('outbound', {})
    if outbound.get('type') != 'socks' or outbound.get('server') not in HOSTS or outbound.get('server_port') != PORT:
        raise RepairError('Нет согласованного локального SOCKS5-профиля. Чужие реквизиты не передаются новым адресам.')
    raw = {'server': outbound['server'], 'port': PORT,
           'username': outbound.get('username'), 'password': outbound.get('password')}
    runtime.validate_socks(raw)
    if ':' in raw['username']:
        raise RepairError('Имя SOCKS5 с двоеточием не поддерживается этой проверкой curl.')
    return raw

def valid_response(url, body):
    try:
        text = body.decode('ascii').strip()
        if url == CHECKS[0]:
            ip = text
        else:
            fields = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
            if fields.get('h') != 'www.cloudflare.com':
                return False
            ip = fields.get('ip', '')
        if not re.match(r'^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\Z', ip):
            return False
        socket.inet_pton(socket.AF_INET, str(ip))
        return True
    except (ValueError, UnicodeError, socket.error):
        return False

def direct_probe(runtime, credentials, host, secrets, report):
    config = ('socks5-hostname = "%s:%s"\nproxy-user = "%s:%s"\nnoproxy = ""\n' %
              (host, PORT, quote_config(credentials['username']), quote_config(credentials['password'])))
    report.mark('DIRECT_SOCKS', 'INFO', 'Проверяю %s:%s напрямую, без локального порта 17890.' % (host, PORT))
    for url in CHECKS:
        args = [runtime.CURL, '-q', '-4', '-f', '-sS', '--config', '-', '--globoff',
                '--proto', '=https', '--connect-timeout', '6', '--max-time', '15',
                '--max-filesize', '32768', '--max-redirs', '0', '-w', '\n%{http_code}', url]
        rc, out, err = runtime.run(args, runtime.b(config), timeout=18, file_limit=65536)
        body, separator, code = out.rpartition(b'\n')
        if rc == 0 and separator and code == b'200' and valid_response(url, body):
            report.mark('DIRECT_SOCKS', 'PASS', '%s:%s — авторизация, HTTPS и ответ проверены.' % (host, PORT))
            return True
        detail = 'curl=%s HTTP=%s; %s' % (rc, code.decode('ascii', 'replace')[:8] if separator else '000',
                                         redact(err, secrets) or 'Не получен ожидаемый HTTPS-ответ.')
        report.mark('DIRECT_SOCKS', 'INFO', '%s:%s — %s' % (host, PORT, detail))
    return False

def port_diagnostics(runtime, report):
    args = ['/usr/sbin/lsof', '-nP', '-iTCP:%s' % runtime.PORT, '-sTCP:LISTEN', '-Fpcu']
    if not os.path.isfile(args[0]):
        return
    rc, out, err = runtime.run(args, timeout=5, file_limit=65536)
    if rc == 0 and out.strip():
        report.mark('LOCAL_PORT', 'INFO', 'Порт %s: %s. Посторонние процессы не завершаются.' %
                    (runtime.PORT, runtime.safe(out, 1000)))

def candidate_state(runtime, catalog, raw, host):
    updated = copy.deepcopy(catalog)
    raw = dict(raw, server=host)
    node = runtime.validate_socks(raw)
    updated['backend'] = 'socks5'
    updated['socks5'] = node
    if 'socks5_nodes' in updated or runtime.VERSION == '2.1.4':
        updated['socks5_nodes'] = [node]
        updated['socks5_preferred'] = node['id']
    return updated, raw

def repair(runtime, catalog, profile, report):
    credentials = local_credentials(runtime, catalog)
    secrets = secrets_in(catalog) + secrets_in(profile)
    had_job = bool(runtime.info())
    previous_running = runtime.alive() if had_job else False
    touched = False
    original_run = runtime.run
    last_curl_error = ['']
    def traced_run(args, *pos, **kw):
        result = original_run(args, *pos, **kw)
        if args and args[0] == runtime.CURL:
            last_curl_error[0] = redact(result[2], secrets)
        return result
    original_http = runtime.http
    def traced_http(*args, **kwargs):
        last_curl_error[0] = ''
        try:
            return original_http(*args, **kwargs)
        except runtime.VPNError as error:
            raise runtime.VPNError(redact(error, secrets) + '; ' + last_curl_error[0])
    runtime.run, runtime.http = traced_run, traced_http
    try:
        runtime.check_install()
        port_diagnostics(runtime, report)
        if had_job:
            report.mark('RECONNECT', 'INFO', 'Останавливаю только собственную службу. При переключении возможен прямой интернет.')
            touched = True
            runtime.stop()
        runtime.assert_no_other_vpn()
        working = []
        for host in HOSTS:
            if direct_probe(runtime, credentials, host, secrets, report):
                working.append(host)
        if not working:
            raise RepairError('Оба адреса не прошли прямую SOCKS5/HTTPS-проверку. Причины показаны выше.')
        port_diagnostics(runtime, report)
        base = runtime.baseline(report)
        for host in working:
            updated, raw = candidate_state(runtime, catalog, credentials, host)
            touched = True
            runtime.atomic_json(runtime.CATALOG, updated)
            report.mark('CONNECT_ENDPOINT', 'INFO', 'Подключаю %s:%s через системный туннель.' % (host, PORT))
            try:
                runtime.connect(base, report)
                ip = runtime.verify(base, report)
            except runtime.VPNError as error:
                report.mark('ENDPOINT_FAILED', 'INFO', '%s: %s' % (host, redact(error, secrets)))
                runtime.stop()  # no next attempt until cleanup is confirmed
                continue
            saved = copy.deepcopy(profile)
            saved['socks5'] = raw
            saved['socks5_alternates'] = [x for x in HOSTS if x != host]
            if runtime.VERSION == '2.1.4':
                updated['socks5_nodes'] = [runtime.validate_socks(dict(credentials, server=x)) for x in (host,) + tuple(x for x in HOSTS if x != host)]
            runtime.atomic_json(runtime.CATALOG, updated)
            runtime.atomic_json(BASE + '/private/provider-profile.json', saved)
            report.data['connected_endpoint'] = '%s:%s' % (host, PORT)
            report.data['ip_after'] = ip
            report.end('CONNECTED_WITH_WARNINGS')
            runtime.say('ГОТОВО. Подключение: %s:%s. Выходной IP: %s.' % (host, PORT, ip))
            runtime.say('Настройки сохранены. SOCKS5 не шифрует транспорт; kill switch и новая фоновая служба не устанавливались.')
            return 2
        raise RepairError('Прямой SOCKS5 отвечает, но системный туннель не прошёл проверки. Причины показаны выше.')
    except BaseException as error:
        if touched:
            try:
                runtime.stop()
                runtime.atomic_json(runtime.CATALOG, catalog)
                runtime.atomic_json(BASE + '/private/provider-profile.json', profile)
                if previous_running and not isinstance(error, KeyboardInterrupt):
                    report.mark('RESTORE', 'INFO', 'Пытаюсь восстановить прежнее подключение.')
                    oldbase = runtime.baseline(report)
                    runtime.connect(oldbase, report)
                    runtime.verify(oldbase, report)
                    report.mark('RESTORE', 'PASS', 'Прежнее подключение восстановлено и проверено.')
                else:
                    report.mark('RESTORE', 'INFO', 'Прежние настройки восстановлены; VPN не включается после отмены.')
            except BaseException as restore_error:
                runtime.say('ВОССТАНОВЛЕНИЕ НЕ ПОДТВЕРЖДЕНО: ' + redact(restore_error, secrets))
        raise
    finally:
        runtime.run, runtime.http = original_run, original_http

def main():
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise RepairError('Требуются macOS и системное подтверждение администратора.')
    os.umask(0o077)
    runtime = load_runtime()
    if (runtime.run(['/usr/bin/sw_vers', '-productVersion'])[1].split(b'.')[0] != b'11' or
            runtime.run(['/usr/bin/uname', '-m'])[1].strip() != b'x86_64' or not os.path.isdir('/System/Volumes/Data')):
        raise RepairError('Нужна установленная macOS Big Sur 11.x Intel, не Recovery.')
    # The one-shot repair must not race a separately installed supervisor.
    if os.path.lexists(BASE + '/service'):
        raise RepairError('Обнаружен отдельный сервисный слой. Чтобы не конкурировать с ним, восстановление остановлено.')
    for name in ('profiles.json', 'provider-profile.json'):
        read_checked(BASE + '/private/' + name, private=True)
    lockpath = BASE + '/private/command.lock'
    fd = os.open(lockpath, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'a+') as lock:
        s = os.fstat(lock.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_mode & 0o077:
            raise RepairError('Небезопасная блокировка команды.')
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError:
            raise RepairError('Другая команда VPN ещё выполняется. Параллельное переключение отменено.')
        catalog = json.loads(read_checked(runtime.CATALOG, private=True).decode('utf-8'))
        profile = json.loads(read_checked(BASE + '/private/provider-profile.json', private=True).decode('utf-8'))
        report = runtime.Report('automatic-socks-repair')
        runtime.say('BigSurVPN — автоматическая проверка двух SOCKS5-адресов, ревизия 1.0')
        runtime.say('Проверяю новый адрес первым. Пароли берутся из локального профиля и не выводятся.')
        try:
            return repair(runtime, catalog, profile, report)
        except (RepairError, runtime.VPNError, IOError, OSError, ValueError, KeyError) as error:
            detail = redact(error, secrets_in(catalog) + secrets_in(profile))
            report.mark('ERROR', 'FAIL', detail)
            report.end('FAILED')
            runtime.say('ПОДКЛЮЧЕНИЕ НЕ ПОДТВЕРЖДЕНО. Полная диагностика выше; отчёт сохранён: ' + runtime.REPORT)
            return 1

def interrupted(signum, frame):
    raise KeyboardInterrupt()

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        say('Операция отменена. Повторное включение VPN не запускается.')
        sys.exit(130)
    except (RepairError, OSError, IOError, ValueError, KeyError) as error:
        say('ОШИБКА: ' + text_type(error))
        sys.exit(1)
