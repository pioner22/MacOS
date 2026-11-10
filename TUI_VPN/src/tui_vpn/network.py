"""HTTPS feed worker. Parent kills the entire worker on a bounded timeout."""
from __future__ import annotations
from typing import Any
import ipaddress
import json
import socket
import ssl
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener, HTTPSHandler, Request
from .common import AppError


def validate_url(url: str) -> str:
    if not isinstance(url, str) or len(url) > 8192 or any(ord(c) < 33 for c in url):
        raise AppError('Неверная ссылка подписки.')
    parsed = urlsplit(url)
    validate_authority(parsed)
    for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM):
        if not ipaddress.ip_address(item[4][0]).is_global:
            raise AppError('Локальные и служебные адреса подписки запрещены.')
    return url


def validate_authority(parsed: Any) -> None:
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise AppError('Нужна HTTPS-ссылка без URL credentials и фрагмента.')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise AppError('Неверный порт HTTPS.')


class SafeRedirect(HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, req: Any, fp: Any, code: Any, msg: Any, headers: Any, newurl: Any) -> Any:
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def context() -> ssl.SSLContext:
    cafile = '/etc/ssl/cert.pem' if sys.platform == 'darwin' else '/etc/ssl/certs/ca-certificates.crt'
    return ssl.create_default_context(cafile=cafile if Path(cafile).is_file() else None)


def fetch_https(url: str, limit: int=2097152) -> bytes:
    validate_url(url)
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=context()), SafeRedirect())
    with opener.open(Request(url, headers={'User-Agent': 'TUI_VPN/0.1.0'}), timeout=12) as response:
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise AppError('Ответ сервера слишком большой.')
        return raw


def fetch_worker(root: Any, url: str, timeout: int=20) -> bytes:
    result = subprocess.run([sys.executable, '-I', '-B', str(Path(root) / 'src/entry.py'), '_fetch'],
        input=json.dumps({'url': url}).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=timeout, check=False)
    if result.returncode or not result.stdout:
        raise AppError('Подписка не получена. Проверьте HTTPS-ссылку и доступность сервера.')
    if len(result.stdout) > 2097152:
        raise AppError('Подписка слишком большая.')
    return result.stdout
