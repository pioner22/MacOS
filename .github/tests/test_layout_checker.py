"""Checker regressions using explicit Git metadata fixtures, no remote Git calls."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('checked_layout', Path(__file__).resolve().parents[1] / 'repository_layout.py')
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)

class CheckerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.old = {p: ('100644', 'blob', 'b'*40) for p in r.PRIMARY}
        self.old['publish_network_fixtures.sh'] = ('100644','blob','c'*40)
        self.old['vpn-runtime.py'] = ('100644','blob','d'*40)
        self.new = {r.destination(p): identity for p,identity in self.old.items()}
        fixed = ('100644','blob',r.PATH_ONLY_BLOBS['publish_network_fixtures.sh'])
        self.new.update({'publish_network_fixtures.sh':fixed,'diagnostics/publish_network_fixtures.sh':fixed})
        self.pinned = {}
        for name,target in r.PRIMARY.items():
            (self.root/name).write_text(r.launcher(target,'a'*40,'b'*40))
            self.new[name] = ('100644','blob','e'*40)
            self.pinned[target] = ('100644','blob','b'*40)

    def check(self, strict=False):
        def trees(ref,root):
            return self.old if ref==r.BASELINE else self.new if ref=='HEAD' else self.pinned
        with mock.patch.object(r,'git_tree',side_effect=trees):
            return r.check(self.root,audit_relocation=strict)

    def test_recorded_url_only_fix_allowed_in_strict_audit(self):
        self.assertEqual(self.check(True),5)
    def test_divergent_root_copy_rejected(self):
        self.new['publish_network_fixtures.sh']=('100644','blob','f'*40)
        with self.assertRaises(ValueError): self.check()
    def test_missing_canonical_script_rejected(self):
        del self.new['diagnostics/publish_network_fixtures.sh']
        with self.assertRaises(ValueError): self.check()
    def test_unrecorded_code_change_rejected_in_strict_audit(self):
        self.new['vpn/vpn-runtime.py']=('100644','blob','f'*40)
        with self.assertRaises(ValueError): self.check(True)
    def test_normal_check_allows_future_canonical_code_updates(self):
        self.new['vpn/vpn-runtime.py']=('100644','blob','f'*40)
        self.assertEqual(self.check(),5)
    def test_changed_pinned_target_rejected(self):
        self.pinned['vpn/vpn.sh']=('100644','blob','f'*40)
        with self.assertRaises(ValueError): self.check()
    def test_missing_data_mirror_rejected(self):
        self.new['diagnostics/network-fixtures.tsv']=('100644','blob','f'*40)
        with self.assertRaises(ValueError): self.check()

if __name__=='__main__': unittest.main()
