#!/usr/bin/env python3
"""Bootstrap-only regressions. macOS tools, runtime, sudo and network are mocks.

No real VPN is started and no real /usr/local permissions are changed.
Run: python3 -m unittest discover -s tests -p test_vpn_path_diagnostics.py -v
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'vpn.sh'
START = '=== ДИАГНОСТИКА КАТАЛОГОВ КОМАНДЫ ==='
END = '=== КОНЕЦ ДИАГНОСТИКИ ==='
PAYLOAD = b'harmless fixture\n'

MOCK = r'''
import json, os, stat, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
root = Path(os.environ['TEST_ROOT'])
if name == 'python':
    if 'assert sys.version_info' in ' '.join(args):
        sys.exit(0)
    name = 'runtime'
with (root / 'calls.jsonl').open('a') as f:
    f.write(json.dumps({'tool':name, 'args':args if name in ('ls', 'stat') else []})+'\n')
if name == 'uname':
    print('Darwin' if '-s' in args else 'x86_64')
elif name == 'sw_vers':
    print('11.7.10')
elif name == 'curl':
    if os.environ.get('TEST_FETCH_FAIL') == '1':
        sys.exit(7)
    target = Path(args[args.index('-o')+1])
    target.write_bytes(b'corrupt\n' if os.environ.get('TEST_CORRUPT') == '1' else b'harmless fixture\n')
elif name == 'runtime':
    print('ORIGINAL_RUNTIME_RESULT_' + os.environ['TEST_RESULT'])
    sys.exit(int(os.environ['TEST_RESULT']))
elif name == 'sudo':
    os.execv(args[0], args)
elif name in ('ls', 'stat'):
    if os.environ.get('TEST_FAIL_'+name.upper()) == '1':
        print('FIXTURE_'+name+'_ERROR', file=sys.stderr)
        sys.exit(3)
    path = root / 'local' if args[-1] == '/usr/local' else root / 'local' / 'bin'
    try:
        info = path.lstat()
    except FileNotFoundError:
        print('FIXTURE_NO_SUCH_PATH', file=sys.stderr)
        sys.exit(1)
    if name == 'stat':
        kind = 'Symbolic Link' if stat.S_ISLNK(info.st_mode) else 'Directory'
        print('%s | type=%s | uid=%d gid=%d | mode=%o' %
              (args[-1], kind, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)))
    else:
        print('FIXTURE_FLAGS_AND_ACL ' + args[-1])
        if path.is_symlink():
            print('link -> ' + os.readlink(path))
        print(' 0: group:fixture allow list,search')
else:
    raise SystemExit('unexpected test executable')
'''


class BootstrapPathDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='vpn-bootstrap-diagnostics-'))
        self.addCleanup(shutil.rmtree, self.root)
        self.tools = self.root / 'tools'; self.tools.mkdir()
        for name in ('uname', 'sw_vers', 'python', 'curl', 'sudo', 'ls', 'stat'):
            path = self.tools / name
            path.write_text('#!' + sys.executable + ' -S\n' + MOCK)
            path.chmod(0o755)
        self.local = self.root / 'local'
        self.bin = self.local / 'bin'
        self.bin.mkdir(parents=True)
        self.local.chmod(0o755); self.bin.chmod(0o775)
        (self.bin / 'unchanged').write_bytes(b'private fixture contents never printed')
        (self.root / 'data').mkdir(); (self.root / 'tty').touch()
        self.source = SOURCE.read_text()
        # Instrument a test copy only. Production source is never overwritten.
        self.instrumented = self.source
        for name in ('uname', 'sw_vers', 'python', 'curl', 'sudo', 'stat'):
            self.instrumented = self.instrumented.replace('/usr/bin/' + name, str(self.tools / name))
        self.instrumented = self.instrumented.replace('/bin/ls', str(self.tools / 'ls'))
        self.instrumented = self.instrumented.replace('/private/var/tmp', str(self.root))
        self.instrumented = self.instrumented.replace('/System/Volumes/Data', str(self.root / 'data'))
        self.instrumented = self.instrumented.replace('/dev/tty', str(self.root / 'tty'))
        self.instrumented = self.instrumented.replace('"$EUID"', '"$TEST_EUID"')
        h = hashlib.sha256(PAYLOAD).hexdigest()
        self.instrumented = re.sub(r'local (runtime|profile)_sha=[0-9a-f]{64}',
                                  lambda m: 'local ' + m.group(1) + '_sha=' + h,
                                  self.instrumented)

    def snapshot(self):
        return {str(p): (p.lstat().st_uid, p.lstat().st_gid,
                        p.lstat().st_mode, p.lstat().st_ino, p.lstat().st_ctime_ns)
                for p in (self.local, self.bin)}

    def run_bootstrap(self, result=1, euid=0, **extra):
        env = dict(os.environ, TEST_ROOT=str(self.root), TEST_RESULT=str(result), TEST_EUID=str(euid))
        env.update(extra)
        p = subprocess.run(['/bin/bash'], input=self.instrumented.encode(),
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           env=env, timeout=10)
        self.output = p.stdout.decode('utf-8', 'replace')
        log = self.root / 'calls.jsonl'
        self.calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return p.returncode

    def metadata_calls(self):
        return [c for c in self.calls if c['tool'] in ('ls', 'stat')]

    def test_bash_syntax(self):
        p = subprocess.run(['/bin/bash', '-n', str(SOURCE)], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_root_runtime_failure_automatically_shows_both_paths(self):
        self.assertEqual(self.run_bootstrap(), 1)
        self.assertIn(START, self.output); self.assertIn(END, self.output)
        self.assertIn('mode=775', self.output)
        self.assertEqual([c['args'][-1] for c in self.metadata_calls()],
                         ['/usr/local', '/usr/local', '/usr/local/bin', '/usr/local/bin'])
        self.assertLess(self.output.index('ORIGINAL_RUNTIME_RESULT_1'), self.output.index(START))
        self.assertEqual(self.output.count(START), 1)

    def test_sudo_failure_branch_also_shows_diagnostics(self):
        self.assertEqual(self.run_bootstrap(euid=501), 1)
        self.assertIn('sudo', [c['tool'] for c in self.calls])
        self.assertIn(START, self.output)

    def test_success_never_runs_diagnostics(self):
        self.assertEqual(self.run_bootstrap(result=0), 0)
        self.assertNotIn(START, self.output); self.assertEqual(self.metadata_calls(), [])

    def test_connected_with_warnings_is_not_a_path_error(self):
        self.assertEqual(self.run_bootstrap(result=2), 2)
        self.assertNotIn(START, self.output); self.assertEqual(self.metadata_calls(), [])

    def test_cancellation_exit_status_preserved(self):
        self.assertEqual(self.run_bootstrap(result=130), 130)
        self.assertNotIn(START, self.output)

    def test_termination_exit_status_preserved(self):
        self.assertEqual(self.run_bootstrap(result=143), 143)
        self.assertNotIn(START, self.output)

    def test_ls_failure_does_not_hide_runtime_error_or_skip_stat(self):
        self.assertEqual(self.run_bootstrap(TEST_FAIL_LS='1'), 1)
        self.assertIn('ORIGINAL_RUNTIME_RESULT_1', self.output)
        self.assertIn('WARN: ls', self.output)
        self.assertEqual(len(self.metadata_calls()), 4)
        self.assertIn('mode=775', self.output)

    def test_stat_failure_does_not_hide_ls_acl_output(self):
        self.assertEqual(self.run_bootstrap(TEST_FAIL_STAT='1'), 1)
        self.assertIn('WARN: stat', self.output)
        self.assertIn('group:fixture', self.output); self.assertIn(END, self.output)

    def test_both_tools_fail_original_error_code_still_preserved(self):
        self.assertEqual(self.run_bootstrap(TEST_FAIL_STAT='1', TEST_FAIL_LS='1'), 1)
        self.assertIn(END, self.output)

    def test_directory_owner_mode_inode_and_contents_unchanged(self):
        before = self.snapshot()
        self.run_bootstrap()
        self.assertEqual(before, self.snapshot())
        self.assertEqual((self.bin / 'unchanged').read_bytes(), b'private fixture contents never printed')
        self.assertNotIn('private fixture contents never printed', self.output)

    def test_missing_path_is_reported_not_created(self):
        shutil.rmtree(self.bin)
        self.assertEqual(self.run_bootstrap(), 1)
        self.assertIn('FIXTURE_NO_SUCH_PATH', self.output)
        self.assertFalse(self.bin.exists())
        self.assertIn(END, self.output)

    def test_symbolic_link_is_reported_not_replaced(self):
        shutil.rmtree(self.bin)
        target = self.root / 'other'; target.mkdir()
        self.bin.symlink_to(target)
        before = self.snapshot()
        self.assertEqual(self.run_bootstrap(), 1)
        self.assertIn('type=Symbolic Link', self.output)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(os.readlink(self.bin), str(target))

    def test_failed_download_does_not_execute_runtime(self):
        self.assertEqual(self.run_bootstrap(TEST_FETCH_FAIL='1'), 1)
        self.assertNotIn('runtime', [c['tool'] for c in self.calls])
        self.assertEqual(self.metadata_calls(), [])

    def test_checksum_failure_does_not_execute_runtime(self):
        self.assertEqual(self.run_bootstrap(TEST_CORRUPT='1'), 1)
        self.assertIn('SHA-256', self.output)
        self.assertNotIn('runtime', [c['tool'] for c in self.calls])
        self.assertEqual(self.metadata_calls(), [])

    def test_temporary_download_files_are_cleaned_on_failure(self):
        self.run_bootstrap()
        self.assertEqual(list(self.root.glob('bigsur-vpn-bootstrap.*')), [])

    def test_only_fixed_paths_and_read_only_tools_are_called(self):
        self.run_bootstrap()
        calls = self.metadata_calls()
        self.assertEqual(len(calls), 4)
        for c in calls:
            self.assertIn(c['args'][-1], ('/usr/local', '/usr/local/bin'))
            if c['tool'] == 'ls':
                self.assertEqual(c['args'][:-1], ['-ldeOq'])
            else:
                self.assertEqual(c['args'][:-1], ['-f', '%N | type=%HT | uid=%u gid=%g | mode=%Lp'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
