#!/usr/bin/env python3
"""Updated wiring contract after replacing legacy launchers with frozen v2 payloads.
Functional profile, cancellation and transport tests live in diagnostics_v2.
The old tests expected direct profile downloads and a destructive SSD backend.
"""
from pathlib import Path
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class EntryPointTests(unittest.TestCase):
    def test_every_compatibility_entry_uses_bootstrap(self):
        names=('current','ram_quick_test','ram_full_test','ram_map','ram_triage','ram_test','ssd_test','gpu_test','cpu_test','network_test','download_test','display_video_test','hardware_probe','power_thermal_test','full_safe_suite','full_all_suite','toolkit_selftest','post_repair_test')
        for name in names:
            text=(ROOT/(name+'.sh')).read_text()
            self.assertIn('MacOS/main/st.sh',text)
            self.assertEqual(subprocess.run(['/bin/bash','-n',str(ROOT/(name+'.sh'))],capture_output=True).returncode,0)
    def test_storage_entry_no_legacy_raw_backend(self):
        text=(ROOT/'ssd_test.sh').read_text()
        self.assertIn('--run storage',text)
        self.assertNotIn('mhdd_v2.part',text)
        self.assertNotIn('eraseDisk',text)
    def test_full_entry_routes_acceptance(self):
        self.assertIn('--run acceptance',(ROOT/'full_all_suite.sh').read_text())
        self.assertIn('--run acceptance',(ROOT/'post_repair_test.sh').read_text())
    def test_menu_has_profile_and_post_repair(self):
        text=(ROOT/'diagnostics/v2/menu.sh').read_text()
        self.assertIn('15) MODEL/OS',text)
        self.assertIn('16) POST-REPAIR',text)
        self.assertNotIn('ERASE-INTERNAL-SSD',text)
if __name__=='__main__':unittest.main(verbosity=2)
