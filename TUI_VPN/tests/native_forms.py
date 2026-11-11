#!/usr/bin/env python3
"""Drive the genuine curses forms, IPC and private catalog in a disposable PTY."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path

from terminal_fixture import PASSWORD


class Driver:
    def __init__(self, app_root, folder):
        self.master, slave = pty.openpty()
        self.observation, self.result = folder / 'observed.json', folder / 'result.json'
        self.output = bytearray()
        self.down = subprocess.run(['/usr/bin/tput', '-T', 'xterm-256color', 'kcud1'],
                                   capture_output=True, check=True, timeout=3).stdout
        self.resize(30, 100)
        child = Path(__file__).resolve().parent / 'terminal_fixture.py'
        args = [sys.executable, '-B', str(child), '--app-root', str(app_root),
                '--runtime', str(folder / 'runtime'), '--observation', str(self.observation),
                '--result', str(self.result)]
        self.process = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave,
            env=dict(os.environ, TERM='xterm-256color', LANG='en_US.UTF-8'),
            start_new_session=True, close_fds=True)
        os.close(slave)

    def resize(self, rows, columns):
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
        process = getattr(self, 'process', None)
        if process is not None and process.poll() is None:
            os.kill(process.pid, signal.SIGWINCH)

    def send(self, value):
        os.write(self.master, value if isinstance(value, bytes) else value.encode())

    def drain(self):
        if select.select([self.master], [], [], 0.05)[0]:
            try:
                self.output.extend(os.read(self.master, 65536))
            except OSError:
                pass
        if len(self.output) > 4194304:
            raise AssertionError('Unexpected terminal output volume')

    def state(self):
        try:
            return json.loads(self.observation.read_text())
        except (OSError, ValueError):
            return {}

    def wait(self, predicate, seconds=10):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.drain()
            state = self.state()
            if predicate(state):
                return state
            if self.process.poll() is not None:
                break
        tail = self.output[-1600:].decode(errors='replace').replace(PASSWORD, '[masked]')
        raise AssertionError('Terminal state not reached: ' + json.dumps(self.state()) + '\n' + tail)

    def click(self, x, y):
        self.send(b'\x1b[M' + bytes([32, 33 + x, 33 + y])
                  + b'\x1b[M' + bytes([35, 33 + x, 33 + y]))

    def close(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(3)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(3)
        os.close(self.master)


def add_connections(driver):
    driver.wait(lambda s: s.get('ready'))
    driver.send('p')
    driver.wait(lambda s: 'Сначала добавьте' in s.get('message', ''))
    driver.send('n')
    driver.wait(lambda s: s.get('form') == 'Добавить подписку')
    driver.send('UI feed\nhttps://example.org/subscription\n')
    driver.wait(lambda s: len(s.get('servers', [])) == 1 and not s.get('form') and not s.get('acting'))
    driver.send('s')
    driver.wait(lambda s: s.get('form') == 'Добавить SOCKS5')
    driver.send('Reserve\n127.0.0.1\n1080\nlab\n' + PASSWORD)
    for _ in range(3):
        driver.resize(12, 45)
        driver.drain()
        driver.resize(30, 100)
        driver.drain()
    driver.send('\n')
    state = driver.wait(lambda s: len(s.get('servers', [])) == 2 and not s.get('form') and not s.get('acting'))
    return next(n['id'] for n in state['servers'] if n['kind'] == 'socks')


def edit_connection(driver, socks_id):
    driver.send(driver.down + b'\n')
    driver.wait(lambda s: s.get('selection') == socks_id and not s.get('acting'))
    driver.send(' ')
    driver.wait(lambda s: s.get('state') == 'RUNNING' and not s.get('acting'))
    driver.send('e')
    driver.wait(lambda s: s.get('form') == 'Изменить SOCKS5')
    driver.send('\x15Edited reserve\t\t\t\t\n')
    driver.wait(lambda s: s.get('flags', {}).get('saved_password_kept') is True
                and not s.get('form') and not s.get('acting'))
    count = driver.state()['flags'].get('probe', 0)
    driver.send('p')
    driver.wait(lambda s: s.get('flags', {}).get('probe', 0) > count and not s.get('acting'))
    driver.send('a')
    driver.wait(lambda s: s.get('selection') == 'auto' and not s.get('acting'))
    driver.send('t')


def refresh_subscription(driver):
    driver.send('3')
    driver.wait(lambda s: s.get('page') == 2 and s.get('state') == 'RUNNING'
                and s.get('active_revision') == s.get('catalog_revision'))
    starts = driver.state()['starts']
    driver.send('r')
    driver.wait(lambda s: s.get('flags', {}).get('subscription_refresh', 0) > 0 and not s.get('acting'))
    assert driver.state()['starts'] == starts, 'Unchanged refresh restarted the transport'


def remove_and_toggle(driver):
    driver.send(b'2' + driver.down)
    driver.wait(lambda s: s.get('page') == 1 and s.get('row') == 1)
    driver.send('dДА\n')
    driver.wait(lambda s: len(s.get('servers', [])) == 1 and not s.get('acting'))
    driver.send(' ')
    driver.wait(lambda s: s.get('state') == 'OFF' and not s.get('enabled'))
    driver.send(' ')
    driver.wait(lambda s: s.get('state') == 'RUNNING' and s.get('enabled'))
    driver.click(68, 29)


def scenario(driver):
    socks_id = add_connections(driver)
    edit_connection(driver, socks_id)
    refresh_subscription(driver)
    remove_and_toggle(driver)
    driver.wait(lambda _s: driver.result.exists())
    driver.process.wait(5)
    assert driver.process.returncode == 0
    assert PASSWORD.encode() not in driver.output, 'Secret appeared in terminal output'
    result = json.loads(driver.result.read_text())
    assert result['enabled_after_quit'] is True
    assert result['flags']['saved_password_kept'] is True
    result.update(resize_cycles=3, password_not_echoed=True, mouse_quit=True,
                  terminal_bytes=len(driver.output), unchanged_refresh_no_restart=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # A Unix socket is limited to104 bytes on macOS; the Hub report path is longer.
    parent = '/private/tmp' if sys.platform == 'darwin' else '/tmp'
    with tempfile.TemporaryDirectory(prefix='p10-W0421B-ui-', dir=parent) as temporary:
        driver = Driver(args.app_root.resolve(), Path(temporary))
        try:
            result = scenario(driver)
            args.output.write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))
        finally:
            driver.close()


if __name__ == '__main__':
    main()
