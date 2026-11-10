"""User-initiated native package update from one pinned GitHub commit."""
from __future__ import annotations
from typing import Any
import datetime
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from .common import AppError, Paths, load_settings
from .network import fetch_worker

ROOT = Path(__file__).resolve().parents[2]


def version(value: Any) -> tuple:
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', value):
        raise AppError('Неизвестный формат версии.')
    return tuple(int(n) for n in value.split('.'))


def check_update(root: Any=ROOT) -> Any:
    settings = load_settings(root)
    repository = settings['repository']
    if repository != 'pioner22/MacOS':
        raise AppError('Издатель обновления не совпал.')
    commit = json.loads(fetch_worker(root, 'https://api.github.com/repos/' + repository + '/commits/main'))['sha']
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise AppError('Неверная ревизия обновления.')
    prefix = 'https://raw.githubusercontent.com/' + repository + '/' + commit + '/'
    release = json.loads(fetch_worker(root, prefix + settings['release_path']))
    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    if release.get('schema') != 'tui-vpn.release.v1' or not release.get('published_at', 0) <= now <= release.get('expires_at', 0):
        raise AppError('Метаданные обновления отсутствуют или устарели. Проверьте страницу проекта.')
    current = (Path(root) / 'VERSION').read_text().strip()
    if version(release['version']) <= version(current):
        return None
    platform = 'darwin' if sys.platform == 'darwin' else 'linux'
    artifact = next((a for a in release['artifacts'] if a['platform'] == platform), None)
    if not artifact or not re.fullmatch(r'[A-Za-z0-9_.-]+\.(pkg|deb)', artifact['name']):
        raise AppError('Для этой системы нет установщика обновления.')
    expected_name = ('TUI_VPN-' + release['version'] + '-macos-intel.pkg') if platform == 'darwin' else ('tui-vpn_' + release['version'] + '_all.deb')
    if artifact['name'] != expected_name:
        raise AppError('Имя пакета не соответствует версии TUI VPN.')
    return dict(artifact, url=prefix + 'TUI_VPN/dist/' + artifact['name'], version=release['version'])


def interactive_update() -> bool:
    print('Проверяю обновление TUI VPN…')
    update = check_update()
    if update is None:
        print('Установлена актуальная версия.')
        input('Enter — вернуться')
        return False
    print('Доступна версия %s. Обновление программы сохраняет подписки и ручное выключение.' % update['version'])
    if input('Открыть системный установщик? [д/Н] ').lower() not in ('д', 'да', 'y', 'yes'):
        return False
    with tempfile.TemporaryDirectory(prefix='tui-vpn-update-') as temporary:
        data = fetch_worker(ROOT, update['url'])
        if len(data) != update['bytes'] or hashlib.sha256(data).hexdigest() != update['sha256']:
            raise AppError('Контрольная сумма установщика не совпала.')
        path = Path(temporary) / update['name']
        path.write_bytes(data)
        path.chmod(0o600)
        if sys.platform == 'darwin':
            result = subprocess.run(['/usr/bin/open', '-W', str(path)], check=False)
        else:
            result = subprocess.run(['/usr/bin/sudo', '/usr/bin/apt-get', 'install', '--reinstall', '-y', str(path)], check=False)
        if result.returncode:
            raise AppError('Системный установщик не завершил обновление.')
        installed = Paths().current / 'app/VERSION'
        if not installed.is_file() or installed.read_text().strip() != update['version']:
            raise AppError('Установка не подтверждена: возможно, системное окно было отменено.')
    print('Проверьте состояние VPN после завершения установки.')
    input('Enter — вернуться')
    return True
