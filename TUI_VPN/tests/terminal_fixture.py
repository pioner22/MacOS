"""Real terminal and local IPC fixture; transport is explicitly simulated."""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path
from unittest import mock

PASSWORD = 'FixtureSecretQ_012!'
URI = 'trojan://fixture-password@example.org:443?security=tls&sni=example.org#Primary'


class Alive:
    def poll(self):
        return None


class FakeEngine:
    def __init__(self):
        self.process, self.selection, self.starts = None, 'auto', 0

    def guard(self):
        pass

    def check(self, *_args):
        pass

    def start(self, _nodes, selection, _wanted):
        self.process, self.selection = Alive(), selection
        self.starts += 1

    def stop(self):
        self.process = None

    def select(self, value):
        self.selection = value

    def observe(self, nodes):
        selected = nodes[0]['id'] if self.selection == 'auto' else self.selection
        return {'state': 'RUNNING', 'selected': selected,
                'health': {n['id']: {'healthy': True, 'delay_ms': 12} for n in nodes},
                'rx_rate': 1200, 'tx_rate': 600, 'rx_bytes': 5000, 'tx_bytes': 2500,
                'connections': 2, 'memory_bytes': 1000000}

    def touch(self):
        pass

    def test(self):
        return {'ipv4': '198.51.100.77'}


class FakeHealth:
    def snapshot(self, nodes):
        return ({n['id']: {'state': 'ok', 'delay_ms': 12, 'path': 'current',
                          'checked_at': time.time(), 'error': ''} for n in nodes},
                {'running': False, 'total': len(nodes), 'done': len(nodes), 'retry_after': 0})

    def start(self, _nodes):
        return True

    def invalidate(self, _nodes):
        pass

    def cancel(self):
        pass

    def close(self):
        pass


def observe(ui, manager, file, flags):
    from tui_vpn.common import write_json
    data = manager.status()
    form = getattr(ui, '_active_form', None)
    write_json(file, {'ready': True, 'page': ui.page, 'row': ui.row,
        'form': form.title if form else None, 'focus': form.focus if form else None,
        'enabled': data['enabled'], 'selection': data['selection'], 'state': data['state'],
        'servers': [{k: n[k] for k in ('id', 'name', 'kind')} for n in data['servers']],
        'starts': manager.engine.starts, 'active_revision': manager.active_revision,
        'catalog_revision': manager.catalog.revision, 'message': ui.message,
        'acting': ui.acting, 'flags': dict(flags)})


def terminal(manager, paths, observation, flags):
    import curses
    from tui_vpn.ui import UI
    from tui_vpn.ui_forms import Form
    from tui_vpn.ipc import request

    class ObservedUI(UI):
        def draw(self):
            super().draw()
            observe(self, manager, observation, flags)

    class ObservedForm(Form):
        def run(self):
            self.ui._active_form = self
            try:
                return super().run()
            finally:
                self.ui._active_form = None

    def rpc(command, args=None):
        value = request(command, args, paths=paths)
        flags[command] = flags.get(command, 0) + 1
        if command == 'socks_save' and args.get('id'):
            node = next(n for n in manager.catalog.nodes() if n['id'] == args['id'])
            flags['saved_password_kept'] = node['outbound']['password'] == PASSWORD
        return value

    with mock.patch('tui_vpn.ui_forms.Form', ObservedForm), \
            mock.patch('tui_vpn.service.fetch_worker', return_value=URI.encode()):
        curses.wrapper(lambda screen: ObservedUI(screen, rpc, demo=True).run())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app-root', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--observation', type=Path, required=True)
    parser.add_argument('--result', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.app_root / 'src'))
    from tui_vpn.common import Paths, verify_source
    verify_source(args.app_root)
    from tui_vpn.terminal_backend import prepare_terminal_backend
    prepare_terminal_backend()
    from tui_vpn.service import Manager
    from tui_vpn.ipc import Server
    from tui_vpn.ui import set_locale
    set_locale()
    paths = Paths(base=args.runtime)
    manager = Manager(paths, args.app_root, FakeEngine())
    manager.health = FakeHealth()
    server = Server(paths, os.getuid(), manager)
    threads = [threading.Thread(target=target, daemon=True) for target in
               (server.serve_forever, manager.supervise, manager.monitor)]
    for thread in threads:
        thread.start()
    flags = {}
    try:
        terminal(manager, paths, args.observation, flags)
        data = manager.status()
        args.result.write_text(json.dumps({'status': 'PASS_UI', 'native_terminal': True,
            'real_local_ipc': True, 'simulated_transport': True, 'flags': flags,
            'enabled_after_quit': data['enabled'], 'profiles_after_delete': len(data['servers']),
            'uid': os.getuid(), 'system_vpn_changed': False}, indent=2))
    finally:
        manager.stop_event.set()
        manager.changed.set()
        server.shutdown()
        server.server_close()
        for thread in threads:
            thread.join(2)
        paths.socket.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
