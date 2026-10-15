"""Regression tests: no Mac diagnosis, raw devices, or external network requests.
Uses actual local TLS/curl, small native allocations and isolated child processes.
"""
import hashlib
import http.server
import os
from pathlib import Path
import resource
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

BASE = Path(__file__).resolve().parents[2]
ROOT = BASE / 'diagnostics_v2'
ENV = dict(os.environ)
ENV.pop('MACDIAG_TEST_INJECT', None)
ENV.pop('MACDIAG_TEST_FILE_INJECT', None)


def shell(script, env=None, timeout=20):
    return subprocess.run(['/bin/bash', '-c', script], text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          env=dict(ENV, **(env or {})), timeout=timeout)


class CommonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.prefix = f'. "{ROOT}/common.sh"; SESSION="{self.d}"; STEP_DIR="$SESSION"; : > "$SESSION/summary.tsv"; '

    def tearDown(self):
        self.tmp.cleanup()

    def test_hash_known_answer(self):
        p = shell(self.prefix + 'select_hash'); self.assertEqual(p.returncode, 0, p.stdout)

    def test_no_hash_tool_not_pass(self):
        p = shell(self.prefix + 'need(){ return 1; }; select_hash'); self.assertNotEqual(p.returncode, 0)

    def test_uint_validation(self):
        for s in ['', '-1', '+2', '2x', '0', '9999999999']:
            p = shell(self.prefix + f"valid_uint '{s}' 1 100")
            self.assertNotEqual(p.returncode, 0, s)
        self.assertEqual(shell(self.prefix + 'valid_uint 17 1 100').returncode, 0)

    def child(self, body):
        p = shell(self.prefix + f'child(){{ {body}; }}; run_step TEST child; cat "$SESSION/summary.tsv"')
        self.assertEqual(p.returncode, 0, p.stdout)
        return (self.d / 'summary.tsv').read_text().split('\t')[1]

    def test_structured_pass(self):
        self.assertEqual(self.child('passed OK'), 'PASS')

    def test_structured_failure(self):
        self.assertEqual(self.child('fault DATA_ERROR'), 'FAIL')

    def test_empty_exit_zero_never_passes(self):
        self.assertEqual(self.child('return 0'), 'INCONCLUSIVE')

    def test_pass_message_but_crash(self):
        self.assertEqual(self.child('passed OK; return 139'), 'INCONCLUSIVE')

    def test_exit_fail_without_evidence(self):
        self.assertEqual(self.child('return 2'), 'INCONCLUSIVE')

    def test_extra_contract_fields(self):
        self.assertEqual(self.child("printf 'PASS\t0\tOK\textra\n' > \"$STEP_DIR/result.tsv\"; return 0"), 'INCONCLUSIVE')

    def test_multiline_contract(self):
        self.assertEqual(self.child("printf 'PASS\t0\tOK\nPASS\t0\tOK\n' > \"$STEP_DIR/result.tsv\"; return 0"), 'INCONCLUSIVE')

    def test_observation_not_hardware_pass(self):
        self.assertEqual(self.child("result OBSERVED 5 INVENTORY ru en"), 'OBSERVED')

    def test_fail_has_priority_over_incomplete(self):
        f = self.d / 'sum'
        f.write_text('A\tFAIL\tx\nB\tINCONCLUSIVE\tx\nC\tPENDING_MANUAL\tx\n')
        p = shell(self.prefix + f'suite_state "{f}"'); self.assertEqual(p.stdout.strip(), 'FAIL')

    def test_observation_only_never_passes_suite(self):
        f = self.d / 'sum'; f.write_text('A\tOBSERVED\tx\n')
        p = shell(self.prefix + f'suite_state "{f}"'); self.assertEqual(p.stdout.strip(), 'INCONCLUSIVE')

    def test_manual_pending_not_pass(self):
        f = self.d / 'sum'; f.write_text('A\tPASS\tx\nB\tPENDING_MANUAL\tx\n')
        p = shell(self.prefix + f'suite_state "{f}"'); self.assertEqual(p.stdout.strip(), 'PENDING_MANUAL')

    def test_process_exit_preserved(self):
        p = shell(self.prefix + "supervise 5 /bin/bash -c 'exit 7'")
        self.assertEqual(p.returncode, 7, p.stdout)

    def test_timeout_not_pass(self):
        p = shell(self.prefix + 'supervise 1 sleep 30', timeout=10)
        self.assertEqual(p.returncode, 124, p.stdout)

    def test_cancel_aborts_step(self):
        p = shell(self.prefix + 'child(){ return 130; }; run_step TEST child; exit $?')
        self.assertEqual(p.returncode, 130, p.stdout)


class Handler(http.server.BaseHTTPRequestHandler):
    counters = {}
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def do_GET(self):
        with self.lock:
            n = self.counters.get(self.path, 0)
            self.counters[self.path] = n + 1
        body = b'abcdef'
        status = 200
        cr = None
        if self.path == '/404': status = 404; body = b''
        if self.path == '/flip': body = b'abcxef'
        if self.path == '/long': body = b'abcdefghijklm'
        if self.path.startswith('/range') and self.path != '/range-ignored':
            status = 206; body = b'bcd'; cr = 'bytes 1-3/6'
            if self.path == '/range-wrong': cr = 'bytes 2-4/6'
            if self.path == '/range-total': cr = 'bytes 1-3/999'
            if self.path == '/range-absent': cr = None
        if self.path == '/redirect':
            self.send_response(302); self.send_header('Location', '/range'); self.end_headers(); return
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        if cr: self.send_header('Content-Range', cr)
        self.end_headers()
        try:
            if self.path in ('/short', '/timeout') and n == 0:
                self.wfile.write(body[:3]); self.wfile.flush()
                if self.path == '/timeout': time.sleep(2)
                self.close_connection = True
                return
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass


class NetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.d = Path(cls.tmp.name)
        cert, key = cls.d / 'cert.pem', cls.d / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(key), '-out', str(cert), '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(cert, key)
        cls.server.socket = ctx.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.url = f'https://127.0.0.1:{cls.server.server_port}'
        cls.env = {'CURL_CA_BUNDLE': str(cert), 'NO_PROXY': '127.0.0.1', 'no_proxy': '127.0.0.1'}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.tmp.cleanup()

    def check(self, path, data=b'abcdef', size=None, extra='', function='net_check', extra_script='', timeout=20):
        d = Path(tempfile.mkdtemp(dir=self.d))
        command = (f'. "{ROOT}/common.sh"; ROOT="{ROOT}"; . "$ROOT/net.sh"; '
                   f'STEP_DIR="{d}"; select_hash || exit 99; NET_TIMEOUT=1; '
                   f'{function} "{self.url}{path}" {hashlib.sha256(data).hexdigest()} {size or len(data)} {extra}; '
                   'RC=$?; echo "END_REASON=$NET_REASON"; ' + extra_script + ' exit "$RC"')
        return shell(command, self.env, timeout)

    def test_complete_download(self):
        p = self.check('/good'); self.assertEqual(p.returncode, 0, p.stdout)

    def test_repeated_calls_do_not_clobber_url_or_hash(self):
        with Handler.lock: Handler.counters.pop('/repeat', None)
        for _ in range(3):
            p = self.check('/repeat'); self.assertEqual(p.returncode, 0, p.stdout)
        self.assertEqual(Handler.counters['/repeat'], 3)

    def test_same_shell_nested_loop_scoping(self):
        d = Path(tempfile.mkdtemp(dir=self.d)); h = hashlib.sha256(b'abcdef').hexdigest()
        p = shell(f'. "{ROOT}/common.sh"; ROOT="{ROOT}"; . "$ROOT/net.sh"; STEP_DIR="{d}"; select_hash; '
                  f'outer(){{ local N="{self.url}/nested" H={h} I; for I in 1 2 3;do net_check "$N" "$H" 6 || return;done; '
                  f'[ "$N" = "{self.url}/nested" ] && [ "$H" = {h} ]; }}; outer', self.env)
        self.assertEqual(p.returncode, 0, p.stdout)

    def test_bit_flip(self):
        p = self.check('/flip'); self.assertEqual(p.returncode, 2, p.stdout);self.assertIn('SHA256_MISMATCH', p.stdout)

    def test_short_then_complete_not_false_hash_failure_or_clean_pass(self):
        p = self.check('/short');self.assertEqual(p.returncode, 3, p.stdout)
        self.assertIn('RECOVERED_TRANSFER_NOT_CLEAN', p.stdout)
        self.assertNotIn('SHA256_MISMATCH', p.stdout)
        self.assertIn('bytes=6', p.stdout)

    def test_timeout_then_complete_not_appended(self):
        p = self.check('/timeout');self.assertEqual(p.returncode, 3, p.stdout)
        self.assertIn('RECOVERED_TRANSFER_NOT_CLEAN', p.stdout)
        self.assertNotIn('SHA256_MISMATCH', p.stdout)

    def test_http_404(self):
        p = self.check('/404');self.assertEqual(p.returncode, 2, p.stdout)
        self.assertIn('CURL_22', p.stdout)

    def test_oversize_body(self):
        p = self.check('/long');self.assertEqual(p.returncode, 2, p.stdout)
        self.assertIn('BODY_TOO_LONG', p.stdout)

    def test_range_exact(self):
        p = self.check('/range', b'bcd', extra='1-3 6');self.assertEqual(p.returncode, 0, p.stdout)

    def test_range_ignored_not_dram_failure(self):
        p = self.check('/range-ignored', b'bcd', extra='1-3 6');self.assertEqual(p.returncode, 3, p.stdout)
        self.assertIn('RANGE_NOT_SUPPORTED', p.stdout)

    def test_range_wrong_offset(self):
        p = self.check('/range-wrong', b'bcd', extra='1-3 6');self.assertEqual(p.returncode, 2, p.stdout)
        self.assertIn('CONTENT_RANGE_INVALID', p.stdout)

    def test_range_wrong_total(self):
        p = self.check('/range-total', b'bcd', extra='1-3 6');self.assertEqual(p.returncode, 2, p.stdout)

    def test_range_missing_header(self):
        p = self.check('/range-absent', b'bcd', extra='1-3 6');self.assertEqual(p.returncode, 2, p.stdout)

    def test_redirect_header_block_reset(self):
        p = self.check('/redirect', b'bcd', extra='1-3 6');self.assertEqual(p.returncode, 0, p.stdout)

    def test_invalid_sha(self):
        p = shell(f'. "{ROOT}/common.sh"; ROOT="{ROOT}"; . "$ROOT/net.sh"; net_attempt https://localhost invalid 6')
        self.assertEqual(p.returncode, 3)

    def test_plain_http_rejected(self):
        p = shell(f'. "{ROOT}/common.sh"; ROOT="{ROOT}"; . "$ROOT/net.sh"; net_attempt http://localhost x 6')
        self.assertEqual(p.returncode, 3)

    def test_no_unverified_tls_option(self):
        text = (ROOT / 'net.sh').read_text()
        self.assertNotIn('--insecure', text); self.assertNotIn('--retry 2', text)


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory();cls.d = Path(cls.tmp.name)
        for source in ['ram_native', 'storage_file']:
            for suffix, flags in [('', []), ('_inject', ['-DDIAG_TESTING'])]:
                subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', *flags,
                                str(ROOT / (source + '.c')), '-o', str(cls.d / (source + suffix))], check=True)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def ram(self, inject=False, mode='quick', env=None, preexec=None, hold='0', seconds='10'):
        return subprocess.run([str(self.d / ('ram_native_inject' if inject else 'ram_native')),
                               '1', '1', mode, hold, seconds], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, timeout=15, env=dict(ENV, **(env or {})), preexec_fn=preexec)

    def test_ram_selftest(self):
        p = subprocess.run([str(self.d / 'ram_native'), '--selftest'], capture_output=True)
        self.assertEqual(p.returncode, 0)

    def test_ram_small_valid_allocation(self):
        p = self.ram();self.assertEqual(p.returncode, 0, p.stdout);self.assertIn('ENGINE_COMPLETE=RAM_PASS', p.stdout)

    def test_ram_full_walk_patterns(self):
        p = self.ram(mode='full');self.assertEqual(p.returncode, 0, p.stdout);self.assertIn('pattern=133', p.stdout)

    def test_ram_fault_injection_detected(self):
        p = self.ram(True, env={'MACDIAG_TEST_INJECT': '1'})
        self.assertEqual(p.returncode, 2, p.stdout);self.assertIn('RAM_MISMATCH', p.stdout)

    def test_ram_map_preserves_failure(self):
        p = self.ram(True, mode='map', env={'MACDIAG_TEST_INJECT': '1'})
        self.assertEqual(p.returncode, 2, p.stdout)
        self.assertIn('RAM_PATTERN_COMPLETE round=1 pattern=5', p.stdout)

    def test_ram_injection_disabled_in_production(self):
        p = self.ram(env={'MACDIAG_TEST_INJECT': '1'});self.assertEqual(p.returncode, 0, p.stdout)
        self.assertNotIn('TEST_ONLY', p.stdout)

    def test_ram_lock_limit_inconclusive(self):
        def limit(): resource.setrlimit(resource.RLIMIT_MEMLOCK, (0, 0))
        p = self.ram(preexec=limit);self.assertEqual(p.returncode, 3, p.stdout)
        self.assertNotIn('ENGINE_COMPLETE=RAM_PASS', p.stdout)

    def test_ram_time_limit_inconclusive(self):
        p = self.ram(hold='2', seconds='1');self.assertEqual(p.returncode, 3, p.stdout)
        self.assertIn('ENGINE_TIMEOUT=1', p.stdout)

    def test_ram_invalid_arguments(self):
        for x in ['-1', '0', '999999999999999999999', 'abc']:
            p = subprocess.run([str(self.d / 'ram_native'), x, '1', 'quick', '0', '10'])
            self.assertEqual(p.returncode, 3, x)

    def file(self, inject=False, mode='storage', env=None, directory=None):
        return subprocess.run([str(self.d / ('storage_file_inject' if inject else 'storage_file')),
                               mode, '1', '2', str(directory or self.d), '10'],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                              env=dict(ENV, **(env or {})), timeout=15)

    def test_storage_real_write_read_cleanup(self):
        sentinel=self.d / 'important.txt';sentinel.write_bytes(b'do not overwrite')
        p = self.file();expected = 0 if os.uname().sysname == 'Darwin' else 3
        self.assertEqual(p.returncode, expected, p.stdout)
        self.assertIn('ENGINE_COMPLETE=FILE_BYTES_VERIFIED', p.stdout)
        self.assertEqual(sentinel.read_bytes(), b'do not overwrite')
        self.assertEqual(list(self.d.glob('.macdiag-test-*.bin')), [])

    def test_storage_fault_preserved_not_pass(self):
        with tempfile.TemporaryDirectory(dir=self.d) as d:
            p = self.file(True, env={'MACDIAG_TEST_FILE_INJECT': '1'}, directory=d)
            self.assertEqual(p.returncode, 2, p.stdout)
            self.assertIn('DATA_MISMATCH', p.stdout)
            self.assertEqual(len(list(Path(d).glob('.macdiag-test-*.bin'))), 1)

    def test_bridge_failure_not_ram_pass(self):
        with tempfile.TemporaryDirectory(dir=self.d) as d:
            p = self.file(True, mode='bridge', env={'MACDIAG_TEST_FILE_INJECT': '1'}, directory=d)
            self.assertEqual(p.returncode, 2, p.stdout)
            self.assertIn('BRIDGE_RAM_PREVERIFY=PASS', p.stdout)
            self.assertIn('BRIDGE_RAM_POSTVERIFY=PASS', p.stdout)
            self.assertNotIn('ENGINE_COMPLETE=FILE_BYTES_VERIFIED', p.stdout)

    def test_storage_injection_disabled_in_production(self):
        p = self.file(env={'MACDIAG_TEST_FILE_INJECT': '1'})
        self.assertIn('ENGINE_COMPLETE=FILE_BYTES_VERIFIED', p.stdout)
        self.assertNotIn('DATA_MISMATCH', p.stdout)

    def test_device_directory_refused(self):
        p=self.file(directory='/dev');self.assertEqual(p.returncode, 3, p.stdout)
        self.assertIn('REFUSED', p.stdout)

    def test_root_directory_refused(self):
        p=self.file(directory='/');self.assertEqual(p.returncode, 3, p.stdout)


class WiringTests(unittest.TestCase):
    def test_shell_syntax(self):
        for f in ROOT.glob('*.sh'):
            p=subprocess.run(['/bin/bash', '-n', str(f)], capture_output=True)
            self.assertEqual(p.returncode, 0, (f, p.stderr))

    def test_perl_syntax(self):
        p=subprocess.run(['perl', '-c', str(ROOT/'count_stream.pl')],capture_output=True)
        self.assertEqual(p.returncode,0,p.stderr)

    def test_acceptance_excludes_raw(self):
        s=(ROOT/'run.sh').read_text().split('acceptance_main(){',1)[1].split('finish_suite(){',1)[0]
        self.assertNotIn('raw_blocked',s);self.assertNotIn('ssd_test',s);self.assertNotIn('eraseDisk',s)

    def test_no_disk_management_write_commands(self):
        for f in ROOT.iterdir():
            if f.suffix in ('.sh','.c','.m'):
                s=f.read_text()
                self.assertNotIn('eraseDisk',s);self.assertNotIn('of=/dev/',s)

    def test_gpu_current_compile_status_gate(self):
        s=(ROOT/'run.sh').read_text()
        self.assertIn('rm -f "$bin"',s)
        self.assertIn('[ "$rc" -eq 0 ] && [ -x "$bin" ]',s)
        self.assertIn('GPU_CURRENT_BUILD_FAILED',s)

    def test_profile_mismatch(self):
        p=shell(f'. "{ROOT}/profile.sh"; CPU=intel; MODEL=MacBookPro16,1; MODEL_PROFILE=a2141; OS_KEY=catalina; OS_PROFILE=tahoe; ENV_PROFILE=auto; profile_validate')
        self.assertEqual(p.returncode,3)

    def test_wrong_model_not_enabled(self):
        p=shell(f'. "{ROOT}/profile.sh"; CPU=intel; MODEL=Other; MODEL_PROFILE=a2141; OS_PROFILE=auto; ENV_PROFILE=auto; profile_validate')
        self.assertEqual(p.returncode,3)

    def test_unknown_env_cannot_be_elevated(self):
        p=shell(f'. "{ROOT}/profile.sh"; CPU=intel; MODEL=MacBookPro16,1; MODEL_PROFILE=a2141; OS_PROFILE=auto; ENV_PROFILE=full; ENVIRONMENT=unknown; profile_validate')
        self.assertEqual(p.returncode,3)

    def test_fixture_reference_hashes(self):
        for row in (ROOT/'fixtures.txt').read_text().splitlines():
            size,digest,name,repeats=row.split();mib=int(size)//1048576;h=hashlib.sha256()
            for i in range(mib):h.update(hashlib.shake_256(f'MacOSDiag|{mib}|{i}'.encode()).digest(1048576))
            self.assertEqual(h.hexdigest(),digest,name)
        h=hashlib.sha256()
        for i in range(256,272):h.update(hashlib.shake_256(f'MacOSDiag|512|{i}'.encode()).digest(1048576))
        self.assertEqual(h.hexdigest(),'6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c')

    def test_hash_counter_exact(self):
        with tempfile.TemporaryDirectory() as d:
            p=subprocess.run(['perl',str(ROOT/'count_stream.pl'),'6',d+'/count'],input=b'abcdef',capture_output=True)
            self.assertEqual(p.returncode,0);self.assertEqual(p.stdout,b'abcdef');self.assertEqual(Path(d+'/count').read_text(),'6\n')

    def test_hash_counter_oversize(self):
        with tempfile.TemporaryDirectory() as d:
            p=subprocess.run(['perl',str(ROOT/'count_stream.pl'),'3',d+'/count'],input=b'abcdef',capture_output=True)
            self.assertEqual(p.returncode,4)


if __name__=='__main__':unittest.main()
