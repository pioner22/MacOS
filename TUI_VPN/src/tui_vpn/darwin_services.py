"""Bounded launchd transitions; confirm removal before reusing a job label."""
from __future__ import annotations
import os
import re
import time
from typing import Any
from .common import AppError, clean

MISSING_JOB = (0, 3, 113)
STOP_RESULTS = (0, 3, 5, 113)
BOOTSTRAP_RESULTS = (0, 5, 17)


def job_status(host: Any) -> Any:
    return host.command(['/bin/launchctl', 'print', 'system/' + host.paths.label], MISSING_JOB)


def process_alive(pid: Any) -> bool:
    if not isinstance(pid, int) or pid < 2:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def stop_darwin(host: Any) -> None:
    before = job_status(host)
    match = re.search(rb'^\s*pid = ([1-9][0-9]*)\s*$', before.stdout, re.MULTILINE)
    pid = int(match.group(1)) if before.returncode == 0 and match else None
    host.command(['/bin/launchctl', 'bootout', 'system/' + host.paths.label], STOP_RESULTS)
    deadline = time.monotonic() + 35
    while True:
        current = job_status(host)
        if current.returncode != 0 and not process_alive(pid):
            return
        if time.monotonic() >= deadline:
            raise AppError('launchd не подтвердил завершение прежнего контроллера. Версия не переключена.')
        time.sleep(0.25)


def start_darwin(host: Any) -> bool:
    last = None
    for _attempt in range(6):
        if job_status(host).returncode == 0:
            return True
        last = host.command(['/bin/launchctl', 'bootstrap', 'system', str(host.paths.unit)], BOOTSTRAP_RESULTS)
        if last.returncode == 0:
            return True
        if last.returncode not in (5, 17):
            break
        # A nonzero bootstrap can still register a job. Observe before retrying.
        time.sleep(0.25)
    detail = clean((last.stderr or b'').decode('utf-8', 'replace'), 180) if last else ''
    raise AppError('launchd не загрузил контроллер: ' + detail)
