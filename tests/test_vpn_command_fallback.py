#!/usr/bin/env python3
"""Offline command-path regressions. Real temporary files; no real VPN or macOS writes."""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('vpn_fallback', ROOT / 'vpn-runtime.py')
v = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)


def profile():
    return {'schema': 'bigsur-vpn-profile-v2', 'subscription': 'https://example.com/sub',
            'bootstrap': ['trojan://fixture@example.com:443?security=tls&type=tcp'],
            'socks5': {'server': '192.0.2.100', 'port': 1080,
                       'username': 'fixture', 'password': 'fixture-secret'}}


@unittest.skipUnless(os.geteuid() == 0, 'isolated root-owned filesystem and UID tests')
class FallbackTests(unittest.TestCase):
    def setUp(self):
        # Use a root-controlled ancestor rather than shared /tmp.
        # Only this temporary fixture tree is written or removed.
        parent = '/Library' if v.sys.platform == 'darwin' else '/opt'
        self.tmp = tempfile.TemporaryDirectory(prefix='vpn-path-test-', dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.root.chmod(0o755)
        self.base = self.root / 'Library/BigSurVPN'
        self.base.mkdir(parents=True)
        self.private = self.base / 'private'
        self.private.mkdir(mode=0o700)
        (self.base / 'releases').mkdir()
        self.local = self.root / 'usr/local'
        self.bin = self.local / 'bin'
        self.bin.mkdir(parents=True)
        self.pathfile = self.root / 'private/etc/paths.d/ru.pioner22.bigsur-vpn'
        self.pathfile.parent.mkdir(parents=True)
        for root, dirs, files in os.walk(self.root):
            os.chmod(root, 0o700 if root == str(self.private) else 0o755)
        self.alias = self.bin / 'vpn-bigsur'
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        for name, val in {'BASE': str(self.base), 'PRIVATE': str(self.private),
                'CURRENT': str(self.base / 'current'), 'COMMAND_LINK': str(self.alias),
                'COMMAND_PATH_FILE': str(self.pathfile),
                'CATALOG': str(self.private / 'profiles.json'),
                'REPORT': str(self.private / 'last-report.json')}.items():
            self.stack.enter_context(mock.patch.object(v, name, val))
        self.oldmask = os.umask(0o077); self.addCleanup(os.umask, self.oldmask)
        v.atomic_bytes(str(self.base / 'vpn-bigsur.sh'), v.b(v.CLI), 0o755)
        self.report = v.Report('fixture')
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def install(self):
        v.install_command_entry(self.report)

    def mode(self, p):
        return stat.S_IMODE(os.lstat(p).st_mode)

    def as_nobody(self, args):
        n = pwd.getpwnam('nobody')
        def drop():
            os.setgroups([]); os.setgid(n.pw_gid); os.setuid(n.pw_uid)
        return subprocess.run(args, preexec_fn=drop, capture_output=True,
                              cwd='/', timeout=5, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})

    def assert_canonical(self):
        p = self.base / 'vpn-bigsur'
        self.assertTrue(p.is_symlink())
        self.assertEqual(os.readlink(p), str(self.base / 'vpn-bigsur.sh'))
        self.assertEqual(os.lstat(p).st_uid, 0)
        self.assertEqual(self.pathfile.read_bytes(), v.b(str(self.base) + '\n'))
        self.assertEqual(self.mode(self.pathfile), 0o644)
        p = self.as_nobody([str(p), '--help'])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn(v.VERSION.encode(), p.stdout)

    def test_preflight_does_not_call_old_shared_directory_gate(self):
        with mock.patch.object(v, 'prepare_command_dir', side_effect=AssertionError('old gate')):
            self.assertEqual(v.check_activation_paths(), str(self.base / 'vpn-bigsur'))

    def test_group_writable_bin_does_not_block_setup(self):
        self.bin.chmod(0o775)
        self.install(); self.assert_canonical()
        self.assertEqual(self.mode(self.bin), 0o775)
        self.assertFalse(self.alias.exists())
        self.assertIn('mode=0775', self.report.data['steps'][-1]['detail'])

    def test_user_admin_bin_does_not_block_setup(self):
        os.chown(self.bin, 65534, 65534); self.bin.chmod(0o775)
        self.install(); self.assert_canonical()
        self.assertEqual(self.bin.stat().st_uid, 65534)
        self.assertEqual(self.bin.stat().st_gid, 65534)
        self.assertEqual(self.mode(self.bin), 0o775)

    def test_bin_symlink_target_is_not_modified(self):
        self.bin.rmdir(); target = self.root / 'other'; target.mkdir(); target.chmod(0o755)
        self.bin.symlink_to(target, target_is_directory=True)
        before = target.stat()
        self.install(); self.assert_canonical()
        self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(target.stat().st_mode, before.st_mode)

    def test_parent_symlink_target_is_not_modified(self):
        shutil.rmtree(self.local); target = self.root / 'other'; (target/'bin').mkdir(parents=True)
        self.local.symlink_to(target, target_is_directory=True)
        self.install(); self.assert_canonical()
        self.assertFalse((target/'bin/vpn-bigsur').exists())

    def test_regular_file_instead_of_bin_is_not_modified(self):
        self.bin.rmdir(); self.bin.write_text('not a directory')
        self.install(); self.assert_canonical()
        self.assertEqual(self.bin.read_text(), 'not a directory')

    def test_missing_shared_directory_not_created(self):
        shutil.rmtree(self.local)
        self.install(); self.assert_canonical()
        self.assertFalse(self.local.exists())

    def test_existing_alias_in_writable_bin_is_left_unchanged(self):
        self.alias.symlink_to(self.base/'vpn-bigsur.sh'); self.bin.chmod(0o775)
        inode = self.alias.lstat().st_ino
        self.install(); self.assert_canonical()
        self.assertEqual(inode, self.alias.lstat().st_ino)

    def test_safe_root_bin_gets_only_optional_link(self):
        self.install(); self.assert_canonical()
        self.assertTrue(self.alias.is_symlink())
        self.assertEqual(os.readlink(self.alias), str(self.base/'vpn-bigsur.sh'))
        self.assertEqual(self.mode(self.bin), 0o755)

    def test_foreign_alias_not_replaced(self):
        self.alias.write_text('unrelated command'); self.alias.chmod(0o755)
        self.install(); self.assert_canonical()
        self.assertEqual(self.alias.read_text(), 'unrelated command')
        self.assertTrue(self.report.warnings())

    def test_foreign_symlink_not_replaced(self):
        self.alias.symlink_to('/does/not/exist')
        self.install(); self.assert_canonical()
        self.assertEqual(os.readlink(self.alias), '/does/not/exist')

    def test_optional_alias_write_failure_does_not_fail_install(self):
        orig=v.os.symlink
        def symlink(target, path):
            if path == str(self.alias): raise PermissionError('fixture')
            return orig(target, path)
        with mock.patch.object(v.os, 'symlink', side_effect=symlink): self.install()
        self.assert_canonical()

    def test_foreign_canonical_link_rejected(self):
        (self.base/'vpn-bigsur').symlink_to('/another/file')
        with self.assertRaises(v.VPNError): self.install()
        self.assertFalse(self.pathfile.exists())

    def test_foreign_canonical_regular_file_rejected(self):
        (self.base/'vpn-bigsur').write_text('foreign')
        with self.assertRaises(v.VPNError): self.install()
        self.assertEqual((self.base/'vpn-bigsur').read_text(), 'foreign')

    def test_untrusted_wrapper_rejected(self):
        os.chown(self.base/'vpn-bigsur.sh',65534,-1)
        with self.assertRaises(v.VPNError): self.install()

    def test_hardlinked_wrapper_rejected(self):
        os.link(self.base/'vpn-bigsur.sh', self.base/'hardlink')
        with self.assertRaises(v.VPNError): self.install()

    def test_untrusted_base_remains_fatal(self):
        self.base.chmod(0o777)
        with self.assertRaises(v.VPNError): self.install()
        self.assertEqual(self.mode(self.base),0o777)

    def test_private_data_unreadable_after_fallback(self):
        f=self.private/'fixture-secret.json'; v.atomic_json(str(f),{'password':'fixture-secret'})
        self.bin.chmod(0o775); self.install(); self.assert_canonical()
        p=self.as_nobody(['/bin/cat',str(f)])
        self.assertNotEqual(p.returncode,0);self.assertEqual(p.stdout,b'')
        self.assertEqual(self.mode(self.private),0o700);self.assertEqual(self.mode(f),0o600)

    def test_idempotent_registration_and_link(self):
        self.install(); inode=(self.base/'vpn-bigsur').lstat().st_ino
        self.install(); self.assert_canonical()
        self.assertEqual((self.base/'vpn-bigsur').lstat().st_ino,inode)
        self.assertEqual(self.pathfile.read_bytes().count(b'\n'),1)

    def test_path_registration_failure_keeps_canonical_command(self):
        with mock.patch.object(v,'command_path_preflight',side_effect=OSError('fixture')): self.install()
        self.assertFalse(self.report.data['command_path_registered'])
        self.assertTrue((self.base/'vpn-bigsur').exists())
        self.assertFalse(self.pathfile.exists())

    def test_registration_does_not_replace_foreign_file(self):
        self.pathfile.write_text('/foreign/bin\n');self.pathfile.chmod(0o644)
        self.install()
        self.assertEqual(self.pathfile.read_text(),'/foreign/bin\n')
        self.assertFalse(self.report.data['command_path_registered'])
        self.assertTrue((self.base/'vpn-bigsur').exists())

    def test_registration_symlink_not_followed(self):
        target=self.root/'other-file';target.write_text('keep')
        self.pathfile.symlink_to(target)
        self.install()
        self.assertEqual(target.read_text(),'keep')
        self.assertTrue(self.pathfile.is_symlink())
        self.assertFalse(self.report.data['command_path_registered'])

    def test_paths_directory_symlink_not_followed(self):
        self.pathfile.parent.rmdir(); target=self.root/'other-paths';target.mkdir()
        self.pathfile.parent.symlink_to(target, target_is_directory=True)
        self.install()
        self.assertEqual(list(target.iterdir()),[])
        self.assertFalse(self.report.data['command_path_registered'])

    def test_paths_directory_creation_overrides_umask_only_for_new_dir(self):
        self.pathfile.parent.rmdir();self.install();self.assert_canonical()
        self.assertEqual(self.mode(self.pathfile.parent),0o755)
        self.assertEqual(os.umask(0o077),0o077)

    def test_readonly_registration_inode_permissions_preserved_or_replaced_safely(self):
        self.pathfile.write_bytes(v.command_path_data());self.pathfile.chmod(0o444)
        self.install();self.assert_canonical()

    def test_uninstall_removes_own_registration_and_alias(self):
        self.install();v.remove_command_entries()
        self.assertFalse(self.pathfile.exists());self.assertFalse(self.alias.exists())
        self.assertTrue(self.bin.is_dir())

    def test_uninstall_preserves_changed_registration(self):
        self.install();self.pathfile.write_text('/different/bin\n')
        v.remove_command_entries()
        self.assertEqual(self.pathfile.read_text(),'/different/bin\n')

    def test_uninstall_does_not_touch_alias_under_untrusted_parent(self):
        self.install();self.bin.chmod(0o775);v.remove_command_entries()
        self.assertTrue(self.alias.is_symlink());self.assertEqual(self.mode(self.bin),0o775)

    def test_setup_reaches_real_menu_and_installs_with_0775_bin(self):
        self.bin.chmod(0o775)
        profile_path=self.private/'provider-fixture.json';v.atomic_json(str(profile_path),profile())
        state=v.validate_profile(profile())
        stage=Path(tempfile.mkdtemp(dir=self.base/'releases'))
        for name,data,mode in [('vpn-runtime.py',(ROOT/'vpn-runtime.py').read_bytes(),0o644),
                               ('sing-box',b'fixture-core-not-executed\n',0o755)]:
            v.atomic_bytes(str(stage/name),data,mode)
        meta={'version':v.VERSION, 'profile_sha256':v.digest(str(profile_path)),
              'hashes':{name:v.digest(str(stage/name)) for name in ('vpn-runtime.py','sing-box')}}
        v.atomic_json(str(stage/'manifest.json'),meta);stage.chmod(0o755)
        terminal=io.StringIO('2\n');real_choose=v.choose_backend; seen=[]
        def choose(state):
            seen.append('menu');return real_choose(state,terminal)
        def finish(base,report):
            seen.append('verification-mocked');report.end('FIXTURE_ONLY');return 2
        with mock.patch.object(v,'choose_backend',side_effect=choose), \
             mock.patch.object(v,'info',return_value=''), \
             mock.patch.object(v,'baseline',return_value={'ip':'192.0.2.1'}), \
             mock.patch.object(v,'github_check',return_value={}), \
             mock.patch.object(v,'stage_install',return_value=(str(stage),state,profile(),meta)), \
             mock.patch.object(v,'connect',side_effect=lambda *a:seen.append('connect-mocked')), \
             mock.patch.object(v,'finish_connected',side_effect=finish):
            self.assertEqual(v.setup(str(profile_path),self.report),2)
        self.assertEqual(seen,['menu','connect-mocked','verification-mocked'])
        self.assertEqual(v.read_json(v.CATALOG)['backend'],'socks5')
        self.assertEqual(v.check_install()['version'],v.VERSION)
        self.assertEqual(self.mode(self.bin),0o775)
        self.assert_canonical()

    def test_repeat_same_install_repairs_command_entry(self):
        self.bin.chmod(0o775)
        state=v.validate_profile(profile());state['backend']='socks5'
        v.atomic_json(v.CATALOG,state)
        meta={'version':v.VERSION,'hashes':{'vpn-runtime.py':'code'},'profile_sha256':'profile'}
        with mock.patch.object(v,'read_json',side_effect=lambda p:profile() if p=='/profile' else copy.deepcopy(state)), \
             mock.patch.object(v,'choose_backend',return_value='socks5'), \
             mock.patch.object(v,'check_install',return_value=meta), \
             mock.patch.object(v,'digest',side_effect=lambda p:'profile' if p=='/profile' else 'code'), \
             mock.patch.object(v,'info',return_value=''), \
             mock.patch.object(v,'baseline',return_value={'ip':'192.0.2.1'}), \
             mock.patch.object(v,'stage_install',side_effect=AssertionError('must reuse')), \
             mock.patch.object(v,'connect'),mock.patch.object(v,'finish_connected',return_value=2):
            self.assertEqual(v.setup('/profile',self.report),2)
        self.assert_canonical()


def directory_mode_case(mode):
    def case(self):
        self.bin.chmod(mode); self.install(); self.assert_canonical()
        self.assertEqual(self.mode(self.bin), mode)
        self.assertFalse(self.alias.exists())
    setattr(FallbackTests,'test_shared_mode_%04o_preserved'%mode,case)
for _mode in (0o775,0o777,0o770,0o700,0o750,0o000,0o1777,0o2775):
    directory_mode_case(_mode)


class StaticDeliveryTests(unittest.TestCase):
    def test_version_is_consistent(self):
        self.assertEqual(v.VERSION,'2.1.3')
        self.assertIn('BigSurVPN '+v.VERSION,(ROOT/'vpn.sh').read_text())
        self.assertIn(v.VERSION,v.CLI)

    def test_wrapper_elevates_only_canonical_root_script(self):
        self.assertIn('exec /usr/bin/sudo /bin/bash /Library/BigSurVPN/vpn-bigsur.sh',v.CLI)
        self.assertNotIn('sudo /usr/local',v.CLI)

    def test_release_hash_matches_runtime_bytes(self):
        import re
        expected=re.search('local runtime_sha=([0-9a-f]{64})',(ROOT/'vpn.sh').read_text()).group(1)
        self.assertEqual(expected,hashlib.sha256((ROOT/'vpn-runtime.py').read_bytes()).hexdigest())

    def test_shell_syntax(self):
        p=subprocess.run(['/bin/bash','-n',str(ROOT/'vpn.sh')],capture_output=True)
        self.assertEqual(p.returncode,0,p.stderr)

    def test_no_network_changes_in_path_helpers(self):
        for fn in (v.check_activation_paths,v.install_command_entry,v.remove_command_entries):
            import inspect
            src=inspect.getsource(fn)
            self.assertNotIn('stop()',src)
            self.assertNotIn('connect(',src)
            self.assertNotIn('launchctl',src)
            self.assertNotIn('chown(',src)


if __name__=='__main__':
    unittest.main(verbosity=2)
