"""Native package transaction: immutable releases, data outside releases, exact rollback."""
from __future__ import annotations
from typing import Any
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from .common import AppError, Paths, atomic, digest, read_bytes, read_json, read_private_json, write_json, verify_source, load_settings, private_directory, owner_lock
from .catalog import Catalog
from .engine import Engine
from .darwin_services import start_darwin, stop_darwin
from .service_readiness import installation_ready


def python_path(paths: Any, release: Any=None) -> Path:
    return (Path(release or paths.current) / 'python/bin/python3') if paths.system == 'darwin' else Path('/usr/bin/python3')


def launcher(paths: Any) -> bytes:
    executable = str(python_path(paths))
    entry = str(paths.current / 'app/src/entry.py')
    return ('#!/bin/sh\n# TUI_VPN managed launcher; no elevation for normal controls.\n'
            'exec "' + executable + '" -I -B "' + entry + '" "$@"\n').encode()


def system_files(paths: Any) -> dict:
    shortcut = ('#!/bin/sh\nexec "' + str(paths.launcher) + '"\n').encode()
    if paths.system == 'linux':
        shortcut = ('[Desktop Entry]\nType=Application\nName=TUI VPN\nTerminal=true\n'
                    'Exec=' + str(paths.launcher) + '\nIcon=network-vpn\nCategories=Network;\n').encode()
    return {'launcher': (paths.launcher, launcher(paths), 0o755),
            'unit': (paths.unit, unit(paths), 0o644),
            'shortcut': (paths.shortcut, shortcut, 0o755 if paths.system == 'darwin' else 0o644)}


def unit(paths: Any) -> bytes:
    arguments = [str(python_path(paths)), '-I', '-B', str(paths.current / 'app/src/entry.py'), '_daemon']
    if paths.system == 'darwin':
        return plistlib.dumps({'Label': paths.label, 'ProgramArguments': arguments,
            'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
            'ExitTimeOut': 30, 'Umask': 0o077, 'AbandonProcessGroup': False,
            'WorkingDirectory': str(paths.private),
            'StandardOutPath': str(paths.private / 'daemon.log'),
            'StandardErrorPath': str(paths.private / 'daemon.log'),
            'SoftResourceLimits': {'FileSize': 33554432}, 'HardResourceLimits': {'FileSize': 33554432}})
    command = ' '.join(arguments)
    return ('[Unit]\nDescription=TUI VPN local controller\nAfter=network-online.target\nWants=network-online.target\n'
        '[Service]\nType=simple\nExecStart=' + command + '\nRestart=on-failure\nRestartSec=3\n'
        'TimeoutStopSec=30\nUser=root\nUMask=0077\nRuntimeDirectory=tui-vpn\nRuntimeDirectoryMode=0755\n'
        'NoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\n'
        'ReadWritePaths=/var/lib/tui-vpn /run/tui-vpn\n'
        'CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_CHOWN\n'
        'DevicePolicy=closed\nDeviceAllow=/dev/net/tun rw\n'
        '[Install]\nWantedBy=multi-user.target\n').encode()


class HostServices:
    def __init__(self, paths: Any) -> None:
        self.paths = paths

    def command(self, args: Any, allowed: Any=(0,)) -> subprocess.CompletedProcess:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=35, check=False)
        if result.returncode not in allowed:
            detail = (result.stderr or b'').decode('utf-8', 'replace').strip()[:240]
            raise AppError('Менеджер служб: %s, код %s: %s' %
                           (Path(args[0]).name, result.returncode, detail))
        return result

    def stop(self) -> None:
        if self.paths.system == 'darwin':
            stop_darwin(self)
        elif Path('/run/systemd/system').exists():
            self.command(['/usr/bin/systemctl', 'stop', 'tui-vpn.service'], (0, 5))

    def start(self) -> bool:
        if self.paths.system == 'darwin':
            return start_darwin(self)
        elif Path('/run/systemd/system').exists():
            self.command(['/usr/bin/systemctl', 'daemon-reload'])
            self.command(['/usr/bin/systemctl', 'enable', '--now', 'tui-vpn.service'])
        else:
            return False  # Package extraction in a container is not service activation.
        return True

    def verify(self) -> None:
        from .ipc import request
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            try:
                result = request('status', paths=self.paths, timeout=2)
                expected = read_json(self.paths.current / 'receipt.json')['source_sha256']
                if installation_ready(self.paths, result, expected):
                    return
            except (OSError, AppError):
                pass
            time.sleep(0.3)
        raise AppError('Новая служба не подтвердила управление; выполняется откат.')


def managed_link(path: Any, paths: Any) -> Any:
    if not os.path.lexists(str(path)):
        return None
    if not path.is_symlink():
        raise AppError('Путь версии занят неизвестным объектом.')
    result = path.resolve()
    if result.parent != paths.releases.resolve() or not (result / 'receipt.json').is_file():
        raise AppError('Неизвестная установленная версия.')
    return result


def switch(path: Any, target: Any) -> None:
    temporary = path.with_name('.' + path.name + '-next')
    if os.path.lexists(str(temporary)):
        raise AppError('Незавершённое переключение версии требует проверки.')
    temporary.symlink_to(os.path.relpath(str(target.resolve()), str(path.parent.resolve())))
    os.replace(str(temporary), str(path))


def check_preimages(paths: Any, previous: dict) -> None:
    for name, (path, _data, _mode) in system_files(paths).items():
        if os.path.lexists(str(path)):
            if previous.get(name + '_sha256') != digest(path) or path.is_symlink():
                raise AppError('Существующий системный файл изменён; он не будет заменён.')


def public_directory(path: Any) -> None:
    """Give only newly created program directories explicit public traversal."""
    path = Path(path)
    missing, current = [], path
    while not current.exists():
        if current.is_symlink():
            raise AppError('Путь каталога программы занят ссылкой.')
        missing.append(current)
        current = current.parent
    path.mkdir(mode=0o755, parents=True, exist_ok=True)
    for directory in reversed(missing):
        directory.chmod(0o755)


def copy_source(source: Any, target: Any, manifest: dict) -> None:
    public_directory(target)
    for name in list(manifest['files']) + ['manifest.json']:
        destination = target / name
        public_directory(destination.parent)
        atomic(destination, read_bytes(source / name), 0o644)
    verify_source(target)


def prepare_release(source: Any, python_tree: Any, core_file: Any, paths: Any) -> Path:
    manifest = verify_source(source)
    source_sha = digest(source / 'manifest.json')
    version = (source / 'VERSION').read_text().strip()
    import re
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise AppError('Неверная версия приложения.')
    target = paths.releases / (version + '-' + source_sha[:12])
    if target.exists():
        receipt = read_json(target / 'receipt.json')
        if receipt.get('source_sha256') != source_sha or digest(target / 'core/sing-box') != receipt['core_sha256']:
            raise AppError('Каталог версии изменился; повторная установка остановлена.')
        verify_source(target / 'app')
        return target
    stage = Path(tempfile.mkdtemp(prefix='.incoming-', dir=str(paths.releases)))
    try:
        copy_source(source, stage / 'app', manifest)
        if paths.system == 'darwin':
            if not python_tree:
                raise AppError('Не подготовлена закреплённая среда Python.')
            shutil.copytree(python_tree, stage / 'python', symlinks=True)
        public_directory(stage / 'core')
        shutil.copyfile(core_file, stage / 'core/sing-box')
        (stage / 'core/sing-box').chmod(0o755)
        result = subprocess.run([str(stage / 'core/sing-box'), 'version'], capture_output=True, timeout=15)
        if result.returncode or b'sing-box version 1.14.0' not in result.stdout:
            raise AppError('Проверка версии ядра не пройдена.')
        write_json(stage / 'receipt.json', {'schema': 1, 'version': version,
            'source_sha256': source_sha, 'core_sha256': digest(stage / 'core/sing-box')})
        catalog = Catalog(paths)
        nodes = catalog.nodes() or [{'id': 'preflight', 'name': 'preflight', 'outbound': {
            'type': 'trojan', 'server': '127.0.0.1', 'server_port': 9, 'password': 'synthetic-preflight-only',
            'tls': {'enabled': True, 'server_name': 'localhost'}}}]
        Engine(paths, stage / 'app', load_settings(stage / 'app'), stage / 'core/sing-box').check(nodes)
        stage.chmod(0o755)
        os.rename(str(stage), str(target))
        return target
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def initialize(paths: Any) -> None:
    public_directory(paths.base)
    public_directory(paths.releases)
    for directory in (paths.base, paths.releases):
        info = directory.lstat()
        if directory.is_symlink() or info.st_uid != os.geteuid() or info.st_mode & 0o022:
            raise AppError('Небезопасный каталог программы.')
        directory.chmod(0o755)
    private_directory(paths.private)
    Catalog(paths)
    if not (paths.private / 'owner.json').exists():
        write_json(paths.private / 'owner.json', {'schema': 1, 'uid': owner_uid(paths)})
    else:
        read_private_json(paths.private / 'owner.json')


def owner_uid(paths: Any) -> int:
    if paths.system == 'darwin':
        return os.stat('/dev/console').st_uid
    for name in ('SUDO_UID', 'PKEXEC_UID'):
        value = os.environ.get(name, '')
        if value.isdigit() and len(value) <= 10:
            return int(value)
    if Path('/run/systemd/system').exists():
        result = subprocess.run(['/usr/bin/loginctl', 'show-seat', 'seat0', '-p', 'ActiveSession', '--value'],
                                capture_output=True, text=True, timeout=3)
        session = result.stdout.strip()
        if result.returncode == 0 and session.isalnum() and len(session) <= 64:
            user = subprocess.run(['/usr/bin/loginctl', 'show-session', session, '-p', 'User', '--value'],
                                  capture_output=True, text=True, timeout=3)
            if user.returncode == 0 and user.stdout.strip().isdigit():
                return int(user.stdout.strip())
    return 0


def install(source: Any, python_tree: Any, core_file: Any, paths: Any=None, host: Any=None) -> None:
    paths = paths or Paths()
    initialize(paths)
    with owner_lock(paths.private / 'installation.lock'):
        _install(source, python_tree, core_file, paths, host)


def _install(source: Any, python_tree: Any, core_file: Any, paths: Any=None, host: Any=None) -> None:
    paths = paths or Paths()
    host = host or HostServices(paths)
    source = Path(source)
    initialize(paths)
    receipt_path = paths.private / 'install-receipt.json'
    previous = read_private_json(receipt_path, {})
    check_preimages(paths, previous)
    old = managed_link(paths.current, paths)
    old_previous = managed_link(paths.base / 'previous', paths)
    target = prepare_release(source, python_tree, core_file, paths)
    backups = {name: read_bytes(path) if path.exists() else None
               for name, (path, _data, _mode) in system_files(paths).items()}
    context = dict(paths=paths, host=host, previous=previous, old=old, old_previous=old_previous,
                   target=target, backups=backups, stopped=False, attempted_start=False)
    try:
        publish_install(context, receipt_path)
    except BaseException:
        revert_install(context)
        raise
    print('TUI VPN установлен. Запуск: tui-vpn. Существующие подписки и ручное OFF сохранены.')


def publish_install(context: dict, receipt_path: Any) -> None:
    paths, host, old, target = (context[k] for k in ('paths', 'host', 'old', 'target'))
    check_preimages(paths, context['previous'])
    if managed_link(paths.current, paths) != old:
        raise AppError('Текущая версия изменилась перед установкой.')
    if old:
        context['stopped'] = True
        host.stop()
    switch(paths.current, target)
    for path, data, mode in system_files(paths).values():
        public_directory(path.parent)
        atomic(path, data, mode)
    context['attempted_start'] = True
    activated = host.start()
    if activated:
        host.verify()
    if old and old != target:
        switch(paths.base / 'previous', old)
    receipt = {'schema': 1, 'state': 'INSTALLED', 'release': target.name, 'service_activated': activated}
    receipt.update({name + '_sha256': digest(path) for name, (path, _data, _mode) in system_files(paths).items()})
    write_json(receipt_path, receipt)


def revert_install(context: dict) -> None:
    paths, host, old = (context[k] for k in ('paths', 'host', 'old'))
    if context['attempted_start']:
        host.stop()
    restore_files(paths, context['backups'])
    if old:
        switch(paths.current, old)
        if context['old_previous']:
            switch(paths.base / 'previous', context['old_previous'])
        elif (paths.base / 'previous').is_symlink() and (paths.base / 'previous').resolve() == old:
            (paths.base / 'previous').unlink()
        if context['stopped']:
            if host.start():
                host.verify()
    elif paths.current.is_symlink() and paths.current.resolve() == context['target']:
        paths.current.unlink()


def restore_files(paths: Any, backups: dict) -> None:
    import hashlib
    for name, (path, data, mode) in system_files(paths).items():
        if path.exists() and digest(path) not in {hashlib.sha256(data).hexdigest(),
                                                 hashlib.sha256(backups[name] or b'').hexdigest()}:
            raise AppError('Системный файл изменился; чужие данные не будут заменены.')
        if backups[name] is None:
            path.unlink(missing_ok=True)
        else:
            atomic(path, backups[name], mode)


def maintain(action: str, paths: Any=None, host: Any=None) -> None:
    paths = paths or Paths()
    with owner_lock(paths.private / 'installation.lock'):
        _maintain(action, paths, host)


def _maintain(action: str, paths: Any=None, host: Any=None) -> None:
    paths = paths or Paths()
    host = host or HostServices(paths)
    receipt = read_private_json(paths.private / 'install-receipt.json')
    check_preimages(paths, receipt)
    current = managed_link(paths.current, paths)
    if action == 'rollback':
        previous = managed_link(paths.base / 'previous', paths)
        if previous is None:
            raise AppError('Нет предыдущего выпуска для отката.')
        verify_source(previous / 'app')
        catalog = Catalog(paths)
        Engine(paths, previous / 'app', load_settings(previous / 'app'), previous / 'core/sing-box').check(catalog.nodes())
        host.stop()
        try:
            switch(paths.current, previous)
            if host.start():
                host.verify()
            switch(paths.base / 'previous', current)
            receipt['release'] = previous.name
            write_json(paths.private / 'install-receipt.json', receipt)
        except BaseException:
            switch(paths.current, current)
            host.start()
            raise
    elif action == 'uninstall':
        catalog = Catalog(paths)
        catalog.enable(False)
        host.stop()
        if paths.system == 'linux' and Path('/run/systemd/system').exists():
            host.command(['/usr/bin/systemctl', 'disable', 'tui-vpn.service'], (0, 1, 5))
        paths.unit.unlink(missing_ok=True)
        paths.launcher.unlink(missing_ok=True)
        paths.shortcut.unlink(missing_ok=True)
        if paths.system == 'linux' and Path('/run/systemd/system').exists():
            host.command(['/usr/bin/systemctl', 'daemon-reload'])
        receipt.update(state='UNINSTALLED')
        write_json(paths.private / 'install-receipt.json', receipt)
    else:
        raise AppError('Неизвестная операция обслуживания.')
    print('Операция завершена. Подписки и ключи сохранены в закрытом каталоге.')


def authorize_maintenance(action: str) -> None:
    paths = Paths()
    arguments = [str(python_path(paths)), '-I', '-B', str(paths.current / 'app/src/entry.py'),
                 '_maintain', '--action', action]
    if sys.platform == 'darwin':
        import shlex
        command = ' '.join(shlex.quote(x) for x in arguments)
        script = 'do shell script ' + json.dumps(command) + ' with administrator privileges'
        result = subprocess.run(['/usr/bin/osascript', '-e', script], check=False)
    else:
        result = subprocess.run(['/usr/bin/sudo', '/usr/bin/python3'] + arguments[1:], check=False)
    if result.returncode:
        raise AppError('Обслуживание не завершено. Проверьте состояние службы.')
