"""Regression tests: real C execution, local HTTPS and controlled failures.
No access to Mac hardware and no production-network downloads.
"""
import hashlib
import http.server
import os
from pathlib import Path
import shutil
import signal
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
V = ROOT / 'diagnostics/v2'
BASH = os.environ.get('TEST_BASH', '/bin/bash')


def call(args, **kwargs):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          timeout=kwargs.pop('timeout', 30), **kwargs)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.env = dict(os.environ, MACDIAG_REPORT_DIR=str(self.work), NO_PROXY='127.0.0.1,localhost')

    def tearDown(self):
        self.tmp.cleanup()

    def sh(self, code, **kw):
        init = f'D_ROOT="{ROOT}"; . "{V}/core.sh"; D_WORK="{self.work}"; D_LOG="$D_WORK/log"; : > "$D_LOG"; '
        return call([BASH, '-c', init + code], env=kw.pop('env', self.env), **kw)


class Core(Base):
    def test_sha(self):
        self.assertEqual(self.sh('d_hash_ready').returncode, 0)

    def test_uint_validation(self):
        for value in ('0', '64', '08', '49152'):
            with self.subTest(value=value):
                self.assertEqual(self.sh(f'd_num "{value}" 0 49152').returncode, 0)
        for value in ('-1', '+8', '1e6', '999999999999999999999', '64x', ''):
            with self.subTest(value=value):
                self.assertNotEqual(self.sh(f'd_num "{value}" 0 49152').returncode, 0)

    def test_aggregate_failure_sticky(self):
        self.assertEqual(self.sh('d_aggregate 0 2 0 3').returncode, 2)

    def test_aggregate_incomplete_not_pass(self):
        self.assertEqual(self.sh('d_aggregate 0 3 0').returncode, 3)

    def test_aggregate_observation_not_pass(self):
        self.assertEqual(self.sh('d_aggregate 0 5').returncode, 3)

    def test_aggregate_cancel(self):
        self.assertEqual(self.sh('d_aggregate 0 130').returncode, 130)

    def test_aggregate_empty_not_pass(self):
        self.assertEqual(self.sh('d_aggregate').returncode, 3)

    def test_log_failure_cannot_be_pass(self):
        r=self.sh('D_LOG=/nonexistent/path/log;d_result PASS 0 CHECK "ok" "ok"')
        self.assertEqual(r.returncode,3)
        self.assertIn('RESULT=INCONCLUSIVE code=3 reason=LOG_WRITE_FAILURE',r.stdout)

    def test_zero_without_completion(self):
        self.assertEqual(self.sh('touch "$D_WORK/out";d_engine_result 0 "$D_WORK/out" ENGINE_COMPLETE=RAM_PASS').returncode, 3)

    def test_completion_plus_crash_not_pass(self):
        self.assertEqual(self.sh('echo ENGINE_COMPLETE=RAM_PASS > "$D_WORK/out";d_engine_result 139 "$D_WORK/out" ENGINE_COMPLETE=RAM_PASS').returncode, 3)

    def test_compile_failure_cannot_reuse_binary(self):
        self.assertEqual(self.sh('touch "$D_WORK/bin";d_build /nonexistent "$D_WORK/bin" "$D_WORK/cc"').returncode, 3)

    def test_real_compile_failure(self):
        src = self.work/'bad.c';src.write_text('not C!!!')
        self.assertEqual(self.sh(f'd_build "{src}" "$D_WORK/bin" "$D_WORK/cc" -std=c11').returncode, 3)
        self.assertFalse((self.work/'bin').exists())

    def test_boot_sec_not_usec(self):
        r=self.sh('sysctl(){ echo "{ sec = 1760000000, usec = 197083 }"; };d_boot')
        self.assertEqual(r.stdout.strip(), '1760000000')

    def test_consent_eof_not_accepted(self):
        self.assertNotEqual(self.sh('d_confirm WRITE-TEST-FILE', start_new_session=True).returncode, 0)

    def test_profile_mismatch(self):
        r=self.sh(f'. "{V}/profile.sh";P_CPU=intel;P_MODEL=MacBookPro16,1;P_OS=10.15.7;P_ENV=recovery;p_apply a2141 tahoe recovery')
        self.assertEqual(r.returncode, 3)

    def test_profile_cannot_promote_unknown(self):
        r=self.sh(f'. "{V}/profile.sh";P_CPU=intel;P_MODEL=MacBookPro16,1;P_OS=10.15.7;P_ENV=unknown;p_apply a2141 auto full')
        self.assertEqual(r.returncode, 3)

    def test_profile_recovery_blocks_acceptance(self):
        r=self.sh(f'. "{V}/profile.sh";P_KERNEL=Darwin;P_CPU=intel;P_MODEL=MacBookPro16,1;P_OS=10.15.7;P_ENV=recovery;p_apply auto auto auto;p_allow acceptance')
        self.assertEqual(r.returncode, 3)

    def test_profile_full_intel_allows_acceptance(self):
        r=self.sh(f'. "{V}/profile.sh";P_KERNEL=Darwin;P_CPU=intel;P_MODEL=MacBookPro16,1;P_OS=26.0;P_ENV=full;p_apply a2141 auto auto;p_allow acceptance')
        self.assertEqual(r.returncode, 0)

    def test_profile_arm_not_intel(self):
        r=self.sh(f'. "{V}/profile.sh";P_CPU=apple_silicon;P_MODEL=MacBookPro16,1;P_OS=26.0;P_ENV=full;p_apply a2141 auto auto')
        self.assertEqual(r.returncode, 3)

    def test_memory_request_too_large(self):
        r=self.sh(f'. "{V}/run.sh";P_RAM=68719476736;MACDIAG_RAM_MIB=49152;vm_stat(){{ echo "Mach Virtual Memory Statistics: (page size of 4096 bytes)";echo "Pages free: 65536.";echo "Pages inactive: 0."; }};d_memory_budget full')
        self.assertEqual(r.returncode, 3)

    def test_memory_budget_cap(self):
        r=self.sh(f'. "{V}/run.sh";P_RAM=68719476736;vm_stat(){{ echo "Mach Virtual Memory Statistics: (page size of 4096 bytes)";echo "Pages free: 12582912.";echo "Pages inactive: 0."; }};d_memory_budget full;echo "$D_RAM_MIB"')
        self.assertEqual(r.stdout.strip(), '36864')

    def test_suite_storage_failure_not_hidden(self):
        r=self.sh(f'. "{V}/run.sh";d_stage(){{ case "$1" in storage) D_LAST=2;;*) D_LAST=0;;esac; }};d_suite acceptance')
        self.assertEqual(r.returncode, 2)
        self.assertIn('RESULT=FAIL',r.stdout)

    def test_suite_all_auto_pass_still_needs_manual_review(self):
        r=self.sh(f'. "{V}/run.sh";d_stage(){{ D_LAST=0; }};d_suite acceptance')
        self.assertEqual(r.returncode, 3)
        self.assertIn('AUTO_PASSED_MANUAL_REVIEW_REQUIRED',r.stdout)

    def test_ram_gate_stops_dependents(self):
        r=self.sh(f'. "{V}/run.sh";d_stage(){{ echo CALLED=$1;case "$1" in ram-quick) D_LAST=2;;*) D_LAST=0;;esac; }};d_suite acceptance')
        self.assertEqual(r.returncode, 2)
        self.assertIn('RESULT=FAIL code=2',r.stdout)
        self.assertNotIn('CALLED=storage',r.stdout)
        self.assertNotIn('CALLED=gpu',r.stdout)

    def test_network_failure_not_erased_by_later_success(self):
        r=self.sh(f'. "{V}/run.sh";d_stage(){{ case "$1" in network) D_LAST=2;;*) D_LAST=0;;esac; }};d_suite acceptance')
        self.assertEqual(r.returncode, 2)


class Supervisor(Base):
    def sup(self, seconds, cmd):
        return call(['perl',str(V/'supervise.pl'),str(seconds),str(self.work/'sup.log')]+cmd)

    def test_normal_exit(self):
        r=self.sup(5,[BASH,'-c','echo HELLO;exit 0'])
        self.assertEqual(r.returncode,0);self.assertIn('HELLO',(self.work/'sup.log').read_text())

    def test_nonzero_preserved(self):
        self.assertEqual(self.sup(5,[BASH,'-c','exit 2']).returncode,2)

    def test_timeout(self):
        self.assertEqual(self.sup(1,[BASH,'-c','sleep 30']).returncode,124)

    def test_signal_and_child_group(self):
        pidfile=self.work/'child.pid';log=self.work/'sup.log'
        p=subprocess.Popen(['perl',str(V/'supervise.pl'),'30',str(log),BASH,'-c',f'sleep 30 & echo $! > "{pidfile}";wait'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(50):
            if pidfile.exists():break
            time.sleep(.05)
        self.assertTrue(pidfile.exists());child=int(pidfile.read_text())
        p.terminate();self.assertEqual(p.wait(timeout=8),130)
        ps=call(['ps','-o','stat=','-p',str(child)])
        self.assertTrue(ps.returncode!=0 or ps.stdout.strip().startswith('Z'),ps.stdout)


class Native(Base):
    @classmethod
    def setUpClass(cls):
        cls.build=tempfile.TemporaryDirectory();cls.b=Path(cls.build.name)
        for name in ('ram_native','storage_file'):
            for variant,flags in (('',[]),('-inject',['-DDIAG_TESTING'])):
                r=call(['cc','-std=c11','-O2','-Wall','-Wextra','-Werror',*flags,str(V/(name+'.c')),'-o',str(cls.b/(name+variant))])
                if r.returncode:raise RuntimeError(r.stdout)

    @classmethod
    def tearDownClass(cls):cls.build.cleanup()

    def test_ram_selfcheck(self):self.assertEqual(call([str(self.b/'ram_native'),'--selftest']).returncode,0)

    def test_ram_quick(self):
        r=call([str(self.b/'ram_native'),'8','2','quick','0']);self.assertEqual(r.returncode,0);self.assertIn('patterns_completed=12 planned=12',r.stdout)

    def test_ram_full_134_patterns(self):
        r=call([str(self.b/'ram_native'),'8','1','full','0']);self.assertEqual(r.returncode,0);self.assertIn('patterns_completed=134 planned=134',r.stdout)

    def test_ram_injected_fault(self):
        r=call([str(self.b/'ram_native-inject'),'8','1','quick','0'],env=dict(self.env,MACDIAG_TEST_INJECT='1'))
        self.assertEqual(r.returncode,2);self.assertIn('RAM_MISMATCH',r.stdout);self.assertNotIn('ENGINE_COMPLETE=RAM_PASS',r.stdout)

    def test_ram_map_failure_stays(self):
        r=call([str(self.b/'ram_native-inject'),'8','2','map','0'],env=dict(self.env,MACDIAG_TEST_INJECT='1'))
        self.assertEqual(r.returncode,2);self.assertIn('patterns_completed=12 planned=12',r.stdout)

    def test_production_ram_has_no_injection(self):
        r=call([str(self.b/'ram_native'),'8','1','quick','0'],env=dict(self.env,MACDIAG_TEST_INJECT='1'))
        self.assertEqual(r.returncode,0);self.assertNotIn('TEST_ONLY_INJECTED',r.stdout)

    def test_ram_invalid_args(self):
        for n in ('-1','0','49153','999999999999999999999','1x'):
            with self.subTest(n=n):self.assertEqual(call([str(self.b/'ram_native'),n,'1','quick','0']).returncode,3)

    def test_ram_signal_no_pass(self):
        p=subprocess.Popen([str(self.b/'ram_native'),'8','1','quick','5'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        time.sleep(.15);p.terminate();text=p.communicate(timeout=5)[0]
        self.assertEqual(p.returncode,130);self.assertNotIn('ENGINE_COMPLETE=RAM_PASS',text)

    def test_storage_roundtrip_preserves_user_file(self):
        sentinel=self.work/'payload.bin';sentinel.write_bytes(b'user data do not touch')
        r=call([str(self.b/'storage_file-inject'),str(self.work),'8'])
        self.assertEqual(r.returncode,0,r.stdout);self.assertEqual(sentinel.read_bytes(),b'user data do not touch')
        self.assertEqual(list(self.work.iterdir()),[sentinel]);self.assertIn('STORAGE_READBACK_PASS=2',r.stdout)

    def test_storage_injected_corruption_retained(self):
        r=call([str(self.b/'storage_file-inject'),str(self.work),'8'],env=dict(self.env,MACDIAG_TEST_INJECT='1'))
        self.assertEqual(r.returncode,2);self.assertIn('STORAGE_MISMATCH',r.stdout);self.assertNotIn('ENGINE_COMPLETE=STORAGE_FILE_PASS',r.stdout)
        self.assertEqual(len(list(self.work.glob('*/payload.bin'))),1)

    def test_storage_truncation(self):
        r=call([str(self.b/'storage_file-inject'),str(self.work),'8'],env=dict(self.env,MACDIAG_TEST_TRUNCATE='1'))
        self.assertEqual(r.returncode,2);self.assertIn('FILE_SIZE_MISMATCH',r.stdout)

    def test_storage_rejects_device(self):
        for path in ('/dev','/dev/null'):
            self.assertEqual(call([str(self.b/'storage_file-inject'),path,'8']).returncode,3)

    def test_storage_rejects_symlink_to_device(self):
        link=self.work/'device';link.symlink_to('/dev')
        self.assertEqual(call([str(self.b/'storage_file-inject'),str(link),'8']).returncode,3)

    def test_storage_rejects_regular_file_directory(self):
        f=self.work/'user';f.write_text('keep')
        self.assertEqual(call([str(self.b/'storage_file-inject'),str(f),'8']).returncode,3);self.assertEqual(f.read_text(),'keep')

    def test_storage_invalid_size(self):
        self.assertEqual(call([str(self.b/'storage_file-inject'),str(self.work),'65537']).returncode,3)


class TLSHandler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    counts={}
    def log_message(self,*args):pass
    def do_GET(self):
        path=self.path;self.counts[path]=self.counts.get(path,0)+1
        status=200;body=b'abcdef';headers={}
        if path=='/404':status=404;body=b'not found'
        elif path=='/wrong':body=b'abcdeg'
        elif path=='/long':body=b'abcdefghi'
        elif path=='/short':body=b'abc'
        elif path=='/range':status=206;body=b'cde';headers['Content-Range']='bytes 2-4/6'
        elif path=='/wrongrange':status=206;body=b'cde';headers['Content-Range']='bytes 1-3/6'
        elif path=='/encoded':headers['Content-Encoding']='gzip'
        self.send_response(status)
        self.send_header('Content-Length',str(6 if path in ('/short','/retry') else len(body)))
        self.send_header('Connection','close')
        for k,v in headers.items():self.send_header(k,v)
        self.end_headers()
        try:
            if path=='/retry' and self.counts[path]==1:
                self.wfile.write(b'abc');self.wfile.flush();time.sleep(1.5)
            else:self.wfile.write(body);self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError,ssl.SSLError):pass
        self.close_connection=True


class Network(Base):
    @classmethod
    def setUpClass(cls):
        cls.certdir=tempfile.TemporaryDirectory();d=Path(cls.certdir.name);cls.ca=d/'cert.pem'
        r=call(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(d/'key.pem'),'-out',str(cls.ca),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'])
        if r.returncode:raise RuntimeError(r.stdout)
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),TLSHandler)
        ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(str(cls.ca),str(d/'key.pem'))
        cls.server.socket=ctx.wrap_socket(cls.server.socket,server_side=True)
        cls.port=cls.server.server_address[1];cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.certdir.cleanup()

    def stream(self,path,data=b'abcdef',size=6,range_args='',env=None):
        e=dict(self.env,CURL_CA_BUNDLE=str(self.ca));e.update(env or {})
        return self.sh(f'. "{V}/net.sh";n_stream test https://127.0.0.1:{self.port}{path} {hashlib.sha256(data).hexdigest()} {size} 1 {range_args}',env=e)

    def test_actual_tls_payload(self):
        r=self.stream('/ok');self.assertEqual(r.returncode,0,r.stdout);self.assertIn('actual_bytes=6',r.stdout)

    def test_wrong_sha(self):
        r=self.stream('/wrong');self.assertEqual(r.returncode,2);self.assertIn('SHA256_MISMATCH',r.stdout)

    def test_short_body(self):
        r=self.stream('/short');self.assertEqual(r.returncode,2);self.assertIn('TRUNCATED_TRANSFER',r.stdout)

    def test_long_body(self):
        r=self.stream('/long');self.assertEqual(r.returncode,2);self.assertIn('BODY_TOO_LONG',r.stdout)

    def test_missing_fixture_not_hardware_fail(self):
        r=self.stream('/404');self.assertEqual(r.returncode,3)

    def test_range_206_exact(self):
        r=self.stream('/range',b'cde',3,'2 4 6');self.assertEqual(r.returncode,0,r.stdout)

    def test_range_ignored(self):
        r=self.stream('/ok',b'cde',3,'2 4 6');self.assertEqual(r.returncode,3);self.assertIn('RANGE_NOT_SUPPORTED',r.stdout)

    def test_wrong_content_range(self):
        r=self.stream('/wrongrange',b'cde',3,'2 4 6');self.assertEqual(r.returncode,2);self.assertIn('CONTENT_RANGE_MISMATCH',r.stdout)

    def test_unknown_encoding(self):self.assertEqual(self.stream('/encoded').returncode,3)

    def test_plain_http_rejected(self):
        r=self.sh(f'. "{V}/net.sh";n_stream test http://127.0.0.1:{self.port}/ok '+hashlib.sha256(b'abcdef').hexdigest()+' 6 1')
        self.assertEqual(r.returncode,3)

    def test_timeout_then_fresh_attempt(self):
        TLSHandler.counts['/retry']=0
        a=self.stream('/retry',env={'MACDIAG_TRANSFER_TIMEOUT':'1'});b=self.stream('/retry')
        self.assertEqual(a.returncode,2,a.stdout);self.assertIn('TIMEOUT',a.stdout)
        self.assertEqual(b.returncode,0,b.stdout);self.assertIn('actual_bytes=6',b.stdout)

    def test_certificate_validation_not_disabled(self):
        r=self.stream('/ok',env={'CURL_CA_BUNDLE':'/nonexistent/ca'})
        self.assertNotEqual(r.returncode,0)

    def test_plan_preserves_filename_and_sha_all_repeats(self):
        manifest=self.work/'fixtures.tsv';digest='a'*64
        manifest.write_text(f'1\t1048576\t{digest}\tnettest-001MiB.bin\n')
        r=self.sh(f'. "{V}/net.sh";n_stream(){{ printf "%s %s %s\\n" "$2" "$3" "$5";return 0; }};n_plan "{manifest}" https://example.invalid/assets 1')
        self.assertEqual(r.returncode,0);lines=r.stdout.strip().splitlines();self.assertEqual(len(lines),5)
        for i,line in enumerate(lines,1):self.assertEqual(line,f'https://example.invalid/assets/nettest-001MiB.bin {digest} {i}')

    def test_plan_failed_attempt_not_hidden(self):
        manifest=self.work/'fixtures.tsv';manifest.write_text('1\t1048576\t'+'a'*64+'\tnettest-001MiB.bin\n')
        r=self.sh(f'. "{V}/net.sh";n_stream(){{ [ "$5" -ne 1 ]; }};n_stream(){{ if [ "$5" = 1 ];then return 2;else return 0;fi; }};n_plan "{manifest}" https://example.invalid/assets 1')
        self.assertEqual(r.returncode,2)

    def test_sha_process_failure_is_inconclusive(self):
        r=self.sh(f'. "{V}/net.sh";d_sha(){{ cat >/dev/null;return 1; }};n_stream test https://127.0.0.1:{self.port}/ok '+hashlib.sha256(b'abcdef').hexdigest()+' 6 1',env=dict(self.env,CURL_CA_BUNDLE=str(self.ca)))
        self.assertEqual(r.returncode,3)


class Package(Base):
    def test_all_bash_syntax(self):
        for p in V.glob('*.sh'):
            with self.subTest(file=p.name):self.assertEqual(call([BASH,'-n',str(p)]).returncode,0)

    def test_all_perl_syntax(self):
        for p in V.glob('*.pl'):
            with self.subTest(file=p.name):self.assertEqual(call(['perl','-c',str(p)]).returncode,0)

    def test_package_manifest(self):
        self.assertEqual(call([BASH,str(V/'verify.sh'),str(ROOT)]).returncode,0)

    def test_modified_package_is_rejected(self):
        root=self.work/'copy';shutil.copytree(V,root/'diagnostics/v2')
        (root/'diagnostics/v2/core.sh').write_text('echo changed')
        self.assertEqual(call([BASH,str(V/'verify.sh'),str(root)]).returncode,3)

    def test_no_raw_write_in_active_code(self):
        for p in V.iterdir():
            if p.suffix in ('.sh','.pl','.c','.m'):
                self.assertNotIn('eraseDisk',p.read_text());self.assertNotIn('dd of=',p.read_text())

    def test_hash_constants_independently(self):
        rows=(V/'network-fixtures.tsv').read_text().splitlines()[1:]
        for row in rows:
            mib,n,expected,name=row.split('\t');mib=int(mib)
            h=hashlib.sha256()
            for i in range(mib):h.update(hashlib.shake_256(f'MacOSDiag|{mib}|{i}'.encode()).digest(1048576))
            self.assertEqual(h.hexdigest(),expected,name);self.assertEqual(int(n),mib*1048576)
        h=hashlib.sha256()
        for i in range(256,272):h.update(hashlib.shake_256(f'MacOSDiag|512|{i}'.encode()).digest(1048576))
        self.assertEqual(h.hexdigest(),'6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c')

    def test_cpu_reference_independently(self):
        h=hashlib.sha256();b=bytes(1048576)
        for _ in range(256):h.update(b)
        self.assertEqual(h.hexdigest(),'a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484')


if __name__=='__main__':unittest.main(verbosity=2)
