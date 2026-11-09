"""Offline smoke-gate and compiler-diagnostic tests, not native UI tests."""
import contextlib
import io
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import build_release as build
import release_support as release
import smoke_test_app as smoke


class NativeGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'BigSurVPN.app'
        self.binary = self.app / 'Contents/MacOS/BigSurVPNApp'
        self.binary.parent.mkdir(parents=True)
        self.binary.write_bytes(b'fixture, not Mach-O')
        self.binary.chmod(0o700)
        self.info = release.make_info(json.loads((ROOT / 'release.json').read_text()), development=True)
        self.save()

    def save(self):
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps(self.info))

    def test_explicit_development_bundle_allowed(self):
        self.assertEqual(smoke.validate_app(self.app), self.binary)

    def test_release_bundle_not_launched(self):
        self.info['VPNReleaseBuild'] = True; self.save()
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_missing_development_flag_rejected(self):
        del self.info['VPNReleaseBuild']; self.save()
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_unrelated_bundle_rejected(self):
        self.info['CFBundleIdentifier'] = 'org.other.app'; self.save()
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_executable_path_from_metadata_not_trusted(self):
        self.info['CFBundleExecutable'] = '/bin/sh'; self.save()
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_signing_key_not_used_by_smoke(self):
        self.info['SUPublicEDKey'] = 'not-allowed'; self.save()
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_missing_binary_rejected(self):
        self.binary.unlink()
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_nonexecutable_binary_rejected(self):
        self.binary.chmod(0o600)
        with self.assertRaises(ValueError): smoke.validate_app(self.app)

    def test_success_requires_marker_and_zero_exit(self):
        smoke.validate_result(0, smoke.MARKER + '\n')

    def test_empty_output_not_success(self):
        with self.assertRaises(ValueError): smoke.validate_result(0, '')

    def test_marker_substring_not_success(self):
        with self.assertRaises(ValueError): smoke.validate_result(0, 'prefix ' + smoke.MARKER)

    def test_duplicate_marker_not_success(self):
        with self.assertRaises(ValueError): smoke.validate_result(0, (smoke.MARKER + '\n') * 2)

    def test_crash_after_marker_not_success(self):
        with self.assertRaises(ValueError): smoke.validate_result(-11, smoke.MARKER + '\n')

    def test_linux_never_claims_native_pass(self):
        with mock.patch.object(smoke.sys, 'platform', 'linux'), mock.patch.object(smoke.subprocess, 'Popen') as launch:
            with self.assertRaises(ValueError): smoke.smoke(self.app)
            launch.assert_not_called()

    def test_root_never_launches_app(self):
        with mock.patch.object(smoke.sys, 'platform', 'darwin'), mock.patch.object(smoke.os, 'geteuid', return_value=0), mock.patch.object(smoke.subprocess, 'Popen') as launch:
            with self.assertRaises(ValueError): smoke.smoke(self.app)
            launch.assert_not_called()


class CompilerDiagnosticTests(unittest.TestCase):
    def capture(self, error):
        with contextlib.redirect_stderr(io.StringIO()) as out:
            build.report_compiler_failure(error)
        return out.getvalue()

    def test_swift_error_exposes_compiler_reason(self):
        error = subprocess.CalledProcessError(1, ['/usr/bin/xcrun', 'swift', 'build'], stderr='file.swift: error: bad type')
        self.assertIn('bad type', self.capture(error))

    def test_timeout_partial_output_supported(self):
        error = subprocess.TimeoutExpired(['/usr/bin/xcrun', 'swift', 'test'], 30, output=b'partial compiler output')
        self.assertIn('partial compiler output', self.capture(error))

    def test_signing_and_keychain_output_not_echoed(self):
        for command in (['/usr/bin/codesign'], ['/bin/sh'], ['/usr/bin/xcrun', 'notarytool']):
            self.assertEqual(self.capture(subprocess.CalledProcessError(1, command, stderr='PRIVATE-OUTPUT')), '')

    def test_command_arguments_not_echoed(self):
        error = subprocess.CalledProcessError(1, ['/usr/bin/xcrun', 'swift', 'build', 'PRIVATE-ARGUMENT'], stderr='reason')
        self.assertNotIn('PRIVATE-ARGUMENT', self.capture(error))

    def test_ansi_removed_and_output_bounded(self):
        error = subprocess.CalledProcessError(1, ['/usr/bin/xcrun', 'swift'], stderr='z' * 100000 + '\x1b[31merror\x1b[0m')
        value = self.capture(error)
        self.assertNotIn('\x1b', value)
        self.assertLess(len(value), 16100)
        self.assertIn('error', value)

    def test_unrelated_exception_not_echoed(self):
        self.assertEqual(self.capture(ValueError('PRIVATE')), '')


if __name__ == '__main__':
    unittest.main()
