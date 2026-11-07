#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Shared, Python 2.7/3 compatible primitives. No network actions on import."""
from __future__ import print_function, unicode_literals
import contextlib
import ctypes
import fcntl
import hashlib
import io
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
import types

BASE = '/Library/BigSurVPN'
SERVICE = BASE + '/service'
PRIVATE = BASE + '/private'
CONTROL = PRIVATE + '/service-control.json'
STATUS = SERVICE + '/status.json'
ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C',
       'HOME': '/var/root', 'TMPDIR': '/private/var/tmp'}
APPROVED_RUNTIME = {
    '966a6d63a7968113af5c713b5595c9c9c53628fb80e83badd31bedb84d24b877': '2.1.3',
    'a77fa93e468dd4ef4f8a6b2213917547fc9af1292f8be6467c7f3ab87256d756': '2.1.4',
}

class ServiceError(Exception): pass
class Busy(ServiceError): pass
class Cancelled(ServiceError): pass


def monotonic_clock():
    if hasattr(time, 'monotonic'): return time.monotonic
    if sys.platform != 'darwin': raise ServiceError('A monotonic clock is required')
    # Big Sur's system Python 2 lacks time.monotonic. Do not use wall time.
    class Timebase(ctypes.Structure):
        _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
    lib.mach_absolute_time.argtypes = []
    lib.mach_absolute_time.restype = ctypes.c_uint64
    lib.mach_timebase_info.argtypes = [ctypes.POINTER(Timebase)]
    lib.mach_timebase_info.restype = ctypes.c_int
    base = Timebase()
    if lib.mach_timebase_info(ctypes.byref(base)) or not base.denom:
        raise ServiceError('mach_timebase_info failed')
    factor = float(base.numer) / base.denom / 1000000000.0
    return lambda: lib.mach_absolute_time() * factor

CLOCK = monotonic_clock()


def encode(value):
    return value if isinstance(value, bytes) else value.encode('utf-8')


def check_directory(path, private=False):
    s = os.lstat(path)
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & (0o077 if private else 0o022):
        raise ServiceError('Unsafe directory: ' + path)


def read_checked(path, maximum=65536, private=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        if (not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or
                s.st_mode & (0o077 if private else 0o022) or s.st_size > maximum):
            raise ServiceError('Unsafe file: ' + path)
        data = stream.read(maximum + 1)
    if len(data) > maximum: raise ServiceError('Oversized file: ' + path)
    return data


def read_json(path, maximum=65536, private=True):
    return json.loads(read_checked(path, maximum, private).decode('utf-8'))


def atomic(path, payload, mode=0o600):
    check_directory(os.path.dirname(path))
    if os.path.lexists(path): read_checked(path, 8 * 1024 * 1024)
    fd, temp = tempfile.mkstemp(prefix='.service-', dir=os.path.dirname(path))
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encode(payload)); stream.flush(); os.fsync(stream.fileno())
        os.rename(temp, path)
        d = os.open(os.path.dirname(path), os.O_RDONLY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if os.path.exists(temp): os.unlink(temp)


def write_json(path, value, mode=0o600):
    atomic(path, json.dumps(value, ensure_ascii=True, sort_keys=True) + '\n', mode)


@contextlib.contextmanager
def locked(path):
    check_directory(os.path.dirname(path))
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        fcntl.fcntl(fd, fcntl.F_SETFD, fcntl.FD_CLOEXEC)
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_nlink != 1 or s.st_mode & 0o077:
            raise ServiceError('Unsafe lock file')
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except IOError: raise Busy('Another operation owns the lock')
        yield
    finally: os.close(fd)


def control():
    value = read_json(CONTROL, 4096)
    if (type(value.get('enabled')) is not bool or type(value.get('paused')) is not bool or
            type(value.get('auto_update')) is not bool or
            not isinstance(value.get('generation'), (str, type(u''))) or
            len(value['generation']) != 32):
        raise ServiceError('Invalid persistent intent')
    return value


def cancel_check(generation):
    value = control()
    if not value['enabled'] or value['paused'] or value['generation'] != generation:
        raise Cancelled('Operation superseded by user intent')


def change_intent(enabled=None, paused=None, fault=None):
    import binascii
    with locked(PRIVATE + '/service-control.lock'):
        value = control()
        if enabled is not None: value['enabled'] = bool(enabled)
        if paused is not None: value['paused'] = bool(paused)
        if enabled is not None or paused is not None:
            value['fault'] = fault
        value['generation'] = binascii.hexlify(os.urandom(16)).decode('ascii')
        write_json(CONTROL, value)
    return value


def kill(process):
    if process.poll() is None:
        try: os.killpg(process.pid, signal.SIGTERM)
        except OSError: pass
        end = CLOCK() + 1
        while process.poll() is None and CLOCK() < end: time.sleep(0.02)
        if process.poll() is None:
            try: os.killpg(process.pid, signal.SIGKILL)
            except OSError: pass
    process.wait()


def run(args, data=None, timeout=15, file_limit=65536, check=None, env=None):
    """Bound time/output; cancellation checked while waiting; no shell or secret logging."""
    import resource
    def child_limits():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
    with tempfile.TemporaryFile() as inp, tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        if data: inp.write(encode(data))
        inp.seek(0)
        if check: check()
        p = subprocess.Popen(args, stdin=inp, stdout=out, stderr=err,
                             env=env or ENV, close_fds=True, preexec_fn=child_limits)
        end = CLOCK() + timeout
        try:
            while p.poll() is None:
                if check: check()
                if CLOCK() >= end:
                    kill(p)
                    return 124, b'', b'timeout'
                time.sleep(0.025)
            if check: check()
            out.seek(0); err.seek(0)
            return p.returncode, out.read(file_limit), err.read(file_limit)
        finally: kill(p)


def require_host():
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise ServiceError('Requires installed macOS Big Sur Intel and administrator authorization')
    rc, version, _ = run(['/usr/bin/sw_vers', '-productVersion'])
    rc2, arch, _ = run(['/usr/bin/uname', '-m'])
    if rc or rc2 or not version.startswith(b'11.') or arch.strip() != b'x86_64':
        raise ServiceError('Unsupported OS or architecture')
    if not os.path.isdir('/System/Volumes/Data'): raise ServiceError('Recovery is not supported')
    for path in ('/Library', BASE, BASE + '/releases', SERVICE): check_directory(path)
    check_directory(PRIVATE, private=True)


def load_runtime():
    current = BASE + '/current'
    s = os.lstat(current)
    release = os.path.realpath(current)
    if not stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or os.path.dirname(release) != BASE + '/releases':
        raise ServiceError('Unexpected installed runtime location')
    check_directory(release)
    path = release + '/vpn-runtime.py'
    payload = read_checked(path, 2 * 1024 * 1024)
    digest = hashlib.sha256(payload).hexdigest()
    if digest not in APPROVED_RUNTIME: raise ServiceError('Runtime adapter has not been validated for this version')
    meta = read_json(release + '/manifest.json')
    if meta.get('hashes', {}).get('vpn-runtime.py') != digest:
        raise ServiceError('Runtime manifest mismatch')
    module = types.ModuleType(str('installed_bigsurvpn'))
    module.__file__ = path
    exec(compile(payload, path, 'exec'), module.__dict__)
    module.check_install()
    module.CLOCK = CLOCK
    return module


def journal(value, maximum=1024 * 1024):
    """Bounded history of sanitized state transitions, not raw VPN logs."""
    path = PRIVATE + '/supervisor-events.jsonl'
    check_directory(PRIVATE, private=True)
    if os.path.lexists(path):
        data = read_checked(path, maximum + 65536, private=True)
        if len(data) >= maximum:
            for old, new in ((path + '.1', path + '.2'), (path, path + '.1')):
                if os.path.lexists(old):
                    read_checked(old, maximum + 65536, private=True)
                    if os.path.lexists(new): read_checked(new, maximum + 65536, private=True)
                    os.rename(old, new)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'ab') as stream:
        payload = encode(json.dumps(value, ensure_ascii=True, sort_keys=True) + '\n')
        if len(payload) > 8192: raise ServiceError('Oversized journal event')
        stream.write(payload); stream.flush()
