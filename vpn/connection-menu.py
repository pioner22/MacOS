#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Explicit connection choice for the single-command entry point.

Python 2.7/3. Run only after the bootstrap verified this file AND
connection_repair.py into the same root-owned directory. No installation,
background monitor, downloaded credentials or automatic protocol substitution.
"""
from __future__ import print_function, unicode_literals
import copy
import fcntl
import io
import json
import os
import signal
import stat
import sys
import connection_repair as recovery


def choose(runtime, catalog, terminal=None):
    current = runtime.backend_of(catalog)
    runtime.say('Сохранённый режим: ' + runtime.backend_name(current))
    runtime.say('Выберите подключение:\n  1 — Xray (VLESS / Trojan)\n  2 — SOCKS5 (проверить оба адреса)\n  0 — Отмена, оставить текущее подключение')
    own = terminal is None
    if own:
        try:
            terminal = io.open('/dev/tty', 'r', encoding='utf-8')
        except (IOError, OSError):
            raise recovery.RepairError('Нужен интерактивный Терминал. Подключение не изменено.')
    try:
        for _ in range(3):
            runtime.say('Введите 1, 2 или 0:')
            line = terminal.readline(32)
            if not line or (len(line) == 32 and not line.endswith('\n')):
                raise recovery.RepairError('Выбор не получен. Подключение не изменено.')
            if line.strip() == '0':
                raise KeyboardInterrupt()
            if line.strip() in ('1', '2'):
                return {'1': 'xray', '2': 'socks5'}[line.strip()]
            runtime.say('Некорректный выбор.')
        raise recovery.RepairError('Выбор не получен. Подключение не изменено.')
    finally:
        if own:
            terminal.close()


def switch_xray(runtime, catalog, profile, report):
    desired = copy.deepcopy(catalog)
    desired['backend'] = 'xray'
    # Validate the candidate scope before stopping a working tunnel.
    nodes = runtime.candidates(desired)
    if not nodes or any(n.get('outbound', {}).get('type') not in ('vless', 'trojan') for n in nodes):
        raise recovery.RepairError('Нет сохранённых совместимых Xray/VLESS/Trojan-профилей. Текущее подключение не изменено.')
    runtime.check_install()
    had_job = bool(runtime.info())
    was_running = runtime.alive() if had_job else False
    secrets = recovery.secrets_in(catalog) + recovery.secrets_in(profile)
    touched = False
    try:
        if had_job:
            report.mark('RECONNECT', 'INFO', 'Переключаю собственную службу на Xray. Прямой интернет временно возможен.')
            touched = True
            runtime.stop()
        runtime.assert_no_other_vpn()
        base = runtime.baseline(report)
        touched = True
        runtime.atomic_json(runtime.CATALOG, desired)
        runtime.connect(base, report)
        ip = runtime.verify(base, report)
        # A running process or saved preference alone cannot prove the protocol.
        active = runtime.read_json(runtime.ACTIVE)
        config = runtime.read_json(runtime.CONFIG)
        outbound = config.get('outbounds', [{}])[0]
        actual_catalog = runtime.read_json(runtime.CATALOG)
        if (active.get('backend') != 'xray' or
                outbound.get('type') not in ('vless', 'trojan') or
                runtime.backend_of(actual_catalog) != 'xray'):
            raise recovery.RepairError('Фактический протокол не совпал с выбранным Xray. Переключение не подтверждено.')
        runtime.record_verification(ip)
        report.data.update(backend='xray', requested_backend='xray', ip_after=ip,
                           connected_protocol=outbound['type'])
        report.end('CONNECTED_WITH_WARNINGS' if report.warnings() else 'CONNECTED')
        runtime.say('ГОТОВО. Выбран Xray; проверен протокол %s. Выходной IP: %s.' % (outbound['type'].upper(), ip))
        # connect may refresh subscription data; do not overwrite its fresh catalog.
        return 2 if report.warnings() else 0
    except BaseException as error:
        if touched:
            try:
                runtime.stop()  # confirmed cleanup is required before any restart
                runtime.atomic_json(runtime.CATALOG, catalog)
                if was_running and not isinstance(error, (KeyboardInterrupt, SystemExit)):
                    report.mark('RESTORE', 'INFO', 'Xray не подключён. Пытаюсь восстановить прежний режим: ' + runtime.backend_name(runtime.backend_of(catalog)))
                    base = runtime.baseline(report)
                    runtime.connect(base, report)
                    runtime.verify(base, report)
                    report.mark('RESTORE', 'PASS', 'Прежнее подключение восстановлено. Это НЕ успешное переключение на Xray.')
                else:
                    report.mark('RESTORE', 'INFO', 'Настройки восстановлены; автоматического включения после отмены нет.')
            except BaseException as restore_error:
                runtime.say('ВОССТАНОВЛЕНИЕ НЕ ПОДТВЕРЖДЕНО: ' + recovery.redact(restore_error, secrets))
        raise


def dispatch(runtime, catalog, profile, selected, report):
    report.data['requested_backend'] = selected
    report.mark('CHOICE', 'INFO', runtime.backend_name(selected))
    if selected == 'xray':
        return switch_xray(runtime, catalog, profile, report)
    if selected == 'socks5':
        # Preserve the proven two-address recovery implementation unchanged.
        return recovery.repair(runtime, catalog, profile, report)
    raise recovery.RepairError('Неизвестный режим. Подключение не изменено.')


def main():
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise recovery.RepairError('Требуются macOS и системное подтверждение администратора.')
    os.umask(0o077)
    runtime = recovery.load_runtime()
    if (runtime.run(['/usr/bin/sw_vers', '-productVersion'])[1].split(b'.')[0] != b'11' or
            runtime.run(['/usr/bin/uname', '-m'])[1].strip() != b'x86_64' or not os.path.isdir('/System/Volumes/Data')):
        raise recovery.RepairError('Нужна установленная macOS Big Sur 11.x Intel, не Recovery.')
    if os.path.lexists(recovery.BASE + '/service'):
        raise recovery.RepairError('Обнаружен отдельный сервисный слой. Конкурирующее переключение запрещено.')
    lockpath = recovery.BASE + '/private/command.lock'
    fd = os.open(lockpath, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'a+') as lock:
        s = os.fstat(lock.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_mode & 0o077:
            raise recovery.RepairError('Небезопасная блокировка команды.')
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError:
            raise recovery.RepairError('Другая команда VPN ещё выполняется. Параллельное переключение отменено.')
        catalog = json.loads(recovery.read_checked(runtime.CATALOG, private=True).decode('utf-8'))
        profile = json.loads(recovery.read_checked(recovery.BASE + '/private/provider-profile.json', private=True).decode('utf-8'))
        runtime.say('BigSurVPN — мастер переключения Xray / SOCKS5 (1.1).')
        # No stop, catalog write, probe or subscription refresh before the choice.
        selected = choose(runtime, catalog)
        report = runtime.Report('connection-switch')
        try:
            return dispatch(runtime, catalog, profile, selected, report)
        except (recovery.RepairError, runtime.VPNError, IOError, OSError, ValueError, KeyError, IndexError) as error:
            detail = recovery.redact(error, recovery.secrets_in(catalog) + recovery.secrets_in(profile))
            report.mark('ERROR', 'FAIL', detail)
            report.end('FAILED')
            runtime.say('ВЫБРАННОЕ ПОДКЛЮЧЕНИЕ НЕ ПОДТВЕРЖДЕНО. Причина и результат восстановления показаны выше.')
            return 1


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, recovery.interrupted)
    signal.signal(signal.SIGHUP, recovery.interrupted)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        recovery.say('Операция отменена. Новые подключения после отмены не запускаются.')
        sys.exit(130)
    except (recovery.RepairError, OSError, IOError, ValueError, KeyError) as error:
        recovery.say('ОШИБКА: ' + recovery.text_type(error))
        sys.exit(1)
