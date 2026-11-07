#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Scheduled signed-PKG updater. No trust key => no download and no install.

Trust is provisioned once by the publisher/operator, never taken from a VPN
profile or an unsigned manifest. A signed package is code with administrator
privileges: only the pinned publisher may authorize it.
"""
from __future__ import print_function, unicode_literals
import calendar
import hashlib
import json
import os
import plistlib
import re
import shutil
import sys
import tempfile
import time
try: from urllib.parse import urlsplit
except ImportError: from urlparse import urlsplit
from service_common import (BASE, PRIVATE, SERVICE, ServiceError, Busy, control,
    read_json, read_checked, write_json, locked, require_host, load_runtime, run, change_intent)

FEED = 'https://raw.githubusercontent.com/pioner22/MacOS/main/vpn/updates/service-stable.json'
SIGNATURE = FEED + '.sig'
KEY = SERVICE + '/publisher.pem'
POLICY = PRIVATE + '/update-policy.json'
STATE = PRIVATE + '/update-state.json'
CONTINUATION = PRIVATE + '/update-continuation.json'
PUBLIC_STATUS = SERVICE + '/update-status.json'
PKG_ID = 'ru.pioner22.bigsurvpn.service'
MANIFEST_LIMIT = 65536
PACKAGE_LIMIT = 512 * 1024 * 1024


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result: raise ServiceError('Duplicate manifest key')
            result[key] = value
        return result
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs)


def parse_manifest(data, now, installed_build):
    if not 0 < len(data) <= MANIFEST_LIMIT: raise ServiceError('Invalid manifest length')
    m = strict_json(data)
    expected = set(('schema', 'channel', 'build', 'version', 'architecture', 'minimum_os',
                    'maximum_os_major', 'issued_at', 'expires_at', 'package_id', 'url', 'sha256', 'size'))
    if not isinstance(m, dict) or set(m) != expected: raise ServiceError('Invalid manifest schema')
    if type(m['schema']) is not int or m['schema'] != 1 or m['channel'] != 'stable' or m['architecture'] != 'x86_64':
        raise ServiceError('Wrong release channel or architecture')
    if m['minimum_os'] != '11.0' or type(m['maximum_os_major']) is not int or m['maximum_os_major'] != 11:
        raise ServiceError('This adapter requires an explicitly Big-Sur-compatible release')
    if type(m['build']) is not int or not installed_build <= m['build'] <= 2147483647:
        raise ServiceError('Downgrade or invalid build number')
    if not isinstance(m['version'], (str, type(u''))) or not re.match(r'^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z', m['version']):
        raise ServiceError('Invalid release version')
    if type(m['issued_at']) is not int or type(m['expires_at']) is not int:
        raise ServiceError('Invalid signed timestamps')
    if not m['issued_at'] <= now + 300 or not now < m['expires_at'] or not 0 < m['expires_at'] - m['issued_at'] <= 7 * 86400:
        raise ServiceError('Expired or future release metadata')
    if m['package_id'] != PKG_ID: raise ServiceError('Unexpected package identifier')
    if type(m['size']) is not int or not 0 < m['size'] <= PACKAGE_LIMIT:
        raise ServiceError('Invalid package size')
    if not isinstance(m['sha256'], (str, type(u''))) or not re.match(r'^[a-f0-9]{64}\Z', m['sha256']):
        raise ServiceError('Invalid package digest')
    u = urlsplit(m['url'])
    if (u.scheme != 'https' or u.netloc != 'github.com' or u.query or u.fragment or
        not re.match(r'^/pioner22/MacOS/releases/download/vpn-service-v[0-9.]+/BigSurVPN-[A-Za-z0-9.-]+\.pkg\Z', u.path)):
        raise ServiceError('Package must be an immutable release asset in the expected repository')
    return m


def verify_signature(manifest_path, signature_path, key_path=KEY, executor=run):
    # An independent anchor; SHA-256 stored beside an unsigned download is not authentication.
    key = read_checked(key_path, 16384)
    if b'PRIVATE KEY' in key or b'PUBLIC KEY' not in key:
        raise ServiceError('Expected a publisher public key, not a private key')
    signature = read_checked(signature_path, 1024, private=True)
    if len(signature) not in (384, 512): raise ServiceError('RSA-3072/4096 signature required')
    rc, _, _ = executor(['/usr/bin/openssl', 'dgst', '-sha256', '-verify', key_path,
                          '-signature', signature_path, manifest_path], timeout=10)
    if rc: raise ServiceError('Publisher signature verification failed')


def verify_package(package, manifest, team_id, executor=run):
    if not re.match(r'^[A-Z0-9]{10}\Z', team_id or ''): raise ServiceError('Pinned Apple Team ID required')
    data = read_checked(package, PACKAGE_LIMIT, private=True)
    if len(data) != manifest['size'] or hashlib.sha256(data).hexdigest() != manifest['sha256']:
        raise ServiceError('Package size or digest mismatch')
    rc, signature, _ = executor(['/usr/sbin/pkgutil', '--check-signature', package], timeout=30)
    pattern = br'(?m)^\s*[0-9]+\. Developer ID Installer: [^\r\n]+ \(' + team_id.encode('ascii') + br'\)\s*$'
    if rc or not re.search(pattern, signature): raise ServiceError('Wrong Apple installer identity')
    rc, _, _ = executor(['/usr/sbin/spctl', '--assess', '--type', 'install', package], timeout=60)
    if rc: raise ServiceError('Gatekeeper did not approve the package')


def download(url, output, limit, redirects=False, executor=run):
    args = ['/usr/bin/curl', '-q', '-f', '-sS', '--proto', '=https', '--proto-redir', '=https',
            '--proxy', '', '--noproxy', '*', '--connect-timeout', '10', '--max-time', '600',
            '--max-filesize', str(limit), '-H', 'Cache-Control: no-cache', '-o', output, url]
    if redirects: args[2:2] = ['-L', '--max-redirs', '5']
    # Uses current routing; never disconnect a VPN merely to fetch an update.
    rc, _, _ = executor(args, timeout=605, file_limit=limit + 4096)
    if rc: raise ServiceError('Update download failed; existing installation was not changed')
    read_checked(output, limit, private=True)


def installed_version(executor=run):
    rc, out, _ = executor(['/usr/sbin/pkgutil', '--pkg-info-plist', PKG_ID], timeout=10)
    if rc: return None
    value = plistlib.loads(out) if hasattr(plistlib, 'loads') else plistlib.readPlistFromString(out)
    if value.get('pkgid') != PKG_ID: raise ServiceError('Wrong installer receipt')
    return value.get('pkg-version')


def refresh_subscription():
    rt = load_runtime()
    state = read_json(rt.CATALOG, 4 * 1024 * 1024)
    if not state.get('subscription'): return 'not_applicable'
    # Bind to the real current session, not to the user's preferred mode before failover.
    rt.assert_routes()
    active = read_json(rt.ACTIVE)
    body, _ = rt.http(state['subscription'], auth=active['auth'], subscription=True)
    nodes, skipped = rt.parse_subscription(body)
    state.update(nodes=nodes, updated_at=rt.now())
    rt.atomic_json(rt.CATALOG, state)
    change_intent()  # Reload cached candidates without changing enabled/Stop intent.
    return 'refreshed'


def status(result, build=None):
    write_json(PUBLIC_STATUS, {'result': result, 'build': build, 'checked_at': time.time()}, 0o644)
    print('UPDATE: ' + result)
    if result == 'NOT_CONFIGURED':
        print('Publisher trust and signed release channel are not configured; application and subscription are unchanged.')


def once(resume=False):
    require_host()
    if not control()['auto_update']:
        status('DISABLED'); return 0
    if not os.path.exists(KEY) or not os.path.exists(POLICY):
        status('NOT_CONFIGURED'); return 0
    settings = read_json(POLICY, 4096)
    team = settings.get('apple_team_id')
    if not re.match(r'^[A-Z0-9]{10}\Z', team or ''):
        status('NOT_CONFIGURED'); return 0
    state = read_json(STATE, 4096) if os.path.exists(STATE) else {'build': 0, 'version': None, 'failed_build': None}
    if type(state.get('build')) is not int: raise ServiceError('Invalid local update state')
    with locked(PRIVATE + '/updater.lock'):
        work = tempfile.mkdtemp(prefix='.signed-update-', dir=PRIVATE)
        try:
            manifest_path, sig_path = work + '/release.json', work + '/release.sig'
            download(FEED, manifest_path, MANIFEST_LIMIT)
            download(SIGNATURE, sig_path, 1024)
            verify_signature(manifest_path, sig_path)
            manifest = parse_manifest(read_checked(manifest_path, MANIFEST_LIMIT, private=True), int(time.time()), state['build'])
            if resume or os.path.exists(CONTINUATION):
                continuation = read_json(CONTINUATION, 4096)
                if installed_version() != continuation['version']:
                    state['failed_build'] = continuation.get('build'); write_json(STATE, state)
                    raise ServiceError('Updated package receipt not confirmed; no subscription refresh')
                state.update(build=continuation['build'], version=continuation['version'], failed_build=None)
                write_json(STATE, state)
                os.unlink(CONTINUATION)
            if manifest['build'] < state['build']:
                raise ServiceError('Signed feed older than the installed build')
            if manifest['build'] == state['build']:
                if manifest['version'] != installed_version() or manifest['version'] != state.get('version'):
                    raise ServiceError('Running installation has not been confirmed current')
                with locked(PRIVATE + '/command.lock'):
                    subscription = refresh_subscription()
                status('CURRENT_SUBSCRIPTION_' + subscription.upper(), manifest['build']); return 0
            if manifest['build'] == state.get('failed_build'):
                status('PREVIOUS_INSTALL_FAILED', manifest['build']); return 1
            package = work + '/BigSurVPN.pkg'
            download(manifest['url'], package, manifest['size'], redirects=True)
            verify_package(package, manifest, team)
            # Download/signature checks do not block the connection supervisor.
            # Only the actual installation obtains its exclusive maintenance lease.
            with locked(PRIVATE + '/command.lock'):
                current = read_json(SERVICE + '/status.json', private=False)
                if current.get('phase') != 'stopped' or control()['enabled']:
                    status('DEFERRED_UNTIL_VPN_STOPPED', manifest['build']); return 0
                if load_runtime().info():
                    raise ServiceError('A VPN session is still active; package install deferred')
                write_json(CONTINUATION, {'build': manifest['build'], 'version': manifest['version']})
                status('INSTALLING', manifest['build'])
                rc, _, _ = run(['/usr/sbin/installer', '-pkg', package, '-target', '/'], timeout=900)
                if rc or installed_version() != manifest['version']:
                    state['failed_build'] = manifest['build']; write_json(STATE, state)
                    status('INSTALL_FAILED', manifest['build'])
                    # A failed pkg can be partially applied. Do not claim rollback.
                    return 1
            # Continue in the freshly installed updater, not the old process.
            # The package contract must keep this fixed, root-owned entry point.
            path = SERVICE + '/current/secure_update.py'
            read_checked(path, 1024 * 1024)
            shutil.rmtree(work); work = None
            os.execv('/usr/bin/python', ['/usr/bin/python', '-E', '-s', '-B', path, 'resume'])
        finally:
            if work and os.path.exists(work): shutil.rmtree(work)


def main():
    os.umask(0o077)
    if len(sys.argv) != 2 or sys.argv[1] not in ('once', 'resume'):
        print('Use once|resume', file=sys.stderr); return 2
    try: return once(sys.argv[1] == 'resume')
    except Busy: status('DEFERRED_BUSY'); return 0
    except Exception:
        status('UPDATE_FAILED_SUBSCRIPTION_UNCHANGED')
        return 1

if __name__ == '__main__': sys.exit(main())
