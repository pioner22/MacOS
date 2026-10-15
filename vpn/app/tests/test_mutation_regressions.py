"""Regression tests motivated by surviving mutants; no macOS/network required.

Signing/notarization are controlled test doubles. These tests enforce that the
orchestrator honors their results, NOT that the real cryptography works.
"""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import release_support as r
import build_release as b
import smoke_test_app as s

KEY = base64.b64encode(bytes(range(32))).decode()
SIG = base64.b64encode(bytes(range(64))).decode()
SETTINGS = json.loads((ROOT / 'release.json').read_text())


class MetadataRegressionTests(unittest.TestCase):
    def test_accepted_build_endpoints(self):
        for number in (1, 2, 2147483647):
            value = dict(SETTINGS, build=number)
            self.assertEqual(r.validate_settings(value)['build'], number)

    def test_public_entrypoints_validate_settings(self):
        for function in (lambda value: r.make_info(value, KEY), r.archive_name, r.release_tag):
            for value in (dict(SETTINGS, feed_url='https://example.net/feed'), dict(SETTINGS, build=0)):
                with self.subTest(function=function, value=value), self.assertRaises(ValueError):
                    function(value)

    def test_info_security_values_are_independent_of_generator(self):
        info = r.make_info(SETTINGS, KEY)
        expected = {'NSHighResolutionCapable': True, 'VPNReleaseBuild': True,
                    'SURequireSignedFeed': True, 'SUVerifyUpdateBeforeExtraction': True,
                    'SUSignedFeedFailureExpirationInterval': 0,
                    'SUEnableAutomaticChecks': False, 'SUAutomaticallyUpdate': False,
                    'SUAllowsAutomaticUpdates': False, 'SUEnableSystemProfiling': False,
                    'SUEnableJavaScript': False, 'SUShowReleaseNotes': True}
        for field, value in expected.items():
            with self.subTest(field=field):
                self.assertEqual(info[field], value)
                self.assertEqual(type(info[field]), type(value))

    def test_two_value_key_is_valid(self):
        key = base64.b64encode(b'\0'*31+b'\x01').decode()
        self.assertEqual(r.make_info(SETTINGS, key)['SUPublicEDKey'], key)

    def test_bad_rss_structure_is_rejected(self):
        for data in (b'<other><channel/></other>', b'<rss/>', b'<rss><channel/><channel/></rss>'):
            with self.subTest(data=data), self.assertRaises(ValueError): r.read_appcast(data)

    def test_feed_exact_size_limit(self):
        prefix, suffix = b'<rss><channel><!--', b'--></channel></rss>'
        data = prefix+b'x'*(1048576-len(prefix)-len(suffix))+suffix
        self.assertEqual(r.read_appcast(data).tag, 'rss')

    def test_feed_build_validation_boundaries(self):
        template = '<rss xmlns:sparkle="%s"><channel><item><sparkle:version>%%s</sparkle:version></item></channel></rss>' % r.SPARKLE
        for value in ('0', '01', '-1', '2147483648', 'abc', ''):
            with self.subTest(value=value), self.assertRaises(ValueError):
                r.appcast_builds((template % value).encode())
        self.assertEqual(r.appcast_builds((template % '2147483647').encode()), [2147483647])

    def test_notes_limit_is_utf8_bytes_and_inclusive(self):
        for notes in ('x'*65536, 'я'*32768):
            r.validate_next_release(SETTINGS, notes)
        with self.assertRaises(ValueError): r.validate_next_release(SETTINGS, 'я'*32769)

    def test_archive_size_boundaries_are_inclusive(self):
        for size in (1, 512*1024*1024):
            data = r.make_appcast(SETTINGS, size, SIG, 'notes')
            item = r.read_appcast(data).find('./channel/item/enclosure')
            self.assertEqual(int(item.get('length')), size)

    def test_noncanonical_base64_rejected(self):
        self.assertTrue(r.valid_base64(KEY, 32))
        self.assertFalse(r.valid_base64(KEY+'\n', 32))
        # Change unused pad bits: decodes to the same bytes, not canonical Base64.
        alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        alt = KEY[:-2]+alphabet[alphabet.index(KEY[-2])+1]+'='
        self.assertEqual(base64.b64decode(alt), base64.b64decode(KEY))
        self.assertFalse(r.valid_base64(alt, 32))

    def test_nonroot_linux_build_still_rejected(self):
        with mock.patch.object(b.sys, 'platform', 'linux'), mock.patch.object(b.os, 'geteuid', return_value=501):
            with self.assertRaises(ValueError): b.require_mac()

    def test_existing_output_symlink_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)/'link'; p.symlink_to(Path(directory)/'missing')
            with self.assertRaises(ValueError): b.ensure_new_output(p)
            self.assertTrue(p.is_symlink())


    def test_next_release_checks_settings_directly(self):
        with self.assertRaises(ValueError): r.validate_next_release(dict(SETTINGS,build=0), 'notes')

    def test_copy_bundle_preserves_platform_copy_tool(self):
        with mock.patch.object(b,'run') as run:
            b.copy_bundle(Path('/fixture/source'),Path('/fixture/target'))
        run.assert_called_once_with(['/usr/bin/ditto',Path('/fixture/source'),Path('/fixture/target')])

    def test_signer_tool_must_exist_and_be_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);tool=root/'sign_update'
            with self.assertRaises(ValueError):b.tool_at(root,'sign_update')
            tool.write_text('fixture');tool.chmod(0o600)
            with self.assertRaises(ValueError):b.tool_at(root,'sign_update')
            tool.chmod(0o700)
            self.assertEqual(b.tool_at(root,'sign_update'),tool)


class BuildPipelineRegressionTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.source = self.root/'source'; self.source.mkdir()
        (self.source/'release.json').write_text(json.dumps(SETTINGS))
        (self.source/'Resources').mkdir()
        (self.source/'Resources/refresh_legacy_subscription.py').write_text('# fixture bridge\n')
        self.bin = self.source/'bin'; self.bin.mkdir()
        (self.bin/'BigSurVPNApp').write_bytes(b'fixture-not-Mach-O')
        self.framework = self.source/'.build/artifacts/Sparkle.framework'
        for name in ('Versions/B/XPCServices/Downloader.xpc', 'Versions/B/XPCServices/InstallerLauncher.xpc', 'Versions/B/Updater.app'):
            (self.framework/name).mkdir(parents=True)
        (self.framework/'Versions/B/Autoupdate').write_text('fixture')
        (self.framework/'Sparkle').write_text('fixture')
        self.calls = []
        def run(args, timeout=900):
            args = [str(a) for a in args]; self.calls.append(args)
            if '--show-bin-path' in args: return str(self.bin)
            if 'vtool' in args: return '    minos 11.0\n'
            return ''
        self.run = self.stack.enter_context(mock.patch.object(b, 'run', side_effect=run))
        self.required = self.stack.enter_context(mock.patch.object(b, 'require_mac'))
        self.stack.enter_context(mock.patch.object(b, 'ROOT', self.source))
        self.stack.enter_context(mock.patch.dict(os.environ, {'SPARKLE_PUBLIC_KEY': ''}))
        self.stack.enter_context(mock.patch.object(b, 'copy_bundle', side_effect=lambda src,dst: shutil.copytree(src,dst)))
        self.args = type('Args', (), {'development': True, 'identity': None, 'output': str(self.root/'out/BigSurVPN.app')})()

    def execute(self):
        with contextlib.redirect_stdout(io.StringIO()): b.build(self.args)

    def test_build_runs_tests_signing_architecture_and_deployment_checks(self):
        self.execute(); self.required.assert_called_once()
        self.assertTrue(Path(self.args.output).is_dir())
        self.assertIn(['/usr/bin/xcrun', 'swift', 'test'], self.calls)
        self.assertTrue(any('--product' in c and 'BigSurVPNApp' in c for c in self.calls))
        self.assertEqual(len([c for c in self.calls if 'vtool' in c]), 2)
        self.assertEqual(len([c for c in self.calls if c[0]=='/usr/bin/codesign' and '--sign' in c]), 6)
        self.assertTrue(any('--verify' in c and '--strict' in c for c in self.calls))
        self.assertTrue(any('-verify_arch' in c and 'x86_64' in c for c in self.calls))

    def test_subscription_bridge_is_bundled_before_signing(self):
        self.execute()
        self.assertEqual((Path(self.args.output)/'Contents/Resources/refresh_legacy_subscription.py').read_text(), '# fixture bridge\n')

    def test_failed_signing_prevents_publishing_app(self):
        original = self.run.side_effect
        def failed(args, **kwargs):
            if str(args[0])=='/usr/bin/codesign': raise subprocess.CalledProcessError(1,['codesign'])
            return original(args, **kwargs)
        self.run.side_effect=failed
        with self.assertRaises(subprocess.CalledProcessError): self.execute()
        self.assertFalse(Path(self.args.output).exists())

    def test_newer_framework_prevents_build(self):
        original = self.run.side_effect
        def newer(args, **kwargs):
            if 'vtool' in args and 'Frameworks' in str(args[-1]): return '    minos 12.0\n'
            return original(args, **kwargs)
        self.run.side_effect=newer
        with self.assertRaises(ValueError): self.execute()
        self.assertFalse(Path(self.args.output).exists())


    def test_production_signing_requires_runtime_and_timestamp(self):
        self.args.development=False;self.args.identity='Developer ID Application: Fixture (ABCDE12345)'
        with mock.patch.dict(os.environ,{'SPARKLE_PUBLIC_KEY':KEY}):self.execute()
        signs=[c for c in self.calls if c[0]=='/usr/bin/codesign' and '--sign' in c]
        self.assertEqual(len(signs),6)
        for c in signs:self.assertIn('runtime',c);self.assertIn('--timestamp',c)

    def test_production_rejects_non_developer_id_identity(self):
        self.args.development=False;self.args.identity='Ad Hoc'
        with mock.patch.dict(os.environ,{'SPARKLE_PUBLIC_KEY':KEY}),self.assertRaises(ValueError):self.execute()
        self.assertFalse(Path(self.args.output).exists())

    def test_missing_signing_component_aborts(self):
        (self.framework/'Versions/B/Autoupdate').unlink()
        with self.assertRaises(ValueError):self.execute()
        self.assertFalse(Path(self.args.output).exists())

    def test_ambiguous_framework_artifacts_aborted(self):
        (self.source/'.build/artifacts/duplicate/Sparkle.framework').mkdir(parents=True)
        with self.assertRaises(ValueError):self.execute()
        self.assertFalse(Path(self.args.output).exists())

    def test_development_bundle_explicitly_labelled(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:b.build(self.args)
        self.assertIn('DEVELOPMENT ONLY',out.getvalue())


class PreparePipelineRegressionTests(unittest.TestCase):
    def setUp(self):
        self.stack=contextlib.ExitStack(); self.addCleanup(self.stack.close)
        self.root=Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.app=self.root/'BigSurVPN.app'
        (self.app/'Contents').mkdir(parents=True)
        (self.app/'Contents/Info.plist').write_bytes(plistlib.dumps(r.make_info(SETTINGS, KEY)))
        self.tools=self.root/'tools'; self.tools.mkdir()
        for name in ('generate_keys','sign_update'):
            p=self.tools/name; p.write_bytes(b'test-double'); p.chmod(0o700)
        self.notes=self.root/'notes.txt'; self.notes.write_text('Test update')
        self.args=type('Args',(),dict(app=str(self.app),sparkle_tools=str(self.tools),team_id='ABCDE12345',
            notes=str(self.notes),previous_feed=None,notary_profile='TEST-ONLY',output=str(self.root/'prepared')))()
        self.calls=[]; self.reject=None; self.notary_status='Accepted'; self.key=KEY; self.signature=SIG
        self.required=self.stack.enter_context(mock.patch.object(b,'require_mac'))
        self.stack.enter_context(mock.patch.object(b,'copy_bundle',side_effect=lambda src,dst: shutil.copytree(src,dst)))
        def run(args,timeout=900):
            args=[str(a) for a in args];self.calls.append(args)
            if self.reject and self.reject(args): raise subprocess.CalledProcessError(1, ['mocked-tool'])
            if args[0].endswith('/generate_keys'): return self.key
            if 'vtool' in args: return '    minos 11.0\n'
            if 'notarytool' in args:
                self.assertTrue(Path(args[3]).is_file(), 'submission archive was not created')
                return json.dumps({'status':self.notary_status})
            if args[0]=='/usr/bin/ditto': Path(args[-1]).write_bytes(b'NOT-A-REAL-UPDATE-ARCHIVE'); return ''
            if args[0].endswith('/sign_update') and '-p' in args: return self.signature
            return ''
        self.stack.enter_context(mock.patch.object(b,'run',side_effect=run))

    def execute(self):
        with contextlib.redirect_stdout(io.StringIO()): b.prepare(self.args)

    def assert_failed(self,exc=ValueError):
        with self.assertRaises(exc): self.execute()
        self.assertFalse(Path(self.args.output).exists())

    def test_success_requires_all_external_validation_stages(self):
        self.execute(); self.required.assert_called_once()
        self.assertTrue(any('notarytool' in c for c in self.calls))
        self.assertEqual(len([c for c in self.calls if 'vtool' in c]),2)
        self.assertTrue(any('-verify_arch' in c and 'x86_64' in c for c in self.calls))
        self.assertTrue(any('stapler' in c and 'staple' in c for c in self.calls))
        self.assertTrue(any('stapler' in c and 'validate' in c for c in self.calls))
        self.assertTrue(any(c[0]=='/usr/sbin/spctl' for c in self.calls))
        signs=[c for c in self.calls if c[0].endswith('/sign_update')]
        self.assertTrue(any('--verify' in c and c[-2].endswith('.zip') for c in signs))
        self.assertTrue(any('--verify' in c and c[-1].endswith('appcast.xml') for c in signs))
        self.assertTrue(any('--verify' not in c and c[-1].endswith('appcast.xml') for c in signs))
        self.assertEqual(len([c for c in self.calls if c[0]=='/usr/bin/codesign' and '-R' in c]),2)
        data=json.loads((Path(self.args.output)/'release.json').read_text())
        self.assertFalse(data['published']); self.assertTrue(data['requires_real_update_smoke_test'])

    def test_mismatching_update_key_aborts(self):
        self.key=base64.b64encode(b'z'*32).decode(); self.assert_failed()

    def test_rejected_notarization_aborts(self):
        self.notary_status='Invalid'; self.assert_failed()

    def test_nonaccepted_notarization_aborts(self):
        self.notary_status='In Progress'; self.assert_failed()

    def test_malformed_signature_aborts(self):
        self.signature='invalid'; self.assert_failed()

    def test_archive_verification_failure_aborts(self):
        self.reject=lambda c: c[0].endswith('/sign_update') and '--verify' in c and c[-2].endswith('.zip')
        self.assert_failed(subprocess.CalledProcessError)

    def test_feed_verification_failure_aborts(self):
        self.reject=lambda c: c[0].endswith('/sign_update') and '--verify' in c and c[-1].endswith('appcast.xml')
        self.assert_failed(subprocess.CalledProcessError)

    def test_gatekeeper_failure_aborts(self):
        self.reject=lambda c: c[0]=='/usr/sbin/spctl'; self.assert_failed(subprocess.CalledProcessError)

    def test_stapling_failure_aborts(self):
        self.reject=lambda c: 'stapler' in c and 'staple' in c; self.assert_failed(subprocess.CalledProcessError)

    def test_source_code_signature_failure_aborts(self):
        self.reject=lambda c: c[0]=='/usr/bin/codesign' and str(self.app) in c
        self.assert_failed(subprocess.CalledProcessError)

    def test_previous_feed_signature_failure_aborts(self):
        previous=self.root/'previous.xml'; previous.write_bytes(b'<rss><channel/></rss>');self.args.previous_feed=str(previous)
        self.reject=lambda c: c[0].endswith('/sign_update') and '--verify' in c and str(previous) in c
        self.assert_failed(subprocess.CalledProcessError)

    def test_bad_team_identifier_aborts(self):
        self.args.team_id='INVALID'; self.assert_failed()


    def test_existing_empty_output_is_not_replaced(self):
        output=Path(self.args.output);output.mkdir();inode=output.stat().st_ino
        with self.assertRaises(ValueError):self.execute()
        self.assertEqual(output.stat().st_ino,inode)

    def test_wrong_source_application_name_aborts(self):
        wrong=self.root/'Other.app';self.app.rename(wrong);self.args.app=str(wrong)
        self.assert_failed()

    def test_bad_notes_rejected_before_notarization(self):
        self.notes.write_text('')
        self.assert_failed()
        self.assertFalse(any('notarytool' in c for c in self.calls))


class SmokeLifecycleRegressionTests(unittest.TestCase):
    """All subprocess/OS signals are doubles; files and size checks are real."""
    def setUp(self):
        self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.root=Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.app=self.root/'BigSurVPN.app';self.exe=self.app/'Contents/MacOS/BigSurVPNApp'
        self.exe.parent.mkdir(parents=True);self.exe.write_text('fixture');self.exe.chmod(0o700)
        (self.app/'Contents/Info.plist').write_bytes(plistlib.dumps(r.make_info(SETTINGS,development=True)))
        self.stack.enter_context(mock.patch.object(s.sys,'platform','darwin'))
        self.stack.enter_context(mock.patch.object(s.os,'geteuid',return_value=501))
        self.stack.enter_context(mock.patch.object(s.platform,'mac_ver',return_value=('15.0',('', '', ''),'')))
        self.stack.enter_context(mock.patch.object(s.platform,'machine',return_value='x86_64'))
        self.kill=self.stack.enter_context(mock.patch.object(s.os,'killpg'))
        self.stack.enter_context(mock.patch.object(s.time,'sleep'))
        self.stdout=(s.MARKER+'\n').encode();self.stderr=b'';self.delayed=False;self.returncode=0
        self.clock=0
        def monotonic(): self.clock+=1;return float(self.clock)
        self.stack.enter_context(mock.patch.object(s.time,'monotonic',side_effect=monotonic))
        test=self
        class Process:
            pid=999999
            def __init__(self): self.polls=0;self.returncode=test.returncode
            def poll(self):
                self.polls+=1
                return None if test.delayed and self.polls<=5 else self.returncode
            def wait(self,timeout=None): self.polls=6;return self.returncode
        def launch(args,**kw):
            kw['stdout'].write(self.stdout);kw['stdout'].flush()
            kw['stderr'].write(self.stderr);kw['stderr'].flush()
            self.process=Process();return self.process
        self.launch=self.stack.enter_context(mock.patch.object(s.subprocess,'Popen',side_effect=launch))

    def test_simulated_success_never_claims_vpn_or_big_sur_tested(self):
        result=s.smoke(self.app)
        self.assertEqual(result['result'],'PASS')
        self.assertFalse(result['vpn_connection_tested'])
        self.assertFalse(result['big_sur_runtime_tested'])
        self.assertTrue(result['updater_disabled'])
        self.assertEqual(result['host_macos'],'15.0')
        kw=self.launch.call_args.kwargs
        self.assertTrue(kw['start_new_session'])
        self.assertEqual(kw['stdin'],subprocess.DEVNULL)
        self.assertEqual(kw['env']['BIGSURVPN_SMOKE_TEST'],'1')
        self.assertNotEqual(kw['env']['HOME'],str(Path.home()))

    def test_simulated_big_sur_report_is_explicit(self):
        with mock.patch.object(s.platform,'mac_ver',return_value=('11.7.10',('', '', ''),'')):
            self.assertTrue(s.smoke(self.app)['big_sur_runtime_tested'])

    def test_timeout_aborts_and_stops_process(self):
        self.delayed=True
        with self.assertRaises(ValueError): s.smoke(self.app,timeout=0)
        self.kill.assert_called_once_with(999999,s.signal.SIGTERM)

    def test_output_limit_during_execution(self):
        self.delayed=True;self.stdout=b'x'*(s.LIMIT+1)
        with self.assertRaises(ValueError): s.smoke(self.app)
        self.kill.assert_called_once()

    def test_stderr_limit_during_execution(self):
        self.delayed=True;self.stderr=b'x'*(s.LIMIT+1)
        with self.assertRaises(ValueError): s.smoke(self.app)
        self.kill.assert_called_once()

    def test_output_limit_after_execution(self):
        self.stdout=(s.MARKER+'\n').encode()+b'x'*(s.LIMIT+1)
        with self.assertRaises(ValueError): s.smoke(self.app)

    def test_exact_stdout_limit_is_allowed(self):
        self.stdout=(s.MARKER+'\n').encode()+b'x'*(s.LIMIT-len(s.MARKER)-1)
        self.delayed=True
        self.assertEqual(s.smoke(self.app)['result'],'PASS')

    def test_missing_marker_not_pass(self):
        self.stdout=b'not-the-window-marker'
        with self.assertRaises(ValueError): s.smoke(self.app)

    def test_stop_kills_stubborn_process_group(self):
        p=mock.Mock(pid=999999);p.poll.return_value=None
        p.wait.side_effect=[subprocess.TimeoutExpired('fake',2),0]
        s.stop_process(p)
        self.assertEqual(self.kill.call_args_list,[mock.call(999999,s.signal.SIGTERM),mock.call(999999,s.signal.SIGKILL)])
        self.assertEqual(p.wait.call_args_list,[mock.call(timeout=2),mock.call(timeout=5)])

    def test_exited_process_not_signalled(self):
        p=mock.Mock();p.poll.return_value=0
        s.stop_process(p);self.kill.assert_not_called();p.wait.assert_not_called()

    def test_root_rejected_before_validation(self):
        with mock.patch.object(s.os,'geteuid',return_value=0),mock.patch.object(s,'validate_app') as valid:
            with self.assertRaises(ValueError):s.smoke(self.app)
            valid.assert_not_called();self.launch.assert_not_called()

    def test_linux_nonroot_rejected_before_validation(self):
        with mock.patch.object(s.sys,'platform','linux'),mock.patch.object(s,'validate_app') as valid:
            with self.assertRaises(ValueError):s.smoke(self.app)
            valid.assert_not_called();self.launch.assert_not_called()

    def test_timeout_boundary_stops_at_deadline(self):
        self.delayed=True
        with self.assertRaises(ValueError):s.smoke(self.app,timeout=1)
        self.assertEqual(self.clock,2)

    def test_exact_stderr_limit_is_allowed(self):
        self.stderr=b'x'*s.LIMIT;self.delayed=True
        self.assertEqual(s.smoke(self.app)['result'],'PASS')

    def test_exited_app_cannot_bypass_stderr_limit(self):
        self.stderr=b'x'*(s.LIMIT+1)
        self.delayed=False
        with self.assertRaisesRegex(ValueError,'bounded log size'):
            s.smoke(self.app)
