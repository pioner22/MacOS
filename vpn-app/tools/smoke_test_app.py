#!/usr/bin/env python3
"""Launch the real development .app on macOS and require a GUI-ready marker.

No administrator privileges, tunnel operations, profile reads or update download.
This is not a Big Sur runtime test unless the executing host actually runs 11.x.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import plistlib
import signal
import subprocess
import sys
import tempfile
import time

MARKER = 'BIGSURVPN_NATIVE_UI_READY_UPDATER_DISABLED'
LIMIT = 65536


def validate_app(app):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if info.get('VPNReleaseBuild') is not False:
        raise ValueError('Only explicitly marked development builds may be smoke-tested')
    if info.get('CFBundleIdentifier') != 'ru.pioner22.BigSurVPN':
        raise ValueError('Unexpected application identity')
    if info.get('CFBundleExecutable') != 'BigSurVPNApp':
        raise ValueError('Unexpected application executable')
    if info.get('SUPublicEDKey', ''):
        raise ValueError('The smoke build must not contain a release update key')
    executable = app / 'Contents/MacOS/BigSurVPNApp'
    if not executable.is_file() or not os.access(str(executable), os.X_OK):
        raise ValueError('Application executable is missing or not executable')
    return executable


def validate_result(code, stdout):
    if code != 0:
        raise ValueError('Native application failed with exit status %s' % code)
    if stdout.splitlines().count(MARKER) != 1:
        raise ValueError('Application did not report the development window-ready checkpoint')


def stop_process(p):
    if p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            p.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            p.wait(timeout=5)


def smoke(app, timeout=25):
    if sys.platform != 'darwin' or os.geteuid() == 0:
        raise ValueError('Native smoke test requires macOS and a non-root user')
    executable = validate_app(app)
    with tempfile.TemporaryDirectory(prefix='bigsurvpn-smoke-') as directory:
        home = Path(directory)
        env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'en_US.UTF-8',
               'HOME': str(home), 'CFFIXED_USER_HOME': str(home), 'TMPDIR': str(home),
               'BIGSURVPN_SMOKE_TEST': '1'}
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            p = subprocess.Popen([str(executable)], cwd=directory, env=env,
                                 stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                 start_new_session=True)
            try:
                deadline = time.monotonic() + timeout
                while p.poll() is None:
                    if time.monotonic() >= deadline:
                        raise ValueError('Native window did not finish its smoke test within %ss' % timeout)
                    if os.fstat(out.fileno()).st_size > LIMIT or os.fstat(err.fileno()).st_size > LIMIT:
                        raise ValueError('Native smoke test output exceeded the bounded log size')
                    time.sleep(0.05)
                out.seek(0)
                stdout = out.read(LIMIT + 1)
                if len(stdout) > LIMIT:
                    raise ValueError('Native smoke test output exceeded the bounded log size')
                validate_result(p.returncode, stdout.decode('utf-8', 'replace'))
            finally:
                stop_process(p)
    version = platform.mac_ver()[0]
    return {'result': 'PASS', 'test': 'native-development-window-smoke',
            'host_macos': version, 'host_architecture': platform.machine(),
            'updater_disabled': True, 'vpn_connection_tested': False,
            'big_sur_runtime_tested': version.split('.')[0] == '11'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = smoke(args.app.resolve())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        report = {'result': 'FAIL', 'test': 'native-development-window-smoke',
                  'detail': str(error) if isinstance(error, ValueError) else type(error).__name__}
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
