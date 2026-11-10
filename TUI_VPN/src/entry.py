#!/usr/bin/env python3
"""Verified application entry, Python 3.8+; no imports from a caller's cwd."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path = [str(ROOT / 'src')] + [p for p in sys.path if p and p != str(Path.cwd())]
from tui_vpn.common import AppError, verify_source


def entry() -> int:
    try:
        verify_source(ROOT)
        from tui_vpn.runtime_permissions import prepare_installer_runtime
        from tui_vpn.terminal_backend import prepare_terminal_backend
        prepare_installer_runtime(sys.argv[1:])
        prepare_terminal_backend()
        from tui_vpn.cli import main
        return main(ROOT)
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        # The fetch worker is an internal data channel: never add diagnostics to it.
        if '_fetch' not in sys.argv:
            message = str(error) if isinstance(error, AppError) else 'Операция не выполнена; проверьте установку и доступность службы.'
            print('ОШИБКА: ' + message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(entry())
