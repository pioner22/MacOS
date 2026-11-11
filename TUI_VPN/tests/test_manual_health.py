import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.common import load_settings
from tui_vpn.configuration import build


class ManualHealthTests(unittest.TestCase):
    def test_health_traffic_activates_native_checks_without_changing_manual_traffic(self):
        tag = 'n-0000000000000001'
        node = {'id': tag, 'name': 'Fixture', 'outbound': {
            'type': 'socks', 'server': '127.0.0.1', 'server_port': 1080}}
        value = build([node], load_settings(ROOT), 'fixture-api', 'fixture-probe',
                      'darwin', selection=tag, tun=False)
        selector = next(n for n in value['outbounds'] if n['tag'] == 'proxy')
        self.assertEqual(selector['default'], tag)
        self.assertEqual(value['route']['final'], 'proxy')
        probe_rule = next((r for r in value['route']['rules'] if r.get('inbound') == ['probe']), None)
        self.assertIsNotNone(probe_rule)
        self.assertEqual(probe_rule['outbound'], 'auto')

if __name__ == '__main__':
    unittest.main()
