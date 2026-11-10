"""Bounded data I/O; runtime paths never depend on user-supplied IPC fields."""
from __future__ import annotations
from typing import Any, Iterator
import hashlib
import json
import os
import stat
import sys
import tempfile
import unicodedata
import fcntl
from contextlib import contextmanager
from pathlib import Path


class AppError(Exception):
    """A deliberately public error without credentials or remote response bodies."""


class Paths:
    def __init__(self, system: str=None, base: Any=None) -> None:
        self.system = system or sys.platform
        self.base = Path(base or ('/Library/Application Support/TUI_VPN'
                                 if self.system == 'darwin' else '/opt/tui-vpn'))
        isolated = base is not None
        self.private = self.base / 'private' if isolated or self.system == 'darwin' else Path('/var/lib/tui-vpn')
        self.run = self.base if isolated or self.system == 'darwin' else Path('/run/tui-vpn')
        self.socket = self.run / 'control.sock'
        self.label = 'ru.pioner22.tui-vpn'
        self.unit = Path('/Library/LaunchDaemons/' + self.label + '.plist') if self.system == 'darwin' else Path('/etc/systemd/system/tui-vpn.service')
        self.launcher = Path('/usr/local/bin/tui-vpn')
        self.shortcut = Path('/Applications/TUI_VPN.command') if self.system == 'darwin' else Path('/usr/share/applications/tui-vpn.desktop')
        if isolated:
            self.unit = self.base / 'system' / ('daemon.plist' if self.system == 'darwin' else 'daemon.service')
            self.launcher = self.base / 'bin/tui-vpn'
            self.shortcut = self.base / 'shortcuts/tui-vpn'
        self.releases = self.base / 'releases'
        self.current = self.base / 'current'


def clean(value: Any, limit: int=80) -> str:
    return ''.join(c for c in str(value) if unicodedata.category(c)[0] != 'C')[:limit]


def read_bytes(path: Any, limit: int=2097152) -> bytes:
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
        raise AppError('Небезопасный тип или размер файла.')
    value = path.read_bytes()
    if len(value) > limit:
        raise AppError('Файл слишком большой.')
    return value


def read_json(path: Any, default: Any=None) -> Any:
    try:
        return json.loads(read_bytes(path).decode('utf-8'), object_pairs_hook=unique)
    except FileNotFoundError:
        if default is not None:
            return default
        raise


def unique(pairs: Any) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise AppError('Повторное поле JSON.')
        result[key] = value
    return result


def read_private_json(path: Any, default: Any = None) -> Any:
    path = Path(path)
    if os.path.lexists(str(path)):
        info = path.lstat()
        if info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise AppError('Небезопасные права закрытого файла.')
    return read_json(path, default)


def private_directory(path: Any) -> None:
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise AppError('Закрытый каталог имеет неподходящего владельца или права.')


def atomic(path: Any, data: Any, mode: int=0o600) -> None:
    path = Path(path)
    if os.path.lexists(str(path)) and not stat.S_ISREG(path.lstat().st_mode):
        raise AppError('Нельзя заменять ссылку или специальный файл.')
    fd, temporary = tempfile.mkstemp(prefix='.tui-vpn-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path: Any, value: Any) -> None:
    atomic(path, (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + '\n').encode())


@contextmanager
def owner_lock(path: Any) -> Iterator[None]:
    fd = os.open(str(path), os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise AppError('Небезопасный файл блокировки.')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AppError('Другая операция уже выполняется.')
        yield
    finally:
        os.close(fd)


def digest(path: Any) -> str:
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            value.update(block)
    return value.hexdigest()


def verify_source(root: Any) -> dict:
    root = Path(root)
    manifest = read_json(root / 'manifest.json')
    if manifest.get('schema') != 'tui-vpn.source.v1' or not 1 <= len(manifest.get('files', {})) <= 100:
        raise AppError('Неверный манифест приложения.')
    for name, expected in manifest['files'].items():
        relative = Path(name)
        if relative.is_absolute() or any(p in ('', '..', '.') for p in name.split('/')):
            raise AppError('Неверный путь в манифесте.')
        current = root
        for part in relative.parts:
            current /= part
            if current.is_symlink():
                raise AppError('Ссылка в исходниках приложения.')
        if hashlib.sha256(read_bytes(current)).hexdigest() != expected:
            raise AppError('Контрольная сумма приложения не совпала.')
    return manifest


def load_settings(root: Any) -> dict:
    value = read_json(Path(root) / 'config/defaults.json')
    if value.get('schema') != 1 or not 5 <= value.get('check_interval', 0) <= 300:
        raise AppError('Неверная конфигурация приложения.')
    for name in ('api_port', 'probe_port'):
        if type(value.get(name)) is not int or not 1024 <= value[name] <= 65535:
            raise AppError('Неверный локальный порт.')
    if value['api_port'] == value['probe_port']:
        raise AppError('Локальные порты совпадают.')
    return value
