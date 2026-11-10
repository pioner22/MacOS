"""A live control socket alone does not prove a requested VPN is usable."""
from __future__ import annotations
from typing import Any
from .common import AppError
from .ipc import request


def installation_ready(paths: Any, status: dict, expected_source: str) -> bool:
    if status.get('source_sha256') != expected_source or status.get('stale'):
        return False
    if type(status.get('enabled')) is not bool:
        return False
    if not status.get('enabled'):
        return status.get('state') == 'OFF'
    if status.get('state') != 'RUNNING':
        return False
    try:
        tested = request('test', paths=paths, timeout=20)
    except (OSError, AppError):
        return False
    return bool(tested.get('test', {}).get('ipv4'))
