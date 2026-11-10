"""Owner-only Unix socket, native peer identity, bounded JSON, no shell RPC."""
from __future__ import annotations
from typing import Any
import ctypes
import json
import os
import socket
import socketserver
import struct
import sys
import threading
from .common import AppError, Paths

REQUEST_LIMIT = 131072
RESPONSE_LIMIT = 1048576


def peer_uid(connection: Any) -> int:
    if sys.platform == 'darwin':
        libc = ctypes.CDLL(None, use_errno=True)
        function = libc.getpeereid
        function.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
        function.restype = ctypes.c_int
        uid, gid = ctypes.c_uint(), ctypes.c_uint()
        if function(connection.fileno(), ctypes.byref(uid), ctypes.byref(gid)):
            raise AppError('Не удалось проверить владельца соединения.')
        return uid.value
    return struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[1]


def receive(connection: Any, limit: int) -> dict:
    data = bytearray()
    while len(data) <= limit:
        block = connection.recv(min(65536, limit + 1 - len(data)))
        if not block:
            raise AppError('Соединение прервано.')
        data.extend(block)
        if b'\n' in block:
            line, _, extra = bytes(data).partition(b'\n')
            if extra or len(line) > limit:
                raise AppError('Неверный размер сообщения.')
            return json.loads(line.decode('utf-8'))
    raise AppError('Сообщение слишком большое.')


def send(connection: Any, value: Any) -> None:
    raw = json.dumps(value, ensure_ascii=True).encode() + b'\n'
    if len(raw) > RESPONSE_LIMIT:
        raise AppError('Ответ слишком большой.')
    connection.sendall(raw)


def request(command: str, args: Any=None, paths: Any=None, timeout: int=30) -> dict:
    paths = paths or Paths()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(timeout)
            connection.connect(str(paths.socket))
            send(connection, {'command': command, 'args': args or {}})
            value = receive(connection, RESPONSE_LIMIT)
    except (OSError, ValueError):
        raise AppError('Служба недоступна или отказала в доступе.')
    if not value.get('ok'):
        raise AppError(value.get('error', 'Операция не выполнена.'))
    return value['result']


class Handler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        self.request.settimeout(30)
        try:
            if peer_uid(self.request) not in (0, self.server.owner_uid):
                raise AppError('У этого пользователя нет доступа к VPN.')
            value = receive(self.request, REQUEST_LIMIT)
            if not isinstance(value, dict) or set(value) != {'command', 'args'}:
                raise AppError('Неверный запрос управления.')
            result = self.server.manager.dispatch(value['command'], value['args'])
            self.reply({'ok': True, 'result': result})
        except AppError as error:
            self.reply({'ok': False, 'error': str(error)})
        except Exception:
            self.reply({'ok': False, 'error': 'Операция не выполнена; подробности и секреты скрыты.'})

    def reply(self, value: dict) -> None:
        try:
            send(self.request, value)
        except (OSError, AppError):
            pass


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, paths: Any, owner_uid: int, manager: Any) -> None:
        self.owner_uid, self.manager = owner_uid, manager
        self.slots = threading.BoundedSemaphore(8)
        paths.run.mkdir(mode=0o755, parents=True, exist_ok=True)
        if os.path.lexists(str(paths.socket)):
            raise AppError('Сокет управления уже занят. Проверьте другую службу.')
        super().__init__(str(paths.socket), Handler)
        os.chmod(paths.socket, 0o600)
        if os.geteuid() == 0:
            os.chown(paths.socket, owner_uid, -1)

    def process_request(self, connection: Any, address: Any) -> None:
        if not self.slots.acquire(blocking=False):
            connection.close()
            return
        try:
            super().process_request(connection, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, connection: Any, address: Any) -> None:
        try:
            super().process_request_thread(connection, address)
        finally:
            self.slots.release()
