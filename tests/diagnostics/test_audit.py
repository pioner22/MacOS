#!/usr/bin/env python3
"""Regression tests; real local TLS/curl plus compiled C, never real device writes."""
import hashlib
import http.server
import os
from pathlib import Path
import shlex
import signal
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = os.environ.get('DIAG_TEST_BASH', '/bin/bash')


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, timeout=30, **kw)


def shell(body, **kw):
    prefix = f'export MACDIAG_ROOT={shlex.quote(str(ROOT))}; . "$MACDIAG_ROOT/diagnostics/run.sh"; '
    return run([BASH, '-c', prefix + body], **kw)


class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='macdiag-tests-')
        cls.path = Path(cls.tmp.name)
        for name in ('ram_native', 'storage_file'):
            for instrument in (False, True):
                binpath = cls.path/(name+('_fault' if instrument else ''))
                args = ['cc','-std=c11','-O2','-Wall','-Wextra','-Werror']
                if instrument:
                    args += ['-DDIAG_TESTING']
                r = run(args + [str(ROOT/f'diagnostics/{name}.c'),'-o',str(binpath)])
                if r.returncode:
                    raise AssertionError(r.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def native(self, *args, fault=False, inject=False):
        env=os.environ.copy()
        if inject: env['MACDIAG_TEST_INJECT']='1'
        return run([str(self.path/('ram_native_fault' if fault else 'ram_native')), *map(str,args)],env=env)

    def test_native_selftest(self):
        self.assertEqual(self.native('--selftest').returncode, 0)

    def test_native_quick(self):
        r=self.native(1,1,'quick',0)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('ENGINE_COMPLETE=RAM_PASS',r.stdout)

    def test_native_full_walking_bits(self):
        r=self.native(1,1,'full',0)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout.count('RAM_PATTERN_COMPLETE'),134)

    def test_native_map_rounds(self):
        r=self.native(1,3,'map',0)
        self.assertEqual(r.returncode,0)
        self.assertEqual(r.stdout.count('RAM_PATTERN_COMPLETE'),18)

    def test_native_detects_injected_bit(self):
        r=self.native(1,1,'quick',0,fault=True,inject=True)
        self.assertEqual(r.returncode,2)
        self.assertIn('mismatch_words=1',r.stdout)
        self.assertNotIn('ENGINE_COMPLETE=RAM_PASS',r.stdout)

    def test_production_ignores_injection_env(self):
        r=self.native(1,1,'quick',0,inject=True)
        self.assertEqual(r.returncode,0)
        self.assertNotIn('TEST_ONLY_INJECTED',r.stdout)

    def test_native_invalid_arguments(self):
        for value in ('0','-1','+1','abc','1x','49153','18446744073709551616'):
            with self.subTest(value=value):
                self.assertEqual(self.native(value,1,'quick',0).returncode,3)

    def test_native_invalid_mode(self):
        self.assertEqual(self.native(1,1,'unknown',0).returncode,3)

    def test_native_cancel(self):
        p=subprocess.Popen([str(self.path/'ram_native'),'1','1','quick','60'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        time.sleep(.2); p.send_signal(signal.SIGINT)
        out,err=p.communicate(timeout=5)
        self.assertEqual(p.returncode,130,err)
        self.assertNotIn('ENGINE_COMPLETE=RAM_PASS',out)

    def test_storage_roundtrip_and_cleanup(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'user.txt').write_text('KEEP')
            r=run([str(self.path/'storage_file'),d,'1'])
            self.assertEqual(r.returncode,0,r.stdout+r.stderr)
            self.assertEqual([p.name for p in Path(d).iterdir()],['user.txt'])
            self.assertEqual(Path(d,'user.txt').read_text(),'KEEP')

    def test_storage_detects_fault_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            env=os.environ.copy();env['MACDIAG_TEST_INJECT']='1'
            r=run([str(self.path/'storage_file_fault'),d,'1'],env=env)
            self.assertEqual(r.returncode,2,r.stdout+r.stderr)
            self.assertIn('EVIDENCE_FILE_RETAINED',r.stdout)
            self.assertEqual(len(list(Path(d).glob('macdiag-file.*/payload.bin'))),1)

    def test_storage_refuses_device_tree(self):
        self.assertEqual(run([str(self.path/'storage_file'),'/dev','1']).returncode,3)

    def test_storage_rejects_file_as_directory(self):
        with tempfile.NamedTemporaryFile() as f:
            self.assertEqual(run([str(self.path/'storage_file'),f.name,'1']).returncode,3)

    def test_storage_rejects_bad_size(self):
        for value in ('0','8193','-1','x','999999999999999999999'):
            with self.subTest(value=value):
                self.assertEqual(run([str(self.path/'storage_file'),str(self.path),value]).returncode,3)


class ShellTests(unittest.TestCase):
    def test_bash_syntax_active_package(self):
        paths=[ROOT/'st.sh']+[ROOT/line.split()[2] for line in (ROOT/'diagnostics/package.tsv').read_text().splitlines() if line.split()[2].endswith('.sh')]
        for f in paths:
            with self.subTest(file=f.name):
                r=run([BASH,'-n',str(f)])
                self.assertEqual(r.returncode,0,r.stderr)

    def test_perl_syntax(self):
        for f in (ROOT/'diagnostics').glob('*.pl'):
            self.assertEqual(run(['perl','-c',str(f)]).returncode,0)

    def test_perl_quick(self):
        r=run(['perl',str(ROOT/'diagnostics/ram_fallback.pl'),'1','1','quick','0'])
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertIn('ENGINE_COMPLETE=RAM_PASS',r.stdout)

    def test_perl_full_patterns(self):
        r=run(['perl',str(ROOT/'diagnostics/ram_fallback.pl'),'1','1','full','0'])
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout.count('RAM_PATTERN_COMPLETE'),22)

    def test_perl_fault_injection_test_copy_only(self):
        # Edit a private test copy, never ship an injection switch in the fallback.
        source=(ROOT/'diagnostics/ram_fallback.pl').read_text()
        source=source.replace('        sleep($hold);',
            "        substr($mem[0],3080,1)=chr(ord(substr($mem[0],3080,1))^1) if $r==0 && $p==0;\n        sleep($hold);")
        with tempfile.NamedTemporaryFile('w',suffix='.pl') as f:
            f.write(source);f.flush()
            r=run(['perl',f.name,'1','1','quick','0'])
        self.assertEqual(r.returncode,2,r.stderr)
        self.assertIn('allocation_byte=3080',r.stdout)
        self.assertNotIn('ENGINE_COMPLETE=RAM_PASS',r.stdout)

    def test_perl_invalid_budget(self):
        self.assertEqual(run(['perl',str(ROOT/'diagnostics/ram_fallback.pl'),'0','1','quick','0']).returncode,3)

    def test_boot_epoch_not_microseconds(self):
        r=shell("sysctl(){ printf '{ sec = 1760000000, usec = 197083 }\\n'; }; diag_boot_epoch")
        self.assertEqual(r.stdout.strip(),'1760000000')

    def test_missing_marker_never_pass(self):
        r=shell('diag_init test; : > "$DIAG_RUN/out"; engine_result 0 0 ENGINE_COMPLETE=RAM_PASS "$DIAG_RUN/out"')
        self.assertEqual(r.returncode,3)
        self.assertIn('MISSING_COMPLETION_MARKER',r.stdout)

    def test_logging_failure_never_pass(self):
        r=shell('diag_init test; engine_result 0 1 unused /dev/null')
        self.assertEqual(r.returncode,3)

    def test_cancel_not_hardware_fail(self):
        r=shell('diag_init test; engine_result 130 1 unused /dev/null')
        self.assertEqual(r.returncode,130)
        self.assertIn('RESULT=CANCELLED',r.stdout)

    def test_empty_target_cannot_write(self):
        env=os.environ.copy();env.pop('MACDIAG_TARGET_DIR',None)
        r=shell('diag_init storage; run_storage',env=env)
        self.assertEqual(r.returncode,5)
        self.assertIn('LEGACY_RAW_WRITE=BLOCKED',r.stdout)

    def test_no_terminal_no_consent(self):
        r=shell('diag_confirm FILETEST',start_new_session=True)
        self.assertNotEqual(r.returncode,0)

    def test_log_name_rejects_path_traversal(self):
        self.assertEqual(shell('diag_init ../bad').returncode,3)

    def test_checked_package_manifest(self):
        for line in (ROOT/'diagnostics/package.tsv').read_text().splitlines():
            h,n,p=line.split()
            content=(ROOT/p).read_bytes()
            self.assertEqual(len(content),int(n),p)
            self.assertEqual(hashlib.sha256(content).hexdigest(),h,p)

    def test_selftest_is_bounded_and_runs(self):
        r=run([BASH,str(ROOT/'toolkit_selftest.sh')])
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertIn('SELFTEST_BOUNDED_SCOPE',r.stdout)

    def test_missing_manifest_never_passes(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'diagnostics').mkdir()
            r=shell('diag_init test; '+f'export MACDIAG_ROOT={shlex.quote(d)}; run_selftest')
        self.assertEqual(r.returncode,3,r.stdout+r.stderr)
        self.assertIn('MISSING_PACKAGE_MANIFEST',r.stdout)

    def test_empty_manifest_never_passes(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d,'diagnostics').mkdir()
            Path(d,'diagnostics/package.tsv').touch()
            r=shell('diag_init test; '+f'export MACDIAG_ROOT={shlex.quote(d)}; run_selftest')
        self.assertEqual(r.returncode,3,r.stdout+r.stderr)
        self.assertIn('MISSING_PACKAGE_MANIFEST',r.stdout)

    def test_legacy_scope_bug_reproduced(self):
        script=r'''
        stream_check(){ LABEL=$1;URL=$2;EXPECT=$3;BYTES=$4;N=$5;H="/tmp/download-hash-$$-$N"; printf '%s|%s\n' "$URL" "$EXPECT"; }
        own_fixture(){ S=$1;H=$2;CNT=$3;N=$(printf 'nettest-%03dMiB.bin' "$S");I=1;while [ "$I" -le "$CNT" ];do stream_check "$N" "https://example.invalid/$N" "$H" $((S*1048576)) "$I";I=$((I+1));done; }
        own_fixture 1 expected 2
        '''
        r=run([BASH,'-c',script])
        lines=r.stdout.splitlines()
        self.assertIn('/nettest-001MiB.bin|expected',lines[0])
        self.assertIn('/1|/tmp/download-hash-',lines[1])

    def test_new_plan_does_not_clobber_filename_or_hash(self):
        with tempfile.NamedTemporaryFile('w') as f:
            f.write('size_mib\tbytes\tsha256\tfilename\n1\t1048576\t'+'a'*64+'\tnettest-001MiB.bin\n');f.flush()
            r=shell('. "$MACDIAG_ROOT/diagnostics/net.sh"; '
                'net_stream(){ local label=$1 url=$2 expected=$3; printf "%s|%s\\n" "$url" "$expected"; }; '
                f'net_plan {shlex.quote(f.name)} 1 https://example.invalid')
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout.splitlines(),['https://example.invalid/nettest-001MiB.bin|'+'a'*64]*5)

    def test_empty_plan_inconclusive(self):
        with tempfile.NamedTemporaryFile('w') as f:
            r=shell('. "$MACDIAG_ROOT/diagnostics/net.sh"; '+f'net_plan {shlex.quote(f.name)} 1 https://example.invalid')
        self.assertEqual(r.returncode,3)

    def test_no_retries_in_stream(self):
        source=(ROOT/'diagnostics/net.sh').read_text()
        self.assertIn('--retry 0',source)
        self.assertNotIn('--retry 2',source)

    def test_manifest_source_all_five_recomputed(self):
        for line in (ROOT/'network-fixtures.tsv').read_text().splitlines()[1:]:
            cells=line.split('\t')
            if not cells[0].isdigit():continue
            size=int(cells[0]);h=hashlib.sha256()
            for idx in range(size):
                h.update(hashlib.shake_256(f'MacOSDiag|{size}|{idx}'.encode()).digest(1048576))
            self.assertEqual(h.hexdigest(),cells[2])

    def test_range_hash_recomputed(self):
        h=hashlib.sha256()
        for idx in range(256,272):h.update(hashlib.shake_256(f'MacOSDiag|512|{idx}'.encode()).digest(1048576))
        self.assertEqual(h.hexdigest(),'6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c')

    def test_cpu_constant_recomputed(self):
        h=hashlib.sha256()
        for _ in range(256):h.update(bytes(1048576))
        self.assertEqual(h.hexdigest(),'a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484')


class TLSHandler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    retries=0
    def log_message(self,*args):pass
    def do_GET(self):
        body=b'abcdef';status=200;extra={};length=6
        if self.path=='/missing':status=404;body=b'not found';length=len(body)
        if self.path=='/corrupt':body=b'xbcdef'
        if self.path=='/short':body=b'abc';length=3
        if self.path=='/truncated':body=b'abc';length=6
        if self.path=='/range':status=206;body=b'cde';length=3;extra['Content-Range']='bytes 2-4/6'
        if self.path=='/wrong-range':status=206;body=b'cde';length=3;extra['Content-Range']='bytes 1-3/6'
        if self.path=='/retry':
            type(self).retries+=1
            if type(self).retries==1:
                self.send_response(200);self.send_header('Content-Length','6');self.end_headers()
                self.wfile.write(b'abc');self.wfile.flush();time.sleep(2);self.close_connection=True;return
        self.send_response(status)
        self.send_header('Content-Length',str(length))
        for k,v in extra.items():self.send_header(k,v)
        self.end_headers()
        try:self.wfile.write(body)
        except (BrokenPipeError,ssl.SSLError):pass
        self.close_connection=True


class TLSTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='diag-tls-')
        cls.path=Path(cls.temp.name);cert=cls.path/'cert.pem';key=cls.path/'key.pem'
        config=cls.path/'openssl.cnf'
        config.write_text('[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n')
        r=run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-config',str(config)])
        if r.returncode:raise AssertionError(r.stderr)
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),TLSHandler)
        ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key)
        cls.server.socket=ctx.wrap_socket(cls.server.socket,server_side=True)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base=f'https://127.0.0.1:{cls.server.server_port}'
        cls.env=os.environ.copy();cls.env['CURL_CA_BUNDLE']=str(cert)
        # Avoid unrelated proxy configuration for loopback tests.
        cls.env['NO_PROXY']='127.0.0.1';cls.env['no_proxy']='127.0.0.1'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.temp.cleanup()

    def check(self,path,body=b'abcdef',range_args=''):
        digest=hashlib.sha256(body).hexdigest()
        return shell('diag_init net; . "$MACDIAG_ROOT/diagnostics/net.sh"; '
            f'net_stream fixture {self.base}{path} {digest} {len(body)} 1 {range_args}',env=self.env)

    def test_https_valid(self):
        r=self.check('/good');self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertIn('TRANSFER_PASS',r.stdout)

    def test_https_corruption_detected(self):
        r=self.check('/corrupt');self.assertEqual(r.returncode,2)
        self.assertIn('SHA256_MISMATCH',r.stdout)

    def test_short_body_detected(self):
        r=self.check('/short');self.assertEqual(r.returncode,2)
        self.assertIn('CONTENT_LENGTH_MISMATCH',r.stdout)

    def test_truncation_detected(self):
        r=self.check('/truncated');self.assertEqual(r.returncode,2)
        self.assertIn('TRUNCATED_TRANSFER',r.stdout)

    def test_missing_fixture_not_hardware_fail(self):
        self.assertEqual(self.check('/missing').returncode,3)

    def test_range_valid(self):
        r=self.check('/range',b'cde','2 4 6')
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)

    def test_range_wrong_header(self):
        r=self.check('/wrong-range',b'cde','2 4 6')
        self.assertEqual(r.returncode,2,r.stdout+r.stderr)
        self.assertIn('CONTENT_RANGE_MISMATCH',r.stdout)

    def test_range_ignored_not_ram_fault(self):
        r=self.check('/good',b'cde','2 4 6')
        self.assertEqual(r.returncode,3,r.stdout+r.stderr)
        self.assertIn('RANGE_NOT_SUPPORTED',r.stdout)

    def test_legacy_retry_concatenates_partial_payload(self):
        TLSHandler.retries=0
        r=run(['curl','-q','-sS','--max-time','1','--retry','1','--retry-delay','1',self.base+'/retry'],env=self.env)
        self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(r.stdout,'abcabcdef')


if __name__=='__main__':
    unittest.main(verbosity=2)
