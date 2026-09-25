#!/usr/bin/env python3
"""Build a native .app or prepare (not publish) a signed, notarized update.

Requires a macOS builder with Xcode and Python 3.8+. No sudo, no curl|bash,
no changes to /Library/BigSurVPN, no automatic release upload.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile

from release_support import (KEY_ACCOUNT, SPARKLE, archive_name, make_appcast,
                             make_info, release_tag, settings_from_info,
                             valid_base64, validate_settings, read_appcast,
                             validate_next_release, validate_macho_minimum)

ROOT = Path(__file__).resolve().parents[1]


def run(args, timeout=900):
    result = subprocess.run([str(x) for x in args], check=True, cwd=str(ROOT),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            encoding='utf-8', timeout=timeout)
    return result.stdout.strip()


def require_mac():
    if sys.platform != 'darwin':
        raise ValueError('Build, code signing and notarization require a real macOS builder')
    if os.geteuid() == 0:
        raise ValueError('Do not run the builder or Sparkle tools as root')


def copy_bundle(source, target):
    run(['/usr/bin/ditto', source, target])  # preserve framework symlinks


def check_deployment(app):
    for path in (app / 'Contents/MacOS/BigSurVPNApp',
                 app / 'Contents/Frameworks/Sparkle.framework/Sparkle'):
        validate_macho_minimum(run(['/usr/bin/xcrun', 'vtool', '-show-build', path]))


def code_sign(app, identity, development):
    framework = app / 'Contents/Frameworks/Sparkle.framework'
    nested = [framework / 'Versions/B/XPCServices/Downloader.xpc',
              framework / 'Versions/B/XPCServices/InstallerLauncher.xpc',
              framework / 'Versions/B/Updater.app', framework / 'Versions/B/Autoupdate']
    for path in nested + [framework, app]:
        if not path.exists():
            raise ValueError('Expected Sparkle bundle component missing: ' + str(path))
        options = ['--force', '--sign', identity]
        if not development:
            options += ['--options', 'runtime', '--timestamp']
        run(['/usr/bin/codesign'] + options + [path])
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', app])


def ensure_new_output(output):
    if output.exists() or output.is_symlink():
        raise ValueError('Output already exists; choose a new path (nothing overwritten)')
    output.parent.mkdir(parents=True, exist_ok=True)


def build(args):
    require_mac()
    settings = validate_settings(json.loads((ROOT / 'release.json').read_text()))
    key = os.environ.get('SPARKLE_PUBLIC_KEY', '').strip()
    info = make_info(settings, key, args.development)
    identity = '-' if args.development else args.identity
    if not identity or (not args.development and not identity.startswith('Developer ID Application:')):
        raise ValueError('Release builds need --identity "Developer ID Application: ..."')
    output = Path(args.output).expanduser().resolve()
    ensure_new_output(output)
    # Run pure policy tests before producing any distributable application.
    run(['/usr/bin/xcrun', 'swift', 'test'])
    command = ['/usr/bin/xcrun', 'swift', 'build', '-c', 'release', '--arch', 'x86_64',
               '--product', 'BigSurVPNApp']
    run(command)
    bin_dir = Path(run(['/usr/bin/xcrun', 'swift', 'build', '-c', 'release',
                        '--arch', 'x86_64', '--show-bin-path']))
    frameworks = list((ROOT / '.build/artifacts').rglob('Sparkle.framework'))
    if len(frameworks) != 1:
        raise ValueError('Expected exactly one checksum-verified Sparkle.framework artifact')
    with tempfile.TemporaryDirectory(prefix='.vpn-app-build-', dir=str(output.parent)) as temp:
        app = Path(temp) / 'BigSurVPN.app'
        (app / 'Contents/MacOS').mkdir(parents=True)
        (app / 'Contents/Resources').mkdir()
        (app / 'Contents/Frameworks').mkdir()
        shutil.copy2(str(bin_dir / 'BigSurVPNApp'), str(app / 'Contents/MacOS/BigSurVPNApp'))
        copy_bundle(frameworks[0], app / 'Contents/Frameworks/Sparkle.framework')
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        (app / 'Contents/PkgInfo').write_bytes(b'APPL????')
        run(['/usr/bin/lipo', '-verify_arch', 'x86_64', app / 'Contents/MacOS/BigSurVPNApp'])
        check_deployment(app)
        code_sign(app, identity, args.development)
        app.rename(output)
    print(output)
    if args.development:
        print('DEVELOPMENT ONLY: no trusted key/channel; updater is deliberately disabled.')


def tool_at(directory, name):
    path = directory / name
    if not path.is_file() or not os.access(str(path), os.X_OK):
        raise ValueError('Missing executable Sparkle tool: ' + str(path))
    return path


def prepare(args):
    require_mac()
    source_app = Path(args.app).expanduser().resolve()
    if source_app.name != 'BigSurVPN.app' or not source_app.is_dir():
        raise ValueError('Expected a built BigSurVPN.app; not the CLI installer')
    info = plistlib.loads((source_app / 'Contents/Info.plist').read_bytes())
    settings = settings_from_info(info)
    check_deployment(source_app)
    tools = Path(args.sparkle_tools).expanduser().resolve()
    signer = tool_at(tools, 'sign_update')
    key_tool = tool_at(tools, 'generate_keys')
    public_key = run([key_tool, '--account', KEY_ACCOUNT, '-p'])
    if public_key != info['SUPublicEDKey']:
        raise ValueError('Keychain signing key does not match the key embedded in this app')
    if not re.fullmatch(r'[A-Z0-9]{10}', args.team_id):
        raise ValueError('Expected a 10-character Apple Team ID')
    requirement = ('anchor apple generic and identifier "ru.pioner22.BigSurVPN" '
                   'and certificate leaf[subject.OU] = "%s"' % args.team_id)
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R', requirement, source_app])
    run(['/usr/bin/lipo', '-verify_arch', 'x86_64', source_app / 'Contents/MacOS/BigSurVPNApp'])
    notes = Path(args.notes).expanduser().read_text(encoding='utf-8')
    previous = None
    if args.previous_feed:
        previous_path = Path(args.previous_feed).expanduser().resolve()
        run([signer, '--account', KEY_ACCOUNT, '--verify', previous_path])
        previous = previous_path.read_bytes()
    validate_next_release(settings, notes, previous)
    output = Path(args.output).expanduser().resolve()
    ensure_new_output(output)
    with tempfile.TemporaryDirectory(prefix='.vpn-release-', dir=str(output.parent)) as temp:
        workspace = Path(temp)
        app = workspace / 'BigSurVPN.app'
        copy_bundle(source_app, app)  # never staple or modify the installed original
        submission = workspace / 'notarization.zip'
        run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, submission])
        response = json.loads(run(['/usr/bin/xcrun', 'notarytool', 'submit', submission,
                                   '--keychain-profile', args.notary_profile, '--wait',
                                   '--output-format', 'json'], timeout=1800))
        if response.get('status') != 'Accepted':
            raise ValueError('Apple notarization was not Accepted; update not prepared')
        run(['/usr/bin/xcrun', 'stapler', 'staple', app])
        run(['/usr/bin/xcrun', 'stapler', 'validate', app])
        run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R', requirement, app])
        run(['/usr/sbin/spctl', '--assess', '--type', 'execute', app])
        deliver = workspace / 'deliver'
        deliver.mkdir()
        archive = deliver / archive_name(settings)
        run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
        signature = run([signer, '--account', KEY_ACCOUNT, '-p', archive])
        if not valid_base64(signature, 64):
            raise ValueError('Signer did not return an Ed25519 signature')
        run([signer, '--account', KEY_ACCOUNT, '--verify', archive, signature])
        feed = deliver / 'appcast.xml'
        feed.write_bytes(make_appcast(settings, archive.stat().st_size, signature, notes, previous))
        run([signer, '--account', KEY_ACCOUNT, feed])  # signs XML in-place
        run([signer, '--account', KEY_ACCOUNT, '--verify', feed])
        read_appcast(feed.read_bytes())
        (deliver / 'release-notes.txt').write_text(notes, encoding='utf-8')
        (deliver / 'release.json').write_text(json.dumps({
            'tag': release_tag(settings), 'version': settings['version'],
            'build': settings['build'], 'archive': archive.name,
            'notarization': 'Accepted', 'published': False,
            'requires_real_update_smoke_test': True,
        }, indent=2) + '\n')
        deliver.rename(output)
    print(output)
    print('Prepared, not published. Test N -> N+1 on Big Sur before publishing the signed feed.')


def report_compiler_failure(error):
    """Expose bounded Swift diagnostics without printing signing arguments/env."""
    if not isinstance(error, (subprocess.CalledProcessError, subprocess.TimeoutExpired)):
        return
    command = error.cmd
    if not isinstance(command, (list, tuple)) or list(command[:2]) != ['/usr/bin/xcrun', 'swift']:
        return  # do not echo signing, keychain or notarization output
    for label, text in [('Swift stdout', error.stdout), ('Swift stderr', error.stderr)]:
        if isinstance(text, bytes):
            text = text.decode('utf-8', 'replace')
        if not text:
            continue
        # Remove ANSI/control sequences before writing a bounded excerpt to CI.
        text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text[-16000:])
        text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f-\x9f]', '', text)
        print(label + ':\n' + text, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    bundle = sub.add_parser('build')
    bundle.add_argument('--output', required=True)
    bundle.add_argument('--development', action='store_true')
    bundle.add_argument('--identity')
    bundle.set_defaults(function=build)
    release = sub.add_parser('prepare')
    release.add_argument('--app', required=True)
    release.add_argument('--sparkle-tools', required=True)
    release.add_argument('--notary-profile', required=True)
    release.add_argument('--team-id', required=True)
    release.add_argument('--notes', required=True)
    previous = release.add_mutually_exclusive_group(required=True)
    previous.add_argument('--previous-feed')
    previous.add_argument('--first-release', action='store_true')
    release.add_argument('--output', required=True)
    release.set_defaults(function=prepare)
    args = parser.parse_args()
    try:
        args.function(args)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        # Never dump command-line/environment credentials or unbounded build logs.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('ERROR: ' + message, file=sys.stderr)
        report_compiler_failure(error)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
