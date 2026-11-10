"""Normalize only the owned public runtime inside the native installer stage."""
from __future__ import annotations
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any
from .common import AppError


def public_runtime_entries(root: Path) -> list:
    entries = []
    for path in [root] + list(root.rglob('*')):
        info = path.lstat()
        if info.st_uid != os.geteuid():
            raise AppError('Каталог среды Python имеет другого владельца.')
        if stat.S_ISLNK(info.st_mode):
            if root not in path.resolve().parents:
                raise AppError('Ссылка среды Python выходит за её каталог.')
            mode = 0o755
        elif stat.S_ISDIR(info.st_mode):
            mode = 0o755
        elif stat.S_ISREG(info.st_mode):
            mode = 0o755 if info.st_mode & 0o111 else 0o644
        else:
            raise AppError('Неожиданный объект в среде Python.')
        entries.append((path, mode, stat.S_ISLNK(info.st_mode)))
    return entries


def normalize_public_runtime(root: Any) -> None:
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise AppError('Некорректный каталог среды Python.')
    entries = public_runtime_entries(root.resolve())
    for path, mode, link in entries:
        if not link or sys.platform == 'darwin':
            os.chmod(str(path), mode, follow_symlinks=not link)


def installer_python_path(arguments: list) -> Path:
    try:
        path = Path(arguments[arguments.index('--python-tree') + 1]).resolve()
    except (ValueError, IndexError):
        raise AppError('Не указан каталог подготовленной среды Python.')
    stage = path.parent.parent
    if path.name != 'python' or path.parent.name != 'python':
        raise AppError('Среда Python не принадлежит подготовке установщика.')
    if stage.parent != Path('/private/var/tmp') or not re.fullmatch(r'tui-vpn-install\.[A-Za-z0-9]{6}', stage.name):
        raise AppError('Среда Python находится вне каталога установщика.')
    info = stage.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise AppError('Небезопасный каталог подготовки установщика.')
    return path


def prepare_installer_runtime(arguments: list) -> None:
    if sys.platform != 'darwin' or not arguments or arguments[0] != '_install':
        return
    if os.geteuid() != 0:
        raise AppError('Установку выполняет системный установщик от root.')
    path = installer_python_path(arguments)
    normalize_public_runtime(path)
    # Private directories, SQLite, receipts and sockets set explicit 0700/0600.
    # Public release links must remain traversable after the native installer exits.
    os.umask(0o022)
