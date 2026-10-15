"""Offline metadata tests, not a substitute for a real Sparkle N -> N+1 install."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import release_support as r
import build_release as b

KEY = base64.b64encode(bytes(range(32))).decode()
SIG = base64.b64encode(bytes(range(64))).decode()  # fixture only, NOT a valid signature


class ReleaseTests(unittest.TestCase):
    def settings(self):
        return json.loads((ROOT / 'release.json').read_text())

    def feed(self, settings=None, previous=None, notes='Исправления и улучшения.'):
        return r.make_appcast(settings or self.settings(), 100, SIG, notes, previous)

    def test_release_info_roundtrip(self):
        info = plistlib.loads(plistlib.dumps(r.make_info(self.settings(), KEY)))
        self.assertEqual(r.settings_from_info(info), self.settings())

    def test_development_has_no_active_updater(self):
        info = r.make_info(self.settings(), development=True)
        self.assertFalse(info['VPNReleaseBuild'])
        with self.assertRaises(ValueError): r.settings_from_info(info)

    def test_release_without_key_rejected(self):
        with self.assertRaises(ValueError): r.make_info(self.settings())

    def test_dummy_key_rejected(self):
        with self.assertRaises(ValueError): r.make_info(self.settings(), base64.b64encode(bytes(32)).decode())

    def test_insecure_release_info_rejected(self):
        for key, value in [('SURequireSignedFeed', False), ('SUVerifyUpdateBeforeExtraction', False),
                           ('SUAllowsAutomaticUpdates', True), ('SUEnableJavaScript', True),
                           ('SUSignedFeedFailureExpirationInterval', 20)]:
            with self.subTest(key=key):
                info = r.make_info(self.settings(), KEY); info[key] = value
                with self.assertRaises(ValueError): r.settings_from_info(info)

    def test_wrong_feed_rejected(self):
        settings = self.settings(); settings['feed_url'] = 'http://example.com/feed.xml'
        with self.assertRaises(ValueError): r.validate_settings(settings)

    def test_wrong_bundle_rejected(self):
        settings = self.settings(); settings['bundle_id'] = 'org.example.app'
        with self.assertRaises(ValueError): r.validate_settings(settings)

    def test_minimum_os_cannot_silently_increase(self):
        settings = self.settings(); settings['minimum_system_version'] = '12.0.0'
        with self.assertRaises(ValueError): r.validate_settings(settings)

    def test_arm_only_not_allowed_for_this_release_line(self):
        settings = self.settings(); settings['architecture'] = 'arm64'
        with self.assertRaises(ValueError): r.validate_settings(settings)

    def test_invalid_versions_rejected(self):
        for version in ('1', '1.0', '01.0.0', '0.1.0-beta', '0.1.0\n', '../1.0.0'):
            with self.subTest(version=version):
                settings = self.settings(); settings['version'] = version
                with self.assertRaises(ValueError): r.validate_settings(settings)

    def test_invalid_builds_rejected(self):
        for number in (0, -1, True, '1', 2147483648):
            with self.subTest(number=number):
                settings = self.settings(); settings['build'] = number
                with self.assertRaises(ValueError): r.validate_settings(settings)

    def test_feed_has_exact_download_and_signed_enclosure(self):
        settings = self.settings()
        item = r.read_appcast(self.feed()).find('./channel/item')
        enclosure = item.find('enclosure')
        self.assertEqual(enclosure.get('url'), r.RELEASES + r.release_tag(settings) + '/' + r.archive_name(settings))
        self.assertEqual(enclosure.get('{%s}edSignature' % r.SPARKLE), SIG)
        self.assertEqual(item.findtext('{%s}minimumSystemVersion' % r.SPARKLE), '11.0.0')
        self.assertEqual(r.appcast_builds(self.feed()), [1])

    def test_plain_text_release_notes_remain_data(self):
        notes = '<script>alert("test")</script>& исправления'
        item = r.read_appcast(self.feed(notes=notes)).find('./channel/item')
        self.assertEqual(item.find('description').text, notes)
        self.assertEqual(item.find('description').get('{%s}format' % r.SPARKLE), 'plain-text')
        self.assertIsNone(item.find('.//script'))

    def test_newer_build_preserves_previous_releases(self):
        settings = self.settings(); settings['build'] = 2
        updated = self.feed(settings, self.feed())
        self.assertEqual(r.appcast_builds(updated), [2, 1])

    def test_same_build_rejected(self):
        with self.assertRaises(ValueError): self.feed(previous=self.feed())

    def test_downgrade_rejected(self):
        later = self.settings(); later['build'] = 3
        with self.assertRaises(ValueError): self.feed(previous=self.feed(later))

    def test_missing_signature_rejected(self):
        with self.assertRaises(ValueError): r.make_appcast(self.settings(), 100, '', 'notes')

    def test_invalid_sizes_rejected(self):
        for size in (0, -1, True, '100', 512 * 1024 * 1024 + 1):
            with self.assertRaises(ValueError): r.make_appcast(self.settings(), size, SIG, 'notes')

    def test_empty_or_oversized_notes_rejected(self):
        for notes in ('', '  ', 'x' * 65537):
            with self.assertRaises(ValueError): self.feed(notes=notes)

    def test_dtd_and_entities_rejected(self):
        for content in (b'<!DOCTYPE rss><rss><channel/></rss>',
                        b'<!ENTITY x "test"><rss><channel/></rss>'):
            with self.assertRaises(ValueError): r.read_appcast(content)

    def test_oversized_feed_rejected(self):
        with self.assertRaises(ValueError): r.read_appcast(b'x' * (1024 * 1024 + 1))

    def test_unsigned_placeholder_is_not_checked_in_as_real_feed(self):
        self.assertFalse((ROOT / 'updates/appcast.xml').exists())

    def test_duplicate_feed_versions_rejected(self):
        data = self.feed(); root = r.read_appcast(data)
        channel = root.find('channel'); channel.append(copy.deepcopy(channel.find('item')))
        with self.assertRaises(ValueError): r.appcast_builds(r.ET.tostring(root))

    def test_missing_macho_target_is_not_pass(self):
        with self.assertRaises(ValueError): r.validate_macho_minimum('unknown output')

    def test_macho_big_sur_and_older_accepted(self):
        r.validate_macho_minimum('    minos 10.13\n    minos 11.0\n')

    def test_macho_newer_target_rejected(self):
        with self.assertRaises(ValueError): r.validate_macho_minimum('    minos 12.0\n')

    def test_existing_output_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'original'; path.write_text('keep')
            with self.assertRaises(ValueError): b.ensure_new_output(path)
            self.assertEqual(path.read_text(), 'keep')

    def test_macos_required_for_build(self):
        with mock.patch.object(b.sys, 'platform', 'linux'), self.assertRaises(ValueError): b.require_mac()

    def test_root_builder_is_rejected(self):
        with mock.patch.object(b.sys, 'platform', 'darwin'), mock.patch.object(b.os, 'geteuid', return_value=0):
            with self.assertRaises(ValueError): b.require_mac()

    def test_packaging_does_not_write_legacy_vpn_state(self):
        source = (ROOT / 'tools/build_release.py').read_text()
        self.assertNotIn('launchctl', source)
        self.assertNotIn('shell=True', source)
        self.assertNotIn('chmod 777', source)
        self.assertNotIn('vpn-profile.json', source)

    def test_swift_policy_and_packager_agree_on_feed(self):
        source = (ROOT / 'Sources/UpdatePolicy/ReleaseConfiguration.swift').read_text()
        self.assertIn(r.FEED, source)
        self.assertIn(r.BUNDLE_ID, source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
