"""Asynchronous, cancellable availability checks with private helper processes."""
from __future__ import annotations

import copy
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from .engine import stop_process

STATES = frozenset({'ok', 'failed', 'error', 'blocked', 'unsupported'})
ERRORS = frozenset({'', 'wireguard', 'address', 'dns', 'probe', 'connection', 'auth', 'tls', 'denied'})
WORKER_ENTRY = Path(__file__).resolve().parents[1] / 'entry.py'


def fingerprint(node: dict) -> str:
    raw = json.dumps(node, sort_keys=True, ensure_ascii=True).encode()
    return hashlib.sha256(raw).hexdigest()


def close_worker(process: Any) -> None:
    stop_process(process)
    if process is None:
        return
    for stream in (process.stdin, process.stdout):
        try:
            if stream is not None:
                stream.close()
        except OSError:
            pass


class HealthChecks:
    def __init__(self, paths: Any, root: Path, settings: dict) -> None:
        self.paths, self.root, self.settings = paths, Path(root), settings
        self.lock = threading.RLock()
        self.records: dict = {}
        self.generation, self.running = 0, False
        self.process, self.thread = None, None
        self.last_started, self.total = -float('inf'), 0

    def snapshot(self, nodes: list) -> tuple[dict, dict]:
        now = time.monotonic()
        with self.lock:
            values = {node['id']: self._public(node, now) for node in nodes}
            done = sum(value['state'] != 'checking' for value in values.values())
            cooldown = max(0, self.settings['probe_min_interval'] - (now - self.last_started))
            return values, {'running': self.running, 'total': self.total,
                            'done': min(done, self.total), 'retry_after': round(cooldown, 1),
                            'ttl': self.settings['probe_cache_ttl'],
                            'minimum_interval': self.settings['probe_min_interval']}

    def _public(self, node: dict, now: float) -> dict:
        record = self.records.get(node['id'])
        if record is None or record['fingerprint'] != fingerprint(node):
            return {'state': 'unknown', 'delay_ms': None, 'checked_at': None, 'path': '', 'error': ''}
        value = dict(record['value'])
        wall_age = time.time() - (value.get('checked_at') or time.time())
        age = max(now - record['observed'], wall_age)
        if value['state'] not in ('checking', 'unsupported') and age > self.settings['probe_cache_ttl']:
            value.update(state='stale', delay_ms=None)
        return value

    def start(self, nodes: list) -> bool:
        with self.lock:
            if self.running or not nodes:
                return False
            if time.monotonic() - self.last_started < self.settings['probe_min_interval']:
                return False
            self.generation += 1
            generation = self.generation
            snapshot = copy.deepcopy(nodes)
            self.total, self.running, self.last_started = len(nodes), True, time.monotonic()
            for node in snapshot:
                self.records[node['id']] = {'fingerprint': fingerprint(node), 'observed': self.last_started,
                    'value': {'state': 'checking', 'delay_ms': None, 'checked_at': None, 'path': '', 'error': ''}}
            self.thread = threading.Thread(target=self._run, args=(snapshot, generation), daemon=True)
            self.thread.start()
            return True

    def invalidate(self, nodes: list) -> None:
        expected = {node['id']: fingerprint(node) for node in nodes}
        with self.lock:
            changed = any(expected.get(identity) != record['fingerprint']
                          for identity, record in self.records.items())
            changed = changed or bool(set(expected) - set(self.records))
        if changed:
            self.cancel()
        with self.lock:
            self.records = {identity: value for identity, value in self.records.items()
                            if expected.get(identity) == value['fingerprint']}

    def cancel(self) -> None:
        with self.lock:
            self.generation += 1
            process, self.running, self.process = self.process, False, None
            for record in self.records.values():
                if record['value']['state'] == 'checking':
                    record['value'].update(state='unknown', error='cancelled')
        if process is not None and process.poll() is None:
            # Waiting happens outside the RPC thread so manual OFF stays responsive.
            threading.Thread(target=stop_process, args=(process,), daemon=True).start()

    def close(self) -> None:
        self.cancel()
        thread = self.thread
        if thread is not None:
            thread.join(timeout=7)

    def _accept(self, line: str, nodes: dict, generation: int) -> None:
        value = json.loads(line)
        identity = value.get('id')
        if identity not in nodes or value.get('state') not in STATES:
            raise ValueError('Invalid probe result')
        delay = value.get('delay_ms')
        if value['state'] == 'ok' and (type(delay) is not int or not 0 <= delay <= 65535):
            raise ValueError('Invalid probe delay')
        path = value.get('path')
        if not isinstance(path, str) or not re.fullmatch(r'(?:current|local|direct:[A-Za-z0-9_.:-]{1,32})', path):
            raise ValueError('Invalid probe path')
        if value.get('error', '') not in ERRORS:
            raise ValueError('Invalid probe error')
        public = {key: value.get(key) for key in ('state', 'delay_ms', 'path', 'error')}
        if value['state'] != 'ok':
            public['delay_ms'] = None
        public['checked_at'] = time.time()
        with self.lock:
            if generation != self.generation:
                return
            self.records[identity] = {'fingerprint': fingerprint(nodes[identity]),
                                      'observed': time.monotonic(), 'value': public}

    def _finish(self, generation: int) -> None:
        with self.lock:
            if generation != self.generation:
                return
            for record in self.records.values():
                if record['value']['state'] == 'checking':
                    record['observed'] = time.monotonic()
                    record['value'].update(state='error', error='probe', checked_at=time.time())
            self.running, self.process = False, None

    def _run(self, nodes: list, generation: int) -> None:
        process, timer = None, None
        try:
            with tempfile.TemporaryDirectory(prefix='probe-', dir=str(self.paths.private)) as name:
                payload = {'nodes': nodes, 'settings': self.settings, 'workspace': str(Path(name).resolve())}
                process = subprocess.Popen([sys.executable, '-I', '-B', str(WORKER_ENTRY), '_probe'],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    text=True, start_new_session=True, close_fds=True)
                with self.lock:
                    stale = generation != self.generation
                    if not stale:
                        self.process = process
                if stale:
                    stop_process(process)
                    return
                timer = threading.Timer(self.settings['probe_batch_timeout'], stop_process, args=(process,))
                timer.daemon = True
                timer.start()
                process.stdin.write(json.dumps(payload))
                process.stdin.close()
                by_id = {node['id']: node for node in nodes}
                for _ in range(len(nodes) + 1):
                    line = process.stdout.readline(4097)
                    if not line:
                        break
                    if len(line) > 4096:
                        raise ValueError('Oversized probe result')
                    self._accept(line, by_id, generation)
                process.wait(timeout=3)
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass  # Public results carry a bounded error, never helper output or credentials.
        finally:
            if timer is not None:
                timer.cancel()
            close_worker(process)
            self._finish(generation)
