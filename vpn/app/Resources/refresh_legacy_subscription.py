# Python 2.7/3; fixed, one-operation migration bridge. Executed from app-owned
# bytes by /usr/bin/python -E -s -B -c with macOS administrator authorization.
# No profile/command/path is accepted from argv, stdin, environment or the GUI.
from __future__ import print_function
import contextlib
import fcntl
import hashlib
import json
import os
import stat
import sys

BASE = '/Library/BigSurVPN'
PRIVATE = BASE + '/private'
RELEASES = BASE + '/releases'
TRUSTED_RUNTIME = '966a6d63a7968113af5c713b5595c9c9c53628fb80e83badd31bedb84d24b877'
MAX_CODE = 2 * 1024 * 1024

class BridgeError(Exception):
    pass

def directory(path, private=False):
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise BridgeError('UNSAFE_INSTALLATION')

def read_owned(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022:
            raise BridgeError('UNSAFE_INSTALLATION')
        payload = stream.read(limit + 1)
    if len(payload) > limit:
        raise BridgeError('OVERSIZED_STATE')
    return payload

def load_runtime():
    for path in ('/Library', BASE, RELEASES):
        directory(path)
    directory(PRIVATE, private=True)
    link = BASE + '/current'
    entry = os.lstat(link)
    if not stat.S_ISLNK(entry.st_mode) or entry.st_uid != 0:
        raise BridgeError('UNSAFE_INSTALLATION')
    release = os.path.realpath(link)
    if os.path.dirname(release) != RELEASES:
        raise BridgeError('UNSAFE_INSTALLATION')
    directory(release)
    script = release + '/vpn-runtime.py'
    payload = read_owned(script, MAX_CODE)
    if hashlib.sha256(payload).hexdigest() != TRUSTED_RUNTIME:
        raise BridgeError('UNSUPPORTED_RUNTIME')
    scope = {'__name__': '_legacy_subscription_bridge', '__file__': script, '__package__': None}
    exec(compile(payload, script, 'exec'), scope)
    return scope

@contextlib.contextmanager
def command_lock():
    fd = os.open(PRIVATE + '/command.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
            raise BridgeError('UNSAFE_LOCK')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (IOError, OSError):
            raise BridgeError('VPN_OPERATION_BUSY')
        yield
    finally:
        os.close(fd)

class QuietReport(object):
    def mark(self, name, status, detail):
        if name != 'SUBSCRIPTION' or status != 'PASS':
            raise BridgeError('UNEXPECTED_RUNTIME_RESULT')
        self.updated = True
    updated = False

def refresh(scope):
    # The pinned module exposes these APIs. Never invoke the ambiguous public
    # command 'update': future releases may use that name for app updates too.
    with command_lock():
        scope['owned'](scope['CATALOG'], private=True)
        state = scope['read_json'](scope['CATALOG'])
        backend = scope['backend_of'](state)
        if backend == 'socks5':
            return 'notApplicable'
        scope['owned'](scope['ACTIVE'], private=True)
        scope['assert_routes']()
        active = scope['read_json'](scope['ACTIVE'])
        report = QuietReport()
        scope['refresh'](active['auth'], report)
        if not report.updated:
            raise BridgeError('SUBSCRIPTION_NOT_CONFIRMED')
        return 'updated'

def main():
    try:
        if sys.platform != 'darwin' or os.geteuid() != 0:
            raise BridgeError('MACOS_AUTHORIZATION_REQUIRED')
        os.umask(0o077)
        os.chdir('/')
        sys.path[:] = [p for p in sys.path if p not in ('', '.')]
        scope = load_runtime()
        result = refresh(scope)
        print(json.dumps({'schema': 1, 'result': result}, sort_keys=True))
        return 0
    except Exception as error:
        # No credentials, URLs, raw diagnostics or traceback in a GUI response.
        code = str(error) if isinstance(error, BridgeError) else 'SUBSCRIPTION_FAILED'
        print(json.dumps({'schema': 1, 'result': 'failed', 'code': code}, sort_keys=True))
        return 1

if __name__ == '__main__':
    sys.exit(main())
