#!/usr/bin/env python3
"""Build one native .pkg and one architecture-independent online-installer .deb."""
from __future__ import annotations
from typing import Any
import argparse
import datetime
import gzip
import hashlib
import io
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def files(root: Any) -> list:
    result = sorted(p for directory in ('src', 'config') for p in (root / directory).rglob('*')
                    if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
    documents = ['VERSION', 'LICENSE', 'PROVENANCE.md', 'SBOM.json', 'README.md',
                 'CHANGELOG.md', 'docs/ARCHITECTURE.md', 'migrations/README.md',
                 'packaging/dependencies.tsv']
    return result + sorted((root / 'schemas').glob('*.json')) + [root / n for n in documents]


def manifest(root: Any) -> tuple:
    value = {'schema': 'tui-vpn.source.v1', 'version': (root / 'VERSION').read_text().strip(),
             'files': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files(root)}}
    raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    (root / 'manifest.json').write_bytes(raw)
    return value, hashlib.sha256(raw).hexdigest()


def source_tree(root: Any, target: Any, source_manifest: dict) -> None:
    source_path, target_path = root.resolve(), target.resolve()
    if source_path == target_path or source_path in target_path.parents or target_path in source_path.parents:
        raise ValueError('Source and staging trees must be disjoint')
    target.mkdir(parents=True)
    for name in list(source_manifest['files']) + ['manifest.json']:
        (target / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, target / name)
        (target / name).chmod(0o644)


def postinstall(root: Any, source: Any, manifest_sha: Any) -> bytes:
    text = (root / 'packaging/postinstall.in').read_text()
    dependencies = hashlib.sha256((root / 'packaging/dependencies.tsv').read_bytes()).hexdigest()
    return text.replace('@SOURCE@', source).replace('@MANIFEST_SHA@', manifest_sha).replace('@DEPS_SHA@', dependencies).encode()


def tar_gzip(entries: Any) -> bytes:
    buffer = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=buffer, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            parents = sorted({str(parent) for name, _data, _mode in entries
                              for parent in Path(name).parents if str(parent) != '.'})
            for name in parents:
                entry = tarfile.TarInfo(name)
                entry.type, entry.mode, entry.uid, entry.gid, entry.mtime = tarfile.DIRTYPE, 0o755, 0, 0, 0
                archive.addfile(entry)
            for name, data, mode in entries:
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode, entry.mtime = len(data), mode, 0
                entry.uid = entry.gid = 0
                entry.uname = entry.gname = 'root'
                archive.addfile(entry, io.BytesIO(data))
    return buffer.getvalue()


def ar_file(entries: Any) -> bytes:
    output = bytearray(b'!<arch>\n')
    for name, data in entries:
        header = ('%-16s%-12s%-6s%-6s%-8s%-10s`\n' % (name + '/', '0', '0', '0', '100644', len(data))).encode('ascii')
        if len(header) != 60:
            raise ValueError('Invalid ar header')
        output.extend(header)
        output.extend(data)
        if len(data) % 2:
            output.extend(b'\n')
    return bytes(output)


def build_deb(root: Any, output: Any, source_manifest: dict, manifest_sha: Any) -> Path:
    version = source_manifest['version']
    control = ('Package: tui-vpn\nVersion: ' + version + '\nArchitecture: all\n'
        'Maintainer: pioner22 <noreply@users.noreply.github.com>\n'
        'Depends: python3 (>= 3.8), ca-certificates, curl, iproute2, nftables, perl\n'
        'Section: net\nPriority: optional\nHomepage: https://github.com/pioner22/MacOS\n'
        'Description: Terminal VPN controller with native sing-box failover\n'
        ' Verified engine is downloaded during configuration; profiles remain private.\n').encode()
    source = '/usr/lib/tui-vpn/package-source'
    scripts = [('control', control, 0o644), ('postinst', postinstall(root, source, manifest_sha), 0o755)]
    prerm = ('#!/bin/sh\nset -eu\nif [ "${1:-}" = remove ]; then\n'
        ' if [ -f /opt/tui-vpn/current/app/src/entry.py ]; then\n'
        '  /usr/bin/python3 -I -B /opt/tui-vpn/current/app/src/entry.py _maintain --action uninstall\n'
        ' fi\nfi\n').encode()
    scripts.append(('prerm', prerm, 0o755))
    data = [(source.lstrip('/') + '/' + name, (root / name).read_bytes(), 0o644)
            for name in list(source_manifest['files']) + ['manifest.json']]
    target = output / ('tui-vpn_' + version + '_all.deb')
    target.write_bytes(ar_file([('debian-binary', b'2.0\n'),
        ('control.tar.gz', tar_gzip(scripts)), ('data.tar.gz', tar_gzip(data))]))
    return target


def build_pkg(root: Any, output: Any, source_manifest: dict, manifest_sha: Any, workspace: Any) -> Path:
    payload, scripts = workspace / 'payload', workspace / 'scripts'
    source = '/Library/Application Support/TUI_VPN/package-source'
    source_tree(root, payload / source.lstrip('/'), source_manifest)
    scripts.mkdir()
    (scripts / 'postinstall').write_bytes(postinstall(root, source, manifest_sha))
    (scripts / 'postinstall').chmod(0o755)
    target = output / ('TUI_VPN-' + source_manifest['version'] + '-macos-intel.pkg')
    subprocess.run(['/usr/bin/pkgbuild', '--root', str(payload), '--scripts', str(scripts),
        '--identifier', 'ru.pioner22.tui-vpn', '--version', source_manifest['version'],
        '--install-location', '/', str(target)], check=True, timeout=90)
    return target


def build(root: Any, output: Any, workspace: Any, macos: bool=True) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    source_manifest, manifest_sha = manifest(root)
    packages = [('linux', build_deb(root, output, source_manifest, manifest_sha))]
    if macos:
        packages.append(('darwin', build_pkg(root, output, source_manifest, manifest_sha, workspace)))
    artifacts = [{'platform': system, 'name': path.name, 'bytes': path.stat().st_size,
                  'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for system, path in packages]
    now = datetime.datetime.now(datetime.timezone.utc)
    release = {'schema': 'tui-vpn.release.v1', 'version': source_manifest['version'],
        'published_at': int(now.timestamp()), 'expires_at': int((now + datetime.timedelta(days=180)).timestamp()),
        'source_sha256': manifest_sha, 'artifacts': artifacts,
        'supported': {'darwin': 'Intel, macOS 11+', 'linux': 'Ubuntu 22.04+/Debian 12+, amd64/arm64'},
        'dependency_download_required': True, 'developer_id_signed': False}
    (root / 'release.json').write_text(json.dumps(release, indent=2) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(a['sha256'] + '  ' + a['name'] + '\n' for a in artifacts))
    return release


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--linux-only', action='store_true')
    args = parser.parse_args()
    args.workspace.mkdir(parents=True, exist_ok=True)
    print(json.dumps(build(ROOT, args.output, args.workspace, not args.linux_only), ensure_ascii=False))
