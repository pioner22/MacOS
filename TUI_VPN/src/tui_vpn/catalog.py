"""Private persistent state, never embedded in an application release."""
from __future__ import annotations
from typing import Any, Iterator
import copy
import uuid
import os
import re
import json
import sqlite3
import stat
import tempfile
from contextlib import contextmanager, closing
from urllib.parse import urlsplit
from .common import AppError, private_directory, clean
from .profiles import assign_ids, validate_outbound, no_files

MAX_DOCUMENT_BYTES = 4194304


class Catalog:
    def __init__(self, paths: Any) -> None:
        self.path = paths.private / 'catalog.sqlite3'
        private_directory(paths.private)
        self._initialize()
        with self.connection() as database:
            self.data = self._document(database, 'catalog')
            self.state = self._document(database, 'state')
        if self.data.get('schema') != 1 or self.state.get('schema') != 1 or type(self.state.get('enabled')) is not bool:
            raise AppError('Неизвестная версия данных; автоматическое включение запрещено.')
        if not isinstance(self.data.get('subscriptions'), list):
            raise AppError('Повреждён каталог подписок.')
        validate_catalog(self.data)
        if self.state.get('selection') not in {'auto'} | {n['id'] for n in self.nodes()}:
            raise AppError('Повреждено сохранённое состояние выбора сервера.')
        self.revision = 0

    def _initialize(self) -> None:
        if not os.path.lexists(str(self.path)):
            self._create_database()
        info = self.path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > 16777216:
            raise AppError('Небезопасный файл закрытой базы данных.')
        with self.connection() as database:
            if database.execute('PRAGMA user_version').fetchone()[0] != 1:
                raise AppError('Неизвестная версия базы. Данные не заменены.')

    def _create_database(self) -> None:
        descriptor, temporary = tempfile.mkstemp(prefix='.catalog-initial-', dir=str(self.path.parent))
        os.close(descriptor)
        try:
            with closing(sqlite3.connect(temporary, timeout=5)) as database, database:
                database.execute('CREATE TABLE documents (name TEXT PRIMARY KEY, value TEXT NOT NULL)')
                values = {'catalog': {'schema': 1, 'subscriptions': []},
                          'state': {'schema': 1, 'enabled': False, 'selection': 'auto'},
                          'previous_catalog': {'schema': 1, 'subscriptions': []}}
                database.executemany('INSERT INTO documents VALUES (?, ?)',
                                     [(name, json.dumps(value)) for name, value in values.items()])
                database.execute('PRAGMA user_version=1')
            try:
                os.link(temporary, self.path)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        database = sqlite3.connect(str(self.path), timeout=5)
        database.execute('PRAGMA trusted_schema=OFF')
        database.execute('PRAGMA secure_delete=ON')
        database.execute('PRAGMA max_page_count=4096')
        try:
            with database:
                yield database
        finally:
            database.close()

    @staticmethod
    def _document(database, name: str) -> dict:
        row = database.execute('SELECT value FROM documents WHERE name=?', (name,)).fetchone()
        if row is None or len(row[0]) > MAX_DOCUMENT_BYTES:
            raise AppError('Повреждён документ базы данных.')
        return json.loads(row[0])

    @staticmethod
    def _save(database, name: str, value: dict) -> None:
        database.execute('UPDATE documents SET value=? WHERE name=?', (json.dumps(value, ensure_ascii=True), name))

    def nodes(self) -> list:
        return [node for item in self.data['subscriptions'] for node in item['nodes']]

    def enable(self, value: Any) -> None:
        state = dict(self.state, enabled=bool(value))
        with self.connection() as database:
            self._save(database, 'state', state)
        self.state = state

    def select(self, node_id: str) -> None:
        if node_id != 'auto' and node_id not in {n['id'] for n in self.nodes()}:
            raise AppError('Сервер не найден.')
        state = dict(self.state, selection=node_id)
        with self.connection() as database:
            self._save(database, 'state', state)
        self.state = state

    def candidate(self, nodes: list, label: str, url: str='', existing_id: str='') -> dict:
        existing_id = existing_id or self.source_for_url(url)
        value = copy.deepcopy(self.data)
        old = next((s for s in value['subscriptions'] if s['id'] == existing_id), None)
        if existing_id and old is None:
            raise AppError('Подписка не найдена.')
        if old is None:
            if len(value['subscriptions']) >= 20:
                raise AppError('Допускается не более 20 подписок.')
            old = {'id': uuid.uuid4().hex, 'name': clean(label or urlsplit(url).hostname or 'Локальный профиль')}
            value['subscriptions'].append(old)
        old.update(name=clean(label or old['name']), url=url,
                   nodes=stable_nodes(nodes, old['id'], old.get('nodes', [])))
        if not 1 <= sum(len(s['nodes']) for s in value['subscriptions']) <= 200:
            raise AppError('Допускается от 1 до 200 серверов.')
        return value

    def source_for_url(self, url: str) -> str:
        if not url:
            return ''
        return next((item['id'] for item in self.data['subscriptions']
                     if item.get('url') == url), '')

    def commit(self, value: Any) -> None:
        validate_catalog(value)
        nodes = [n for s in value['subscriptions'] for n in s['nodes']]
        state = dict(self.state)
        if state['selection'] not in {'auto'} | {n['id'] for n in nodes}:
            state['selection'] = 'auto'
        if not nodes:
            state['enabled'] = False
        with self.connection() as database:
            self._save(database, 'previous_catalog', self.data)
            self._save(database, 'catalog', value)
            self._save(database, 'state', state)
        self.data = value
        self.state = state
        self.revision += 1

    def public_subscriptions(self) -> list:
        return [{'id': s['id'], 'name': s['name'], 'servers': len(s['nodes']),
                 'host': clean(urlsplit(s.get('url', '')).hostname or 'локально'),
                 'remote': bool(s.get('url'))} for s in self.data['subscriptions']]


def matching_node(node: dict, previous: list) -> dict | None:
    candidates = [old for old in previous if old.get('outbound') == node.get('outbound')
                  and old.get('endpoint') == node.get('endpoint')]
    return next((old for old in candidates if old['name'] == node['name']),
                candidates[0] if candidates else None)


def stable_nodes(nodes: list, source_id: str, previous: list) -> list:
    values, remaining = assign_ids(nodes, source_id), list(previous)
    reserved, used = {old['id'] for old in previous}, set()
    for node in values:
        old = matching_node(node, remaining)
        if old is not None:
            node['id'] = old['id']
            remaining.remove(old)
        elif node['id'] in reserved or node['id'] in used:
            node['id'] = 'n-' + uuid.uuid4().hex[:16]
        used.add(node['id'])
    return values


def validate_catalog(data: dict) -> None:
    if len(json.dumps(data, ensure_ascii=True)) > MAX_DOCUMENT_BYTES:
        raise AppError('Суммарный размер подписок слишком большой. Прежние данные сохранены.')
    subscriptions = data['subscriptions']
    if len(subscriptions) > 20:
        raise AppError('Слишком много сохранённых подписок.')
    ids = set()
    for subscription in subscriptions:
        if not isinstance(subscription, dict) or not re.fullmatch('[a-f0-9]{32}', subscription.get('id', '')):
            raise AppError('Повреждено описание подписки.')
        if not isinstance(subscription.get('nodes'), list) or not isinstance(subscription.get('name'), str):
            raise AppError('Повреждён список серверов.')
        for node in subscription['nodes']:
            validate_node(node)
            if node['id'] in ids:
                raise AppError('Повторный идентификатор сервера.')
            ids.add(node['id'])
    if len(ids) > 200:
        raise AppError('Слишком много сохранённых серверов.')


def validate_node(node: dict) -> None:
    if not isinstance(node, dict) or not re.fullmatch('n-[a-f0-9]{16}', node.get('id', '')):
        raise AppError('Повреждено описание сервера.')
    if not isinstance(node.get('name'), str) or ('outbound' in node) == ('endpoint' in node):
        raise AppError('Неизвестная структура сервера.')
    if 'outbound' in node:
        validate_outbound(node['outbound'])
    else:
        value = node['endpoint']
        no_files(value)
        if value.get('type') != 'wireguard' or value.get('system') is not False:
            raise AppError('Нужен userspace WireGuard; системный endpoint не допускается.')
