"""Real shell/file dispatcher tests; HTTP is a local stub, no real VPN is run."""
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'repository_layout.py'
SPEC = importlib.util.spec_from_file_location('layout_under_test', SCRIPT)
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


class MappingTests(unittest.TestCase):
    def test_main_sources(self):
        self.assertEqual(r.destination('vpn-runtime.py'), 'vpn/vpn-runtime.py')
        self.assertEqual(r.destination('diagnostics_v2/run.sh'), 'diagnostics/diagnostics_v2/run.sh')
    def test_tests_are_separated(self):
        self.assertEqual(r.destination('tests/test_vpn_socks_choice.py'), 'vpn/tests/test_vpn_socks_choice.py')
        self.assertEqual(r.destination('tests/diagnostics_v2/test_runner.py'), 'diagnostics/tests/diagnostics_v2/test_runner.py')
    def test_core_registry_and_tools_stay_together(self):
        for path in ('macdiag_core/macdiag','registry/tests.tsv','tools/build_diagnostics_v2_manifest.py'):
            self.assertEqual(r.destination(path), 'diagnostics/' + path)
    def test_legacy_client_is_not_mixed_with_vpn(self):
        for path in ('src/App.tsx','desktop/main.cjs','scripts/build_pwa.mjs','package.json','makefile'):
            self.assertEqual(r.destination(path), '.archive/yagodka-client/' + path)
    def test_root_controls_retained(self):
        self.assertEqual(r.destination('LICENSE'), 'LICENSE')
        self.assertEqual(r.destination('.gitignore'), '.gitignore')
        self.assertIsNone(r.destination('.github/workflows/example.yml'))
    def test_original_readme_is_not_lost(self):
        self.assertEqual(r.destination('README.md'), '.archive/yagodka-client/README.original.md')
    def test_rejects_path_injection(self):
        with self.assertRaises(ValueError): r.launcher('../evil', 'a'*40, 'b'*40)
    def test_rejects_noncommit_and_invalid_blob(self):
        for ref, sha in (('main','a'*40),('a'*40,'$(touch bad)'),('a'*39,'b'*40)):
            with self.assertRaises(ValueError): r.launcher('vpn/vpn.sh',ref,sha)
    def test_fixed_args_and_no_privileged_commands(self):
        text=r.launcher('vpn/vpn.sh','a'*40,'b'*40)
        self.assertNotIn('sudo ',text)
        self.assertNotIn('chmod ',text)
        self.assertNotIn('chown ',text)
        self.assertNotIn(' --insecure',text)
        self.assertIn('unset BASH_ENV ENV CDPATH PERL5OPT',text)


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='layout-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.payload=self.root/'payload.sh'
        self.http=self.root/'fake-curl'
        self.http.write_text('#!/bin/bash\nset -eu\nout=\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = -o ]; then shift; out=$1; fi\n shift\ndone\n/bin/cp '+str(self.payload)+' "$out"\n')
        self.http.chmod(0o700)
    def make(self,data,expected=None):
        self.payload.write_bytes(data)
        return r.launcher('diagnostics/st.sh','a'*40,expected or blob(data)).replace('/usr/bin/curl',str(self.http))
    def remote(self,data,expected=None,args=()):
        return subprocess.run(['/bin/bash','-s','--',*args],input=self.make(data,expected).encode(),cwd=self.root,capture_output=True,timeout=10)
    def test_remote_complete_payload_runs(self):
        p=self.remote(b"printf 'FIXTURE_READY\\n'\n")
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,b'FIXTURE_READY\n')
    def test_remote_arguments_are_preserved(self):
        p=self.remote(b"printf '<%s>\\n' \"$@\"\n",args=('hello world','--offline',''))
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,b'<hello world>\n<--offline>\n<>\n')
    def test_remote_cwd_is_preserved(self):
        p=self.remote(b'pwd -P\n');self.assertEqual(p.stdout.strip().decode(),str(self.root))
    def test_warn_status_preserved(self): self.assertEqual(self.remote(b'exit 2\n').returncode,2)
    def test_failure_status_preserved(self): self.assertEqual(self.remote(b'exit 7\n').returncode,7)
    def test_cancel_status_preserved(self): self.assertEqual(self.remote(b'exit 130\n').returncode,130)
    def test_altered_download_never_runs(self):
        p=self.remote(b"echo SHOULD_NOT_RUN\n",expected='0'*40)
        self.assertEqual(p.returncode,1);self.assertNotIn(b'SHOULD_NOT_RUN',p.stdout)
    def test_empty_download_rejected(self): self.assertEqual(self.remote(b'').returncode,1)
    def test_oversize_download_rejected(self): self.assertEqual(self.remote(b'#'*1048577).returncode,1)
    def test_matching_hash_but_invalid_bash_rejected(self):
        p=self.remote(b'echo SHOULD_NOT_RUN\nif\n')
        self.assertEqual(p.returncode,1);self.assertNotIn(b'SHOULD_NOT_RUN',p.stdout)
    def test_download_error_never_executes(self):
        self.http.write_text('#!/bin/bash\nexit 35\n')
        p=self.remote(b'echo SHOULD_NOT_RUN\n')
        self.assertEqual(p.returncode,1);self.assertNotIn(b'SHOULD_NOT_RUN',p.stdout)
    def test_incomplete_wrapper_does_not_launch(self):
        text=self.make(b'echo SHOULD_NOT_RUN\n').rsplit('\ncomponent_entry "$@"',1)[0]+'\n'
        p=subprocess.run(['/bin/bash'],input=text.encode(),capture_output=True,cwd=self.root,timeout=10)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,b'')
    def test_local_offline_dispatch_avoids_curl(self):
        target=self.root/'diagnostics/st.sh';target.parent.mkdir();target.write_text('printf "LOCAL <%s>\\n" "$@"\n')
        launcher=self.root/'st.sh';launcher.write_text(self.make(b'echo REMOTE\n'))
        self.http.write_text('#!/bin/bash\nexit 99\n')
        p=subprocess.run(['/bin/bash',str(launcher),'--offline','profile'],capture_output=True,cwd=self.root,timeout=10)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,b'LOCAL <--offline>\nLOCAL <profile>\n')
    def test_local_failure_status_propagates(self):
        target=self.root/'diagnostics/st.sh';target.parent.mkdir();target.write_text('exit 3\n')
        launcher=self.root/'st.sh';launcher.write_text(self.make(b'exit 0\n'))
        p=subprocess.run(['/bin/bash',str(launcher)],capture_output=True,cwd=self.root,timeout=10)
        self.assertEqual(p.returncode,3)
    def test_symlink_local_target_not_used(self):
        target=self.root/'diagnostics/st.sh';target.parent.mkdir();target.symlink_to(self.payload)
        launcher=self.root/'st.sh';launcher.write_text(self.make(b'exit 0\n'))
        self.http.write_text('#!/bin/bash\nexit 35\n')
        p=subprocess.run(['/bin/bash',str(launcher)],capture_output=True,cwd=self.root,timeout=10)
        self.assertEqual(p.returncode,1)
    def test_three_generated_scripts_parse(self):
        for name,target in r.PRIMARY.items():
            text=r.launcher(target,'a'*40,'b'*40)
            p=subprocess.run(['/bin/bash','-n'],input=text.encode(),capture_output=True)
            self.assertEqual(p.returncode,0,(name,p.stderr))

if __name__=='__main__': unittest.main(verbosity=2)
