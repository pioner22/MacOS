#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Unprivileged Aqua-session warning agent. Never reads VPN secrets."""
from __future__ import print_function, unicode_literals
import json
import os
import stat
import subprocess
import sys
import time

STATUS = '/Library/BigSurVPN/service/status.json'
# Fixed script: no profile names, remote strings, or untrusted interpolation.
ERROR_DIALOG = '''display dialog "Служба VPN не смогла завершить операцию. Автоматическое переподключение приостановлено. Состояние соединения не подтверждено. Проверьте vpn-bigsur service status." with title "BigSurVPN — ошибка службы" buttons {"Закрыть"} default button "Закрыть" with icon caution giving up after 120'''
DIALOG = '''display dialog "Не удалось восстановить VPN. Проверенные подключения недоступны. Служба продолжает поиск. В этой версии нет блокировки прямого интернета. Для остановки используйте vpn-bigsur off." with title "BigSurVPN — соединение потеряно" buttons {"Закрыть"} default button "Закрыть" with icon caution giving up after 120'''


def read_public():
    fd = os.open(STATUS, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022 or s.st_size > 8192:
            raise ValueError('Unsafe status')
        return json.loads(stream.read(8193).decode('utf-8'))


def should_warn(state, seen, now):
    incident = state.get('incident')
    return (isinstance(incident, (str, type(u''))) and len(incident) == 32 and
            incident != seen and state.get('phase') in ('searching', 'waiting_for_network', 'local_error', 'stop_failed', 'pause_failed') and
            0 <= now - state.get('checked_at', 0) <= 15)


def main():
    if sys.platform != 'darwin' or os.geteuid() == 0: return 1
    seen = None
    while True:
        try:
            value = read_public()
            # Only the foreground logged-in user gets a modal, not every session.
            if os.stat('/dev/console').st_uid == os.geteuid() and should_warn(value, seen, time.time()):
                seen = value['incident']
                dialog = ERROR_DIALOG if value.get('phase') in ('local_error', 'stop_failed', 'pause_failed') else DIALOG
                subprocess.call(['/usr/bin/osascript', '-e', dialog],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env={'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': os.path.expanduser('~')})
        except (OSError, ValueError, TypeError): pass
        time.sleep(2)

if __name__ == '__main__': sys.exit(main())
