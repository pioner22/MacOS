"""Small native curses UI; no network credentials are printed or logged."""
from __future__ import annotations
from typing import Any
import curses
import locale
import math
import os
import queue
import threading
import time
from collections import deque
from pathlib import Path
from .common import AppError, Paths, clean, private_directory, read_bytes, read_json, write_json
from .ipc import request

STATES = {'OFF': 'ВЫКЛЮЧЕН', 'STARTING': 'ЗАПУСК', 'STOPPING': 'ВЫКЛЮЧЕНИЕ',
    'RUNNING': 'ОНЛАЙН', 'CHECKING': 'ПРОВЕРКА', 'RETRYING': 'ПОВТОР ЗАПУСКА',
    'NO_HEALTHY_PATH': 'НЕТ ДОСТУПНОГО ПУТИ'}
THEMES = ('ocean', 'light', 'mono')


def human(value: Any, rate: bool=False) -> str:
    if value is None:
        return '—'
    value = max(0, float(value))
    units = ('Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ')
    index = 0
    while value >= 1024 and index < len(units) - 1:
        value /= 1024
        index += 1
    return ('%.1f %s' % (value, units[index])) + ('/с' if rate else '')


def clipped(value: Any, width: int) -> str:
    import unicodedata
    result, used = [], 0
    for char in clean(value, 4096):
        size = 0 if unicodedata.combining(char) else 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1
        if used + size > max(0, width):
            break
        result.append(char)
        used += size
    return ''.join(result)


def spark(values: Any, width: int) -> str:
    values = list(values)[-max(1, width):]
    maximum = max([1] + values)
    chars = '▁▂▃▄▅▆▇█'
    return ''.join(chars[min(7, int(v / maximum * 7))] for v in values)


class Demo:
    def __init__(self) -> None:
        self.enabled, self.selection = True, 'auto'

    def __call__(self, command: str, args: Any=None) -> dict:
        args = args or {}
        if command in ('on', 'off'):
            self.enabled = command == 'on'
        if command == 'select':
            self.selection = args['id']
        servers = [{'id': 'demo-1', 'name': 'DEMO · основной', 'kind': 'trojan', 'host': 'example.org', 'port': 443, 'healthy': True, 'delay_ms': 28},
                   {'id': 'demo-2', 'name': 'DEMO · резерв', 'kind': 'socks', 'host': 'example.net', 'port': 1080, 'healthy': True, 'delay_ms': 64}]
        return {'state': 'RUNNING' if self.enabled else 'OFF', 'enabled': self.enabled,
            'selection': self.selection, 'selected': 'demo-1' if self.selection == 'auto' else self.selection,
            'servers': servers, 'subscriptions': [], 'events': [], 'stale': False,
            'rx_rate': (1 + math.sin(time.monotonic())) * 500000 if self.enabled else 0,
            'tx_rate': 48000 if self.enabled else 0, 'rx_bytes': 30000000, 'tx_bytes': 2000000,
            'connections': 8 if self.enabled else 0, 'busy': '', 'memory_bytes': 34000000,
            'snapshot_at': time.monotonic()}


class UI:
    def __init__(self, screen: Any, rpc: Any, demo: bool=False) -> None:
        self.screen, self.rpc, self.demo = screen, rpc, demo
        self.version = (Path(__file__).resolve().parents[2] / 'VERSION').read_text().strip()
        self.page, self.row, self.message = 0, 0, ''
        self.data, self.polling, self.acting = {}, False, 0
        self.results, self.rx, self.tx = queue.Queue(), deque(maxlen=80), deque(maxlen=80)
        self.buttons, self.last_poll = [], 0
        base = Path.home() / ('Library/Application Support/TUI_VPN' if os.uname().sysname == 'Darwin' else '.config/tui-vpn')
        self.preferences = None if demo else base / 'ui.json'
        self.theme = 'ocean' if demo else read_json(self.preferences, {'theme': 'ocean'}).get('theme', 'ocean')
        screen.timeout(150)
        screen.keypad(True)
        curses.curs_set(0)
        curses.mousemask(curses.ALL_MOUSE_EVENTS)
        self.colors()

    def colors(self) -> None:
        curses.start_color()
        curses.use_default_colors()
        if curses.COLORS >= 8:
            background = curses.COLOR_WHITE if self.theme == 'light' else curses.COLOR_BLACK
            base = curses.COLOR_BLACK if self.theme == 'light' else curses.COLOR_WHITE
            palette = {1: curses.COLOR_CYAN, 2: curses.COLOR_GREEN, 3: curses.COLOR_RED, 4: base}
            if self.theme == 'light':
                palette.update({1: curses.COLOR_BLUE, 2: curses.COLOR_BLUE})
            for number, foreground in palette.items():
                curses.init_pair(number, -1 if self.theme == 'mono' else foreground,
                                 -1 if self.theme == 'mono' else background)
            self.screen.bkgd(' ', curses.color_pair(4))

    def put(self, y: int, x: int, text: Any, style: int=0) -> None:
        height, width = self.screen.getmaxyx()
        if 0 <= y < height and 0 <= x < width - 1:
            try:
                self.screen.addstr(y, x, clipped(text, width - x - 1), style)
            except curses.error:
                pass

    def button(self, y: int, x: int, text: Any, action: str) -> None:
        self.put(y, x, text, curses.A_REVERSE)
        self.buttons.append((y, x, x + len(text), action))

    def async_call(self, command: str, args: Any=None, poll: bool=False) -> None:
        if poll and self.polling or not poll and self.acting and command != 'off':
            return
        self.polling = True if poll else self.polling
        self.acting += 0 if poll else 1
        def worker() -> None:
            try:
                value = self.rpc(command, args)
                self.results.put((poll, value, ''))
            except Exception as error:
                message = str(error) if isinstance(error, AppError) else 'Служба недоступна. Проверьте установку и права пользователя.'
                self.results.put((poll, None, message))
        threading.Thread(target=worker, daemon=True).start()

    def collect(self) -> None:
        while not self.results.empty():
            poll, value, error = self.results.get()
            if poll:
                self.polling = False
            else:
                self.acting = max(0, self.acting - 1)
            if error:
                self.message = error
                continue
            if value.get('snapshot_at', 0) < self.data.get('snapshot_at', 0):
                continue
            self.data = value
            if poll:
                self.rx.append(value.get('rx_rate') or 0)
                self.tx.append(value.get('tx_rate') or 0)
            elif value.get('test'):
                self.message = 'Проверка HTTPS и маршрутов: ' + value['test']['ipv4']
            else:
                self.message = 'Команда принята'

    def draw(self) -> None:
        self.screen.erase()
        height, width = self.screen.getmaxyx()
        self.buttons = []
        if width < 76 or height < 22:
            self.put(0, 0, 'Увеличьте терминал до 76×22. Q — выйти.')
            self.screen.refresh()
            return
        accent = 0 if self.theme == 'mono' else curses.color_pair(1) | curses.A_BOLD
        self.put(0, 2, 'TUI VPN ' + self.version + ('  · ДЕМО: трафик синтетический' if self.demo else ''), accent)
        for i, title in enumerate(('1 Обзор', '2 Серверы', '3 Подписки', '4 Журнал')):
            self.button(2, 2 + i * 18, '[' + title + ']', str(i + 1))
        phase = STATES.get(self.data.get('state'), 'ОЖИДАНИЕ СЛУЖБЫ')
        self.put(4, 2, phase + (' · данные устарели' if self.data.get('stale') else ''), accent)
        self.put(5, 2, 'Режим: ' + ('автоматический' if self.data.get('selection') == 'auto' else 'ручной · A вернёт автопереключение'))
        render = (self.overview, self.servers, self.subscriptions, self.events)[self.page]
        render(height, width)
        self.put(height - 3, 2, 'Выполняется операция…' if self.acting else self.message, curses.color_pair(3))
        self.button(height - 1, 1, '[Space Вкл/Выкл]', ' ')
        self.button(height - 1, 19, '[A Авто]', 'a')
        self.button(height - 1, 30, '[R Обновить]' if self.page == 2 else '[R Проверка]', 'r')
        self.put(height - 1, 46, 'T Тема · U Обновления · Q Выход')
        self.screen.refresh()

    def overview(self, height: int, width: int) -> None:
        self.put(7, 2, '↓ ВХОДЯЩИЙ    ' + human(self.data.get('rx_rate'), True), curses.color_pair(2))
        self.put(8, 2, spark(self.rx, width - 5))
        self.put(10, 2, '↑ ИСХОДЯЩИЙ   ' + human(self.data.get('tx_rate'), True), curses.color_pair(1))
        self.put(11, 2, spark(self.tx, width - 5))
        self.put(13, 2, 'Сеанс: ↓ ' + human(self.data.get('rx_bytes')) + '   ↑ ' + human(self.data.get('tx_bytes')))
        self.put(14, 2, 'Соединений: %s   Серверов: %s' % (self.data.get('connections', '—'), len(self.data.get('servers', []))))
        self.put(15, 2, 'RAM ядра: ' + human(self.data.get('memory_bytes')))
        selected = next((s['name'] for s in self.data.get('servers', []) if s['id'] == self.data.get('selected')), '—')
        self.put(16, 2, 'Текущий сервер: ' + selected)
        self.put(18, 2, 'Q закрывает интерфейс. VPN продолжает работать до ручного выключения.')

    def listing(self, entries: Any, height: int, formatter: Any) -> None:
        self.row = min(self.row, max(0, len(entries) - 1))
        start = max(0, self.row - (height - 13) // 2)
        for offset, entry in enumerate(entries[start:start + height - 12]):
            index = start + offset
            self.put(8 + offset, 2, formatter(entry), curses.A_REVERSE if index == self.row else 0)
        if not entries:
            self.put(9, 2, 'Список пуст. Добавьте собственную подписку или профиль.')

    def servers(self, height: int, width: int) -> Any:
        self.put(7, 2, 'Enter — выбрать вручную; A — автоматический выбор')
        def line(server: Any) -> Any:
            mark = '●' if server['id'] == self.data.get('selected') else '·'
            delay = str(server.get('delay_ms')) + ' мс' if server.get('healthy') else 'нет свежей проверки'
            return '%s %s  %s  %s' % (mark, server['name'], server['kind'], delay)
        self.listing(self.data.get('servers', []), height, line)

    def subscriptions(self, height: int, width: int) -> None:
        self.put(6, 2, 'N URL · I URI · W WireGuard · L Импорт BigSurVPN')
        self.put(7, 2, 'E Изменить ссылку · R Обновить · D Удалить')
        self.listing(self.data.get('subscriptions', []), height,
                     lambda s: '%s · %s · серверов %s' % (s['name'], s['host'], s['servers']))

    def events(self, height: int, width: int) -> None:
        values = self.data.get('events', [])[-(height - 12):]
        for index, event in enumerate(values):
            self.put(8 + index, 2, time.strftime('%H:%M:%S', time.localtime(event['at'])) + '  ' + event['message'])

    def prompt(self, label: str, secret: bool=True) -> str:
        value = ''
        while True:
            height, width = self.screen.getmaxyx()
            self.put(height - 5, 1, ' ' * (width - 2))
            self.put(height - 5, 1, label + ' (Enter — принять, Esc — отменить)')
            self.put(height - 4, 1, ' ' * (width - 2))
            self.put(height - 4, 1, ('•' * len(value) if secret else value)[-(width - 4):])
            self.screen.refresh()
            try:
                key = self.screen.get_wch()
            except curses.error:
                continue
            if key in ('\n', '\r'):
                return value
            if key == '\x1b':
                return ''
            if key in (curses.KEY_BACKSPACE, '\x7f', '\b'):
                value = value[:-1]
            elif key == '\x15':
                value = ''
            elif isinstance(key, str) and key.isprintable() and len(value) < 8192:
                value += key

    def subscription_action(self, key: Any) -> None:
        values = self.data.get('subscriptions', [])
        selected = values[self.row] if self.row < len(values) else None
        if key in ('n', 'i', 'w'):
            self.profile_input(key)
        elif key == 'l':
            self.async_call('import_existing')
        elif key == 'e' and selected:
            value = self.prompt('Новая HTTPS-ссылка выбранной подписки')
            if value:
                self.async_call('subscription_edit', {'id': selected['id'], 'url': value})
        elif key == 'r' and selected:
            self.async_call('subscription_refresh', {'id': selected['id']})
        elif key == 'd' and selected and self.prompt('Удалить подписку? Введите ДА', False).upper() == 'ДА':
            self.async_call('subscription_delete', {'id': selected['id']})

    def profile_input(self, key: Any) -> None:
        prompts = {'n': 'HTTPS-ссылка подписки', 'i': 'VLESS / Trojan / SOCKS5 URI',
                   'w': 'Путь к собственному WireGuard .conf'}
        value = self.prompt(prompts[key], secret=key != 'w')
        if not value:
            return
        if key == 'w':
            value = read_bytes(Path(value).expanduser(), 65536).decode('utf-8-sig')
        command, field = {'n': ('subscription_add', 'url'), 'i': ('uri_add', 'uri'),
                          'w': ('wireguard_add', 'text')}[key]
        self.async_call(command, {field: value})

    def change_theme(self) -> None:
        self.theme = THEMES[(THEMES.index(self.theme) + 1) % len(THEMES)] if self.theme in THEMES else 'ocean'
        if self.preferences is not None:
            private_directory(self.preferences.parent)
            write_json(self.preferences, {'theme': self.theme})
        self.colors()

    def update(self) -> None:
        from .updates import interactive_update
        curses.endwin()
        try:
            if interactive_update():
                launcher = str(Paths().launcher)
                os.execv(launcher, [launcher])
        finally:
            self.screen.refresh()

    def enter_server(self) -> None:
        values = self.data.get('servers', [])
        if self.page == 1 and self.row < len(values):
            self.async_call('select', {'id': values[self.row]['id']})

    def refresh(self) -> None:
        if self.page == 2:
            self.subscription_action('r')
        else:
            self.async_call('test')

    def key(self, key: Any) -> None:
        height, width = self.screen.getmaxyx()
        if height < 22 or width < 76:
            return
        if key == curses.KEY_MOUSE:
            _id, x, y, _z, _state = curses.getmouse()
            key = next((action for row, left, right, action in self.buttons if row == y and left <= x < right), None)
        if key in ('1', '2', '3', '4'):
            self.page, self.row = int(key) - 1, 0
        elif key == curses.KEY_UP:
            self.row = max(0, self.row - 1)
        elif key == curses.KEY_DOWN:
            self.row += 1
        else:
            self.action(key.lower() if isinstance(key, str) else key)

    def action(self, key: Any) -> None:
        actions = {' ': lambda: self.async_call('off' if self.data.get('enabled') else 'on'),
                   'a': lambda: self.async_call('select', {'id': 'auto'}),
                   't': self.change_theme, 'u': self.update, 'r': self.refresh,
                   '\n': self.enter_server, '\r': self.enter_server}
        if key in actions:
            actions[key]()
        elif self.page == 2 and key in ('n', 'i', 'w', 'l', 'd', 'e'):
            self.subscription_action(key)

    def run(self) -> None:
        while True:
            if time.monotonic() - self.last_poll >= 1:
                self.async_call('status', poll=True)
                self.last_poll = time.monotonic()
            self.collect()
            self.draw()
            try:
                key = self.screen.get_wch()
            except curses.error:
                continue
            if key in ('q', 'Q'):
                return
            try:
                self.key(key)
            except Exception as error:
                self.message = str(error) if isinstance(error, AppError) else 'Операция не выполнена.'


def main(demo: bool=False) -> None:
    set_locale()
    rpc = Demo() if demo else request
    curses.wrapper(lambda screen: UI(screen, rpc, demo).run())


def set_locale() -> None:
    for candidate in ('', 'C.UTF-8', 'en_US.UTF-8', 'ru_RU.UTF-8'):
        try:
            locale.setlocale(locale.LC_ALL, candidate)
            if 'utf' in locale.getpreferredencoding(False).lower():
                return
        except locale.Error:
            continue
    raise AppError('Для интерфейса нужна локаль UTF-8.')
