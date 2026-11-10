"""Use the pinned CPython extension built for the oldest supported Apple SDK."""
from __future__ import annotations
import platform
import sys
from types import ModuleType
from .common import AppError


def compatibility_module() -> ModuleType:
    from vendor.darwin_x86_64 import _curses
    return _curses


def prepare_terminal_backend() -> None:
    if sys.platform != 'darwin' or platform.machine() != 'x86_64':
        return
    if tuple(sys.version_info[:3]) != (3, 12, 16):
        return
    if 'curses' in sys.modules:
        raise AppError('Терминальный модуль уже загружен. Запустите tui-vpn в новом процессе.')
    try:
        backend = compatibility_module()
    except (ImportError, OSError) as error:
        raise AppError('Совместимый модуль терминала недоступен. Переустановите пакет TUI VPN.') from error
    sys.modules['_curses'] = backend
