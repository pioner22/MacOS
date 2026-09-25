"""Release metadata and appcast validation; no networking or installation.

Cryptographic verification belongs to Sparkle's sign_update and runtime.
The checks here prevent common packaging mistakes, not forged signatures.
"""
import base64
import binascii
import datetime
import re
import xml.etree.ElementTree as ET

BUNDLE_ID = 'ru.pioner22.BigSurVPN'
FEED = 'https://raw.githubusercontent.com/pioner22/MacOS/main/vpn-app/updates/appcast.xml'
RELEASES = 'https://github.com/pioner22/MacOS/releases/download/'
SPARKLE = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
KEY_ACCOUNT = 'ru.pioner22.BigSurVPN.updates'
ET.register_namespace('sparkle', SPARKLE)


def valid_base64(value, length):
    try:
        decoded = base64.b64decode(value, validate=True)
        return len(decoded) == length and base64.b64encode(decoded).decode('ascii') == value
    except (binascii.Error, TypeError, ValueError, UnicodeError):
        return False


def validate_settings(s):
    if not isinstance(s, dict) or s.get('bundle_id') != BUNDLE_ID or s.get('feed_url') != FEED:
        raise ValueError('Wrong application identity or update feed')
    if not isinstance(s.get('version'), str) or not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', s['version']):
        raise ValueError('Version must be a stable major.minor.patch value')
    if type(s.get('build')) is not int or not 1 <= s['build'] <= 2147483647:
        raise ValueError('Build must be a positive integer <= 2147483647')
    if s.get('minimum_system_version') != '11.0.0' or s.get('architecture') != 'x86_64':
        raise ValueError('This release line must keep Big Sur 11 / Intel support')
    return s


def make_info(s, public_key='', development=False):
    validate_settings(s)
    if not development and (not valid_base64(public_key, 32) or len(set(base64.b64decode(public_key))) < 2):
        raise ValueError('A real Ed25519 public key is required for release builds')
    return {
        'CFBundleIdentifier': BUNDLE_ID,
        'CFBundleName': 'BigSurVPN',
        'CFBundleDisplayName': 'BigSurVPN',
        'CFBundleExecutable': 'BigSurVPNApp',
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': s['version'],
        'CFBundleVersion': str(s['build']),
        'CFBundleDevelopmentRegion': 'ru',
        'LSMinimumSystemVersion': s['minimum_system_version'],
        'NSPrincipalClass': 'NSApplication',
        'NSHighResolutionCapable': True,
        'VPNReleaseBuild': not development,
        'SUFeedURL': FEED,
        'SUPublicEDKey': public_key,
        'SUVerifyUpdateBeforeExtraction': True,
        'SURequireSignedFeed': True,
        'SUSignedFeedFailureExpirationInterval': 0,
        'SUEnableAutomaticChecks': False,
        'SUAutomaticallyUpdate': False,
        'SUAllowsAutomaticUpdates': False,
        'SUEnableSystemProfiling': False,
        'SUEnableJavaScript': False,
        'SUShowReleaseNotes': True,
    }


def settings_from_info(info):
    s = {
        'bundle_id': info.get('CFBundleIdentifier'),
        'feed_url': info.get('SUFeedURL'),
        'version': info.get('CFBundleShortVersionString'),
        'build': int(info.get('CFBundleVersion', '0')),
        'minimum_system_version': info.get('LSMinimumSystemVersion'),
        'architecture': 'x86_64',
    }
    expected = make_info(s, info.get('SUPublicEDKey', ''))
    if any(info.get(key) != value for key, value in expected.items()):
        raise ValueError('App is not a configured release build')
    return s


def archive_name(settings):
    validate_settings(settings)
    return 'BigSurVPN-%s-%s-macos-intel.zip' % (settings['version'], settings['build'])


def release_tag(settings):
    validate_settings(settings)
    return 'vpn-app-v%s-build%s' % (settings['version'], settings['build'])


def read_appcast(data):
    if not isinstance(data, bytes) or len(data) > 1024 * 1024:
        raise ValueError('Appcast must be <= 1 MiB')
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('DTD/entity declarations are forbidden')
    root = ET.fromstring(data)
    if root.tag != 'rss' or len(root.findall('channel')) != 1:
        raise ValueError('Expected a single RSS channel')
    return root


def appcast_builds(data):
    builds = []
    for item in read_appcast(data).findall('./channel/item'):
        text = item.findtext('{%s}version' % SPARKLE, '')
        if not re.fullmatch(r'[1-9][0-9]{0,9}', text) or int(text) > 2147483647:
            raise ValueError('Invalid appcast build number')
        builds.append(int(text))
    if len(set(builds)) != len(builds):
        raise ValueError('Duplicate build number')
    return builds


def validate_next_release(settings, notes, previous=None):
    validate_settings(settings)
    if not isinstance(notes, str) or not notes.strip() or len(notes.encode('utf-8')) > 65536:
        raise ValueError('Release notes must be nonempty and <= 64 KiB')
    if previous is not None:
        builds = appcast_builds(previous)
        if builds and settings['build'] <= max(builds):
            raise ValueError('Build must increase; downgrades/reused numbers are forbidden')


def validate_macho_minimum(text):
    versions = re.findall(r'(?m)^\s*minos\s+(\d+(?:\.\d+){0,2})\s*$', text)
    if not versions:
        raise ValueError('Mach-O deployment target could not be verified')
    for value in versions:
        parts = tuple(int(x) for x in value.split('.'))
        parts += (0,) * (3 - len(parts))
        if parts > (11, 0, 0):
            raise ValueError('Mach-O requires newer than Big Sur 11.0: ' + value)


def make_appcast(settings, size, signature, notes, previous=None):
    validate_next_release(settings, notes, previous)
    if type(size) is not int or not 0 < size <= 512 * 1024 * 1024:
        raise ValueError('Archive must be 1 byte..512 MiB')
    if not valid_base64(signature, 64):
        raise ValueError('Missing Ed25519 archive signature')
    if previous is not None:
        root = read_appcast(previous)
        channel = root.find('channel')
    else:
        root = ET.Element('rss', {'version': '2.0'})
        channel = ET.SubElement(root, 'channel')
        ET.SubElement(channel, 'title').text = 'BigSurVPN — обновления'
        ET.SubElement(channel, 'link').text = 'https://github.com/pioner22/MacOS'
        ET.SubElement(channel, 'description').text = 'Подписанные обновления приложения BigSurVPN'
        ET.SubElement(channel, 'language').text = 'ru'
    item = ET.Element('item')
    ET.SubElement(item, 'title').text = 'BigSurVPN %s' % settings['version']
    ET.SubElement(item, '{%s}version' % SPARKLE).text = str(settings['build'])
    ET.SubElement(item, '{%s}shortVersionString' % SPARKLE).text = settings['version']
    ET.SubElement(item, '{%s}minimumSystemVersion' % SPARKLE).text = settings['minimum_system_version']
    ET.SubElement(item, 'pubDate').text = datetime.datetime.now(datetime.timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')
    ET.SubElement(item, 'description', {'{%s}format' % SPARKLE: 'plain-text'}).text = notes
    ET.SubElement(item, 'enclosure', {
        'url': RELEASES + release_tag(settings) + '/' + archive_name(settings),
        'length': str(size), 'type': 'application/octet-stream',
        '{%s}edSignature' % SPARKLE: signature,
    })
    channel.insert(0, item)
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)
