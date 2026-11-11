"""Keyboard and mouse forms; secret fields are never drawn as plain text."""
from __future__ import annotations

import curses
from typing import Any, Callable

from .common import AppError


def field(key: str, label: str, secret: bool = False, limit: int = 255) -> dict:
    return {'key': key, 'label': label, 'secret': secret, 'limit': limit}


class Form:
    def __init__(self, ui: Any, title: str, fields: list, initial: dict | None = None,
                 hint: str = '', validate: Callable | None = None) -> None:
        self.ui, self.title, self.fields = ui, title, fields
        self.values = {f['key']: str((initial or {}).get(f['key'], '')) for f in fields}
        self.focus, self.cursor, self.error = 0, 0, ''
        self.hint, self.validate = hint, validate
        self.hits: list = []
        self.cursor = len(self.values[fields[0]['key']])

    def move(self, delta: int) -> None:
        self.focus = (self.focus + delta) % (len(self.fields) + 2)
        if self.focus < len(self.fields):
            self.cursor = len(self.values[self.fields[self.focus]['key']])

    def draw(self) -> bool:
        from .ui import clipped
        self.ui.draw()
        height, width = self.ui.screen.getmaxyx()
        box_h, box_w = len(self.fields) * 2 + 8, min(86, width - 4)
        if width < 54 or height < box_h + 2:
            self.ui.put(1, 1, 'Увеличьте терминал. Esc — отмена; введённые поля сохранены.')
            self.ui.screen.refresh()
            return False
        top, left = (height - box_h) // 2, (width - box_w) // 2
        for y in range(top, top + box_h):
            self.ui.put(y, left, ' ' * box_w)
        self.ui.put(top + box_h - 1, left, '+' + '-' * (box_w - 2) + '+')
        self.ui.put(top, left, '+' + '-' * (box_w - 2) + '+')
        self.ui.put(top + 1, left + 2, self.title, curses.A_BOLD)
        self.hits = []
        for index, info in enumerate(self.fields):
            y = top + 3 + index * 2
            self.ui.put(y, left + 2, clipped(info['label'], 15))
            value = self.values[info['key']]
            visible = '*' * len(value) if info['secret'] else value
            start = max(0, self.cursor - (box_w - 23)) if index == self.focus else 0
            self.ui.put(y, left + 19, clipped(' ' + visible[start:], box_w - 21).ljust(box_w - 21),
                        curses.A_REVERSE if index == self.focus else curses.A_UNDERLINE)
            self.hits.append((y, left + 19, left + box_w - 2, index))
        y = top + box_h - 4
        self.ui.put(y, left + 2, clipped(self.error or self.hint, box_w - 4))
        self.ui.put(y + 1, left + 2, 'Tab / ↑↓ — поле · Ctrl+U — очистить · Esc — отменить')
        for index, (offset, label) in enumerate(((2, '[ Сохранить ]'), (21, '[ Отмена ]'))):
            focus = len(self.fields) + index
            self.ui.put(y + 2, left + offset, label,
                        curses.A_REVERSE if self.focus == focus else curses.A_BOLD)
            self.hits.append((y + 2, left + offset, left + offset + len(label) - 1, focus))
        self.ui.screen.refresh()
        return True

    def save(self) -> dict | None:
        try:
            values = dict(self.values)
            if self.validate:
                self.validate(values)
            return values
        except AppError as error:
            self.error = str(error)
            return None

    def edit(self, key: Any) -> None:
        if self.focus >= len(self.fields):
            return
        info = self.fields[self.focus]
        value = self.values[info['key']]
        if key == curses.KEY_LEFT:
            self.cursor = max(0, self.cursor - 1)
        elif key == curses.KEY_RIGHT:
            self.cursor = min(len(value), self.cursor + 1)
        elif key == curses.KEY_HOME:
            self.cursor = 0
        elif key == curses.KEY_END:
            self.cursor = len(value)
        elif key in (curses.KEY_BACKSPACE, '\x7f', '\b') and self.cursor:
            value = value[:self.cursor - 1] + value[self.cursor:]
            self.cursor -= 1
        elif key == curses.KEY_DC:
            value = value[:self.cursor] + value[self.cursor + 1:]
        elif key == '\x15':
            value, self.cursor = '', 0
        elif printable(key, value, info['limit']):
            value = value[:self.cursor] + key + value[self.cursor:]
            self.cursor += 1
        self.values[info['key']] = value

    def mouse(self) -> bool:
        try:
            _identity, x, y, _z, state = curses.getmouse()
        except curses.error:
            return False
        if not state & (curses.BUTTON1_CLICKED | curses.BUTTON1_RELEASED | curses.BUTTON1_DOUBLE_CLICKED):
            return False
        for row, left, right, index in self.hits:
            if y == row and left <= x <= right:
                self.focus = index
                if index < len(self.fields):
                    self.cursor = len(self.values[self.fields[index]['key']])
                return index >= len(self.fields)
        return False

    def run(self) -> dict | None:
        while True:
            ready = self.draw()
            try:
                key = self.ui.screen.get_wch()
            except curses.error:
                continue
            if key == '\x1b':
                return None
            if not ready or key == curses.KEY_RESIZE:
                continue
            done, result = self.key(key)
            if done:
                return result

    def key(self, key: Any) -> tuple:
        clicked = key == curses.KEY_MOUSE and self.mouse()
        if key in ('\n', '\r', curses.KEY_ENTER) or clicked:
            return self.activate()
        if key in ('\t', curses.KEY_DOWN):
            self.move(1)
        elif key in (curses.KEY_BTAB, curses.KEY_UP):
            self.move(-1)
        else:
            self.edit(key)
        return False, None

    def activate(self) -> tuple:
        if self.focus == len(self.fields) + 1:
            return True, None
        if self.focus >= len(self.fields) - 1:
            result = self.save()
            return result is not None, result
        self.move(1)
        return False, None


def printable(key: Any, value: str, limit: int) -> bool:
    return isinstance(key, str) and key.isprintable() and len(value) < limit
