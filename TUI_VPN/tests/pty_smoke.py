#!/usr/bin/env python3
"""Run the real curses frontend in a disposable PTY, never a real VPN."""
import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def size(master: int, height: int, width: int) -> None:
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', height, width, 0, 0))


def collect(master: int, seconds: float=0.8) -> bytes:
    result = bytearray()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            result.extend(data)
            if len(result) > 1048576:
                raise AssertionError('Unexpected terminal output volume')
    return bytes(result)


def wait_exit(child: int) -> int:
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        done, code = os.waitpid(child, os.WNOHANG)
        if done:
            return code
        time.sleep(0.1)
    raise AssertionError('TUI did not exit')


def smoke(interpreter: str) -> dict:
    child, master = pty.fork()
    if child == 0:
        environment = dict(os.environ, TERM='xterm-256color')
        os.execve(interpreter, [interpreter, '-I', '-B', str(ROOT / 'src/entry.py'), '--demo'], environment)
    captured = bytearray()
    reaped = False
    try:
        size(master, 28, 100)
        captured.extend(collect(master, 2))
        assert b'TUI VPN' in captured
        assert 'ДЕМО'.encode() in captured
        for key in (b'2', b't', b'3', b'n'):
            os.write(master, key)
            captured.extend(collect(master, 0.3))
        secret = b'https://example.org/demo-private-token-never-echo'
        os.write(master, secret + b'\r')
        captured.extend(collect(master, 0.8))
        assert secret not in captured
        size(master, 12, 50)
        os.kill(child, signal.SIGWINCH)
        captured.extend(collect(master, 0.6))
        assert 'Увеличьте'.encode() in captured
        size(master, 28, 100)
        os.kill(child, signal.SIGWINCH)
        captured.extend(collect(master, 0.4))
        os.write(master, b'q')
        captured.extend(collect(master, 0.4))
        status = wait_exit(child)
        reaped = True
        assert status == 0, 'TUI did not exit cleanly'
        return {'status': 'PASS', 'real_pty': True, 'demo_only': True,
                'masked_input': True, 'resize': True, 'terminal_bytes': len(captured)}
    finally:
        if not reaped:
            try:
                os.kill(child, signal.SIGTERM)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)
        os.close(master)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = smoke(args.python)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
