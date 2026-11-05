#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Developer-preview installer. No downloaded executable is run.

Explicit --development required. Not a signed production release.
The current VPN code, profile, DNS and connection are not changed by installation.
"""
from __future__ import print_function, unicode_literals
import binascii
import hashlib
import json
import os
import plistlib
import shutil
import sys
import tempfile
from service_common import (BASE, PRIVATE, SERVICE, CONTROL, STATUS, ServiceError,
    read_checked, write_json, atomic, check_directory, locked, load_runtime, run)

FILES = ('service_common.py', 'service_policy.py', 'macos_adapter.py', 'probe_guard.py',
         'supervisor.py', 'secure_update.py', 'user_agent.py', 'install_service.py')
DAEMONS = '/Library/LaunchDaemons'
AGENTS = '/Library/LaunchAgents'
PREFIX = 'ru.pioner22.bigsur-vpn'

WRAPPER = '''#!/bin/bash
set +x
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset PYTHONPATH PYTHONHOME BASH_ENV ENV CDPATH
S=/Library/BigSurVPN/service/current
R=/Library/BigSurVPN/current/vpn-runtime.py
cmd=${1:-status}
case "$cmd" in --*) cmd=${cmd#--} ;; esac
case "$cmd" in
  --help|-h|help)
    /usr/bin/python -E -s -B "$R" help
    printf '\\n%s\\n' 'Служба: vpn-bigsur service status|on|off|pause|resume' 'on/off управляют постоянным намерением службы. update: подписанный выпуск, затем подписка.'
    exit 0 ;;
  --version|-V|version)
    /usr/bin/python -E -s -B "$R" version
    printf '%s\\n' 'Supervisor 0.1.0-preview — native validation pending'
    exit 0 ;;
esac
if [ "$EUID" -ne 0 ]; then
  exec /usr/bin/sudo /bin/bash /Library/BigSurVPN/vpn-bigsur.sh "$@"
fi
case "$cmd" in
  on|off) [ "$#" = 1 ] || exit 2; exec /usr/bin/python -E -s -B "$S/supervisor.py" "$cmd" ;;
  service)
    [ "$#" = 2 ] || exit 2
    if [ "$2" = remove ]; then exec /usr/bin/python -E -s -B "$S/install_service.py" remove; fi
    case "$2" in on|off|pause|resume|status|logs) ;; *) exit 2 ;; esac
    exec /usr/bin/python -E -s -B "$S/supervisor.py" "$2" ;;
  update)
    [ "$#" = 1 ] || exit 2
    exec /usr/bin/python -E -s -B "$S/secure_update.py" once ;;
  setup|uninstall)
    printf '%s\\n' 'Сначала удалите сервисный слой: install_service.py remove. Рабочие профили будут сохранены.' >&2
    exit 2 ;;
  wizard|menu|select)
    case "$cmd:$#" in wizard:1|menu:1|select:2) ;; *) exit 2 ;; esac
    /usr/bin/python -E -s -B "$S/supervisor.py" pause
    rc=0
    /usr/bin/python -E -s -B "$R" "$@" || rc=$?
    # No automatic restart after a cancelled/failed wizard. Stop remains authoritative.
    case "$cmd:$rc" in
      wizard:0|wizard:2|menu:0|menu:2) /usr/bin/python -E -s -B "$S/supervisor.py" on ;;
      select:*) /usr/bin/python -E -s -B "$S/supervisor.py" resume ;;
    esac
    exit "$rc" ;;
  logs)
    /usr/bin/python -E -s -B "$S/supervisor.py" logs
    exec /usr/bin/python -E -s -B "$R" logs ;;
  report)
    exec /usr/bin/python -E -s -B "$S/supervisor.py" status ;;
  status)
    /usr/bin/python -E -s -B "$S/supervisor.py" status
    exec /usr/bin/python -E -s -B "$R" status ;;
  *) exec /usr/bin/python -E -s -B "$R" "$@" ;;
esac
'''


def plist(value):
    return plistlib.dumps(value) if hasattr(plistlib, 'dumps') else plistlib.writePlistToString(value)


def jobs():
    path = SERVICE + '/current/'
    base = {'RunAtLoad': True, 'WorkingDirectory': '/', 'Umask': 0o077,
            'EnvironmentVariables': {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'},
            'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    monitor = dict(base, Label=PREFIX + '.supervisor', KeepAlive=True, ThrottleInterval=5,
                   ProgramArguments=['/usr/bin/python', '-E', '-s', '-B', path + 'supervisor.py', 'daemon'])
    updater = dict(base, Label=PREFIX + '.updater', StartInterval=21600,
                   ProgramArguments=['/usr/bin/python', '-E', '-s', '-B', path + 'secure_update.py', 'once'])
    agent = dict(base, Label=PREFIX + '.alerts', KeepAlive=True, ThrottleInterval=10,
                 LimitLoadToSessionType='Aqua',
                 ProgramArguments=['/usr/bin/python', '-E', '-s', '-B', path + 'user_agent.py'])
    return [(DAEMONS + '/' + monitor['Label'] + '.plist', monitor),
            (DAEMONS + '/' + updater['Label'] + '.plist', updater),
            (AGENTS + '/' + agent['Label'] + '.plist', agent)]


def check_host():
    if sys.platform != 'darwin' or os.geteuid() != 0: raise ServiceError('macOS with administrator privileges required')
    rc, v, _ = run(['/usr/bin/sw_vers', '-productVersion'])
    rc2, a, _ = run(['/usr/bin/uname', '-m'])
    if rc or rc2 or not v.startswith(b'11.') or a.strip() != b'x86_64' or not os.path.isdir('/System/Volumes/Data'):
        raise ServiceError('Only installed Big Sur 11.x Intel is supported')
    for path in ('/Library', BASE, BASE + '/releases', DAEMONS, AGENTS): check_directory(path)
    check_directory(PRIVATE, private=True)


def install(source):
    check_host()
    if os.path.lexists(SERVICE): raise ServiceError('Service layer already exists; no unmanaged overwrite')
    for path, _ in jobs():
        if os.path.lexists(path): raise ServiceError('A service label is already occupied')
    rt = load_runtime()
    if rt.VERSION != '2.1.4': raise ServiceError('Install the already provided 2.1.4 upgrade first; no implicit runtime replacement')
    # Package files are read in full before copying, compiled without running,
    # and then written in an administrator-owned staging directory.
    payloads = {}
    for name in FILES:
        path = os.path.join(source, name)
        with open(path, 'rb') as stream: payload = stream.read(1024 * 1024 + 1)
        if not 0 < len(payload) <= 1024 * 1024: raise ServiceError('Invalid source size')
        compile(payload, name, 'exec')
        payloads[name] = payload
    wrapper = read_checked(BASE + '/vpn-bigsur.sh', 65536)
    created, loaded = [], []
    with locked(PRIVATE + '/command.lock'):
        enabled = rt.alive()
        try:
            os.mkdir(SERVICE, 0o755); os.chmod(SERVICE, 0o755)
            releases = SERVICE + '/releases'; os.mkdir(releases, 0o755); os.chmod(releases, 0o755)
            target = releases + '/preview-1'; os.mkdir(target, 0o755); os.chmod(target, 0o755)
            for name, payload in payloads.items(): atomic(target + '/' + name, payload, 0o644)
            atomic(SERVICE + '/original-cli.sh', wrapper, 0o600)
            os.symlink('releases/preview-1', SERVICE + '/current')
            generation = binascii.hexlify(os.urandom(16)).decode('ascii')
            write_json(CONTROL, {'enabled': enabled, 'paused': False, 'auto_update': True, 'generation': generation})
            write_json(STATUS, {'schema': 1, 'phase': 'starting', 'generation': generation, 'incident': None,
                                'checked_at': 0, 'kill_switch': False}, 0o644)
            # No publisher key or Apple signing identity is invented by this installer.
            atomic(BASE + '/vpn-bigsur.sh', WRAPPER, 0o755)
            for path, value in jobs():
                atomic(path, plist(value), 0o644); created.append(path)
            for path, value in jobs()[:2]:
                rc, _, _ = run(['/bin/launchctl', 'bootstrap', 'system', path], timeout=15)
                if rc: raise ServiceError('Service registration failed')
                loaded.append(value['Label'])
        except BaseException:
            for label in reversed(loaded): run(['/bin/launchctl', 'bootout', 'system/' + label], timeout=15)
            atomic(BASE + '/vpn-bigsur.sh', wrapper, 0o755)
            for path in created:
                if os.path.isfile(path): os.unlink(path)
            if os.path.isdir(SERVICE): shutil.rmtree(SERVICE)
            if os.path.isfile(CONTROL): os.unlink(CONTROL)
            raise
    # Activate UI agent only for the current logged-in GUI session. Other sessions
    # receive it at the next login via /Library/LaunchAgents.
    uid = os.stat('/dev/console').st_uid
    if uid >= 501:
        rc, _, _ = run(['/bin/launchctl', 'bootstrap', 'gui/' + str(uid), jobs()[2][0]], timeout=15)
        if rc: print('ALERT_AGENT_PENDING_LOGIN: service registered, desktop agent not confirmed')
    print('DEVELOPMENT_SERVICE_REGISTERED; autoupdate remains NOT_CONFIGURED without publisher trust')
    print('Connection enabled intent was preserved. Control: vpn-bigsur service status')


def remove():
    check_host()
    check_directory(SERVICE)
    # Stop intent is written first; a launchd restart cannot undo it.
    from service_common import change_intent
    change_intent(enabled=False, paused=False)
    rt = load_runtime()
    for label in (PREFIX + '.updater', PREFIX + '.supervisor'):
        rc, _, _ = run(['/bin/launchctl', 'bootout', 'system/' + label], timeout=20)
        if rc: raise ServiceError('Service removal not confirmed; nothing deleted')
    with locked(PRIVATE + '/command.lock'):
        rt.stop()
        old = read_checked(SERVICE + '/original-cli.sh', 65536, private=True)
        uid = os.stat('/dev/console').st_uid
        if uid >= 501: run(['/bin/launchctl', 'bootout', 'gui/' + str(uid) + '/' + PREFIX + '.alerts'], timeout=15)
        atomic(BASE + '/vpn-bigsur.sh', old, 0o755)
        for path, _ in jobs():
            read_checked(path, 16384); os.unlink(path)
        shutil.rmtree(SERVICE)
    print('Service layer removed. VPN profiles and installed runtime are preserved; VPN is off.')


def main():
    os.umask(0o077)
    if sys.argv[1:] == ['--development']:
        install(os.path.dirname(os.path.abspath(__file__)))
    elif sys.argv[1:] == ['remove']: remove()
    else:
        raise ServiceError('Developer preview only: --development or remove. Not a stable release.')

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('INSTALL_FAILED: ' + (str(error) if isinstance(error, ServiceError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
