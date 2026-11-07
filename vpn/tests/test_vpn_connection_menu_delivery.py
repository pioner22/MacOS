"""Execute the actual delivery runner with inert fixtures, not network commands."""
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOOT = (ROOT / 'entry.sh').read_text()
RUNNER = re.search(r"  runner='(.*?)\n'\n", BOOT, re.S).group(1)
def sha(b): return hashlib.sha256(b).hexdigest()

class DeliveryTests(unittest.TestCase):
    def test_payload_hashes_match(self):
        for label, filename in [('menu', 'connection-menu.py'), ('repair', 'connection-repair.py')]:
            expected = re.search(r"local " + label + r"_sha='([a-f0-9]{64})'", BOOT).group(1)
            self.assertEqual(expected, sha((ROOT / filename).read_bytes()))
    def test_both_refs_are_immutable(self):
        for label in ['menu', 'repair']:
            self.assertRegex(BOOT, r"local " + label + r"_ref='[a-f0-9]{40}'")
    def test_shell_syntax(self):
        p = subprocess.run(['/bin/bash', '-n', str(ROOT / 'entry.sh')], capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
    def test_truncated_before_invocation_cannot_execute(self):
        definitions = BOOT.rsplit('\nbigsur_vpn_entry "$@"', 1)[0] + '\n'
        p = subprocess.run(['/bin/bash'], input=definitions.encode(), capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr); self.assertEqual(p.stdout, b'')
    def test_runner_arguments_in_both_elevation_paths(self):
        self.assertEqual(BOOT.count('"$work/repair.py" "$repair_sha" "$work/menu.py" "$menu_sha"'), 2)
    def test_python_never_imports_from_callers_directory(self):
        self.assertLess(BOOT.index('  cd /'), BOOT.index('/usr/bin/python'))
    def run_runner(self, corrupt=None, menu=None):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            repair_bytes = b"VALUE='VERIFIED_RECOVERY'\n"
            menu_bytes = menu or b"import connection_repair\nprint(connection_repair.VALUE)\nprint('VERIFIED_MENU')\n"
            repair, script = root/'repair.py', root/'menu.py'
            repair.write_bytes(repair_bytes); script.write_bytes(menu_bytes)
            if corrupt == 'repair': repair.write_bytes(b"raise Exception('MUST_NOT_RUN')\n")
            if corrupt == 'menu': script.write_bytes(b"raise Exception('MUST_NOT_RUN')\n")
            if corrupt == 'large': script.write_bytes(b'x' * 262145)
            runner = RUNNER.replace('dir="/private/var/tmp"', 'dir=' + repr(td))
            p = subprocess.run([sys.executable, '-B', '-c', runner, str(repair), sha(repair_bytes), str(script), sha(menu_bytes)],
                               capture_output=True, timeout=10, cwd='/')
            self.assertFalse(list(root.glob('bigsur-vpn-repair-*')))
            return p
    def test_runner_executes_menu_and_verified_dependency(self):
        p = self.run_runner()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, b'VERIFIED_RECOVERY\nVERIFIED_MENU\n')
    def test_changed_recovery_blocks_menu(self):
        p = self.run_runner('repair')
        self.assertNotEqual(p.returncode, 0); self.assertIn(b'Integrity verification failed', p.stderr)
        self.assertEqual(p.stdout, b''); self.assertNotIn(b'MUST_NOT_RUN', p.stderr)
    def test_changed_menu_blocks_execution(self):
        p = self.run_runner('menu')
        self.assertNotEqual(p.returncode, 0); self.assertIn(b'Integrity verification failed', p.stderr)
        self.assertEqual(p.stdout, b''); self.assertNotIn(b'MUST_NOT_RUN', p.stderr)
    def test_oversized_menu_rejected(self):
        self.assertNotEqual(self.run_runner('large').returncode, 0)
    def test_warning_exit_is_preserved_and_temp_deleted(self):
        p = self.run_runner(menu=b'import sys\nsys.exit(2)\n')
        self.assertEqual(p.returncode, 2)
    def test_cancel_exit_is_preserved_and_temp_deleted(self):
        p = self.run_runner(menu=b'import sys\nsys.exit(130)\n')
        self.assertEqual(p.returncode, 130)

if __name__ == '__main__': unittest.main()
