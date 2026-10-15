"""Review-driven regression. Linux/Mac facts mocked; no physical device diagnosis."""
import hashlib, http.server, os, signal, ssl, subprocess, tempfile, threading, time, unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]
ROOT=BASE/'diagnostics_v2'
def shell(code,env=None,timeout=20):
 return subprocess.run(['/bin/bash','-c',f'. "{ROOT}/run.sh"; '+code],text=True,capture_output=True,env=dict(os.environ,**(env or {})),timeout=timeout)
class CoverageTests(unittest.TestCase):
 def test_reduced_ram_completion_cannot_pass_plan(self):
  with tempfile.TemporaryDirectory() as d:
   script=f'''STEP_DIR='{d}';RAM_BYTES=68719476736;RAM_BACKEND=native_candidate;profile_validate(){{ return 0; }};
compile_c(){{ printf '#!/bin/bash\\nexit 0\\n' > "$2";chmod +x "$2"; }};
pf_probe(){{ printf 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\\nPages free: 2121728.\\n'; }};
capture(){{ printf 'ENGINE_COMPLETE=RAM_PASS\\n' > "$STEP_DIR/engine.log";return 0; }};
ram_main quick'''
   p=shell(script);self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertIn('RAM_COVERAGE_REDUCED',p.stdout)
   c=Path(d,'coverage.tsv').read_text();self.assertIn('planned_mib\t8192\n',c);self.assertIn('budget_mib\t96\n',c);self.assertIn('completed_mib\t96\n',c)
 def test_failed_budget_probe_with_partial_stdout_not_accepted(self):
  p=shell("RAM_BYTES=68719476736;pf_probe(){ printf 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\\nPages free: 9999999.\\n';return 1; };native_budget 8192")
  self.assertEqual(p.returncode,3,p.stdout+p.stderr)
 def test_ram_map_is_not_silently_perl_quick(self):
  with tempfile.TemporaryDirectory() as d:
   p=shell(f"STEP_DIR='{d}';RAM_BACKEND=perl_screen;RAM_BYTES=68719476736;capture(){{ echo MUST_NOT_RUN; }};recovery_ram_main map")
   self.assertEqual(p.returncode,3);self.assertIn('RAM_MAP_REQUIRES_NATIVE',p.stdout);self.assertNotIn('MUST_NOT_RUN',p.stdout)
 def test_coverage_visible_in_report(self):
  with tempfile.TemporaryDirectory() as d:
   t=Path(d,'RAM_QUICK.test');t.mkdir()
   p=shell(f'''SESSION='{d}';STEP_DIR='{t}';: > "$SESSION/profile.txt";
coverage_record 8192 96 96 65536 REDUCED_COMPLETE;
printf 'RAM_QUICK\\tINCONCLUSIVE\\tRAM_COVERAGE_REDUCED\\t{t}\\n' > "$SESSION/summary.tsv";
report_render INCONCLUSIVE''')
   self.assertEqual(p.returncode,0,p.stderr);self.assertIn('budget_mib\t96',Path(d,'REPORT_RU_EN.md').read_text())
class PathTests(unittest.TestCase):
 def test_root_and_device_path_refused(self):
  for path in ['/','/dev','/dev/null']:
   self.assertNotEqual(shell(f'ENVIRONMENT=full;canonical_target "{path}"').returncode,0)
 def test_recovery_dotdot_cannot_escape_volumes(self):
  created=False
  if not Path('/Volumes').exists():
   try:Path('/Volumes').mkdir();created=True
   except PermissionError:self.skipTest('cannot create sandbox /Volumes fixture')
  try:
   with tempfile.TemporaryDirectory() as d:
    p=shell(f'ENVIRONMENT=recovery;canonical_target "/Volumes/..{d}"');self.assertEqual(p.returncode,3,p.stdout+p.stderr)
  finally:
   if created:Path('/Volumes').rmdir()
 def test_symlink_to_device_refused(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'alias').symlink_to('/dev');p=shell(f'ENVIRONMENT=full;canonical_target "{d}/alias"');self.assertEqual(p.returncode,3)
 def test_full_target_is_canonical_and_recorded(self):
  with tempfile.TemporaryDirectory() as d:
   parent=Path(d);(parent/'volume').mkdir();(parent/'alias').symlink_to(parent/'volume')
   p=shell(f'''STEP_DIR='{d}';ENVIRONMENT=full;
pf_probe(){{ shift;case "$1" in diskutil)printf '   Mount Point: /\\n';;df)df -Pk "$3";;esac; }};
target_preflight '{d}/alias';echo "CANON=$TARGET_CANONICAL"''')
   self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn(f'CANON={d}/volume',p.stdout);self.assertTrue((parent/'target-df.txt').is_file())
 def test_mount_label_without_confirmation_blocks_recovery_write(self):
  with tempfile.TemporaryDirectory() as d:
   p=shell(f'''STEP_DIR='{d}';ENVIRONMENT=recovery;
canonical_target(){{ echo '{d}'; }};pf_probe(){{ echo 'Mount Point: /'; }};target_preflight '{d}' ''')
   self.assertEqual(p.returncode,3);self.assertIn('RECOVERY_MOUNT_UNCONFIRMED',p.stdout)
class ReportTests(unittest.TestCase):
 def test_not_run_persisted_in_machine_summary(self):
  with tempfile.TemporaryDirectory() as d:
   p=shell(f'''SESSION='{d}';printf 'CPU\\nGPU\\n' > "$SESSION/plan.txt";: > "$SESSION/summary.tsv";
record_not_run;record_not_run''')
   self.assertEqual(p.returncode,0,p.stderr);rows=Path(d,'summary.tsv').read_text().splitlines();self.assertEqual(len(rows),2);self.assertIn('CPU\tNOT_RUN',rows[0])
 def test_selftest_scope_is_explicit(self):
  with tempfile.TemporaryDirectory() as d:
   p=shell(f'''SESSION='{d}';MODE=selftest;: > "$SESSION/profile.txt";printf 'TOOLKIT\\tPASS\\tTOOLKIT_CHECKED\\t{d}\\n' > "$SESSION/summary.tsv";report_render PASS''')
   self.assertEqual(p.returncode,0,p.stderr);self.assertIn('hardware was not tested',Path(d,'REPORT_RU_EN.md').read_text())
 def test_successful_file_does_not_say_preserve_failed_file(self):
  p=shell('next_step FILE_WRITE_AND_TWO_READBACKS PASS');self.assertNotIn('retained test file',p.stdout)
 def test_unknown_dependency_does_not_default_to_pass_explanation(self):
  p=shell('next_step FREE_SPACE_UNKNOWN INCONCLUSIVE');self.assertNotIn('PASS covers',p.stdout)
 def test_empty_support_export_refused(self):
  with tempfile.TemporaryDirectory() as d:
   Path(d,'environment.tsv').write_text('schema\t1\n');Path(d,'summary.tsv').touch()
   p=shell(f'STEP_DIR="{d}";support_export "{d}"');self.assertEqual(p.returncode,3);self.assertIn('SUPPORT_NO_RESULTS',p.stdout)
 def test_support_enter_selects_previous_nonempty_not_new_run(self):
  with tempfile.TemporaryDirectory() as d:
   prev=Path(d,'macdiag-v2.prev');prev.mkdir();(prev/'summary.tsv').write_text('RAM\tINCONCLUSIVE\tLIMIT\t-\n')
   now=Path(d,'macdiag-v2.current');now.mkdir();(now/'summary.tsv').touch()
   p=shell(f'''SESSION='{now}';read_reply(){{ REPLY='';return 0; }};support_export(){{ echo "SELECTED=$1";return 5; }};support_main''')
   self.assertEqual(p.returncode,5,p.stderr);self.assertIn(f'SELECTED={prev}',p.stdout)
 def test_exact_leftover_file_reported_without_deleting(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d,'.macdiag-test-owned.bin');f.write_bytes(b'test');Path(d,'engine.log').write_text(f'TEST_FILE={f}\n')
   p=shell(f'record_leftover_file "{d}"');self.assertEqual(p.returncode,0,p.stderr);self.assertIn(f'LEFTOVER_TEST_FILE={f}',p.stdout);self.assertEqual(f.read_bytes(),b'test')
class ProcessTests(unittest.TestCase):
 def test_successful_probe_reaps_guard_timer(self):
  with tempfile.TemporaryDirectory() as d:
   bin=Path(d,'bin');bin.mkdir();pidfile=Path(d,'pids')
   sleep=bin/'sleep';sleep.write_text(f'#!/bin/bash\necho $$ >> "{pidfile}"\nexec /bin/sleep "$@"\n');sleep.chmod(0o755)
   p=shell(f'PATH="{bin}:$PATH";pf_probe 9 /bin/sleep 0.15')
   self.assertEqual(p.returncode,0,p.stderr);time.sleep(.1)
   for pid in pidfile.read_text().splitlines():
    stat=subprocess.run(['ps','-p',pid,'-o','stat='],capture_output=True,text=True)
    self.assertTrue(stat.returncode!=0,stat.stdout)
 def test_ignores_term_is_killed_and_not_pass(self):
  with tempfile.TemporaryDirectory() as d:
   log=Path(d,'log');p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'1',str(log),'/bin/bash','-c',"trap '' TERM;while :;do sleep 1;done"],capture_output=True,text=True,timeout=10)
   self.assertEqual(p.returncode,124,p.stdout+p.stderr);self.assertIn('timeout=1',p.stdout)
 def test_bad_grace_does_not_execute_child(self):
  with tempfile.TemporaryDirectory() as d:
   f=Path(d,'created');p=subprocess.run(['perl',str(ROOT/'supervise.pl'),'1',d+'/log','touch',str(f)],env=dict(os.environ,MACDIAG_STOP_GRACE='999999'),capture_output=True)
   self.assertEqual(p.returncode,3);self.assertFalse(f.exists())
class CompilerTests(unittest.TestCase):
 def test_fortify_test_build_checks_injection_io(self):
  with tempfile.TemporaryDirectory() as d:
   p=subprocess.run(['cc','-std=c11','-O2','-D_FORTIFY_SOURCE=2','-DDIAG_TESTING','-Wall','-Wextra','-Werror',str(ROOT/'storage_file.c'),'-o',d+'/file'],capture_output=True,text=True)
   self.assertEqual(p.returncode,0,p.stderr)
 def test_metal_command_error_not_mismatch(self):
  # Source contract ONLY; actual Metal runtime cannot be validated on Linux.
  text=(ROOT/'metal_vram.m').read_text()
  lines=[x for x in text.splitlines() if 'cb.status!=MTLCommandBufferStatusCompleted' in x]
  self.assertEqual(len(lines),2)
  for line in lines:self.assertIn('return 3;',line)
class Handler(http.server.BaseHTTPRequestHandler):
 counts={}
 def log_message(self,*args):pass
 def do_GET(self):
  n=self.counts.get(self.path,0);self.counts[self.path]=n+1
  code=int(self.path[1:]) if self.path[1:].isdigit() else 200
  if self.path=='/recover':code=503 if n==0 else 200
  data=b'abc';self.send_response(code);self.send_header('Content-Length','3');self.end_headers();self.wfile.write(data)
class TransportTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.d=Path(cls.tmp.name);cert=cls.d/'cert';key=cls.d/'key'
  subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
  cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cert,key);cls.server.socket=ctx.wrap_socket(cls.server.socket,server_side=True)
  cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.url=f'https://127.0.0.1:{cls.server.server_port}';cls.env={'CURL_CA_BUNDLE':str(cert),'NO_PROXY':'127.0.0.1','no_proxy':'127.0.0.1'}
 @classmethod
 def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join(3);cls.tmp.cleanup()
 def transfer(self,path,trust=True,method='net_attempt'):
  with tempfile.TemporaryDirectory() as d:
   env=self.env if trust else dict(self.env,CURL_CA_BUNDLE='/etc/ssl/certs/ca-certificates.crt')
   return shell(f'''STEP_DIR='{d}';select_hash;{method} '{self.url}{path}' {hashlib.sha256(b'abc').hexdigest()} 3;rc=$?;echo "NET_REASON=$NET_REASON";exit "$rc"''',env)
 def test_http_external_failures_inconclusive(self):
  for status in [400,401,403,404,410,429,500,502,503,504]:
   with self.subTest(status=status):
    p=self.transfer('/'+str(status));self.assertEqual(p.returncode,3,p.stdout+p.stderr)
 def test_tls_untrusted_is_not_hardware_fail(self):
  p=self.transfer('/200',False);self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertIn('curl=60',p.stdout)
 def test_recovered_http503_is_not_clean_pass(self):
  Handler.counts['/recover']=0;p=self.transfer('/recover',method='net_check');self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertEqual(Handler.counts['/recover'],2);self.assertIn('RECOVERED_TRANSFER_NOT_CLEAN',p.stdout)
 def test_repeated503_bounded_and_inconclusive(self):
  Handler.counts['/503']=0;p=self.transfer('/503',method='net_check');self.assertEqual(p.returncode,3,p.stdout+p.stderr);self.assertEqual(Handler.counts['/503'],2)
 def test_mismatch_still_fail(self):
  with tempfile.TemporaryDirectory() as d:
   p=shell(f'''STEP_DIR='{d}';select_hash;net_attempt '{self.url}/200' {'0'*64} 3''',self.env);self.assertEqual(p.returncode,2,p.stdout+p.stderr)
 def test_dns_error_mock_stays_inconclusive(self):
  with tempfile.TemporaryDirectory() as d:
   p=shell(f'''STEP_DIR='{d}';select_hash;curl(){{ return 6; }};net_attempt https://not-contacted.invalid/ {'0'*64} 3''');self.assertEqual(p.returncode,3,p.stdout+p.stderr)
if __name__=='__main__':unittest.main()
