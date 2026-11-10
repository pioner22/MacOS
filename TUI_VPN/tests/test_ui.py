import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.ui import UI, Demo


class Screen:
    def __init__(self, height=28, width=100):
        self.height, self.width, self.writes = height, width, []

    def getmaxyx(self):
        return self.height, self.width

    def addstr(self, y, x, text, style=0):
        self.writes.append((y, x, text))

    def __getattr__(self, name):
        return lambda *_args: None


class UITests(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch('curses.' + name, create=True, return_value=0)
                        for name in ('start_color', 'use_default_colors', 'init_pair', 'curs_set', 'mousemask', 'color_pair')]
        self.patches.append(mock.patch('curses.COLORS', 8, create=True))
        for patch in self.patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.screen = Screen()
        self.ui = UI(self.screen, Demo(), demo=True)
        self.ui.data = Demo()('status')

    def test_layout_exposes_all_four_pages_and_explicit_demo_label(self):
        self.ui.draw()
        text = '\n'.join(w[2] for w in self.screen.writes)
        for word in ('Обзор', 'Серверы', 'Подписки', 'Журнал', 'ДЕМО', 'ВХОДЯЩИЙ', 'ИСХОДЯЩИЙ'):
            self.assertIn(word, text)

    def test_keyboard_server_selection_is_bound_to_the_selected_row(self):
        self.ui.key('2')
        self.ui.key(258)  # curses.KEY_DOWN
        with mock.patch.object(self.ui, 'async_call') as call:
            self.ui.key('\n')
        call.assert_called_once_with('select', {'id': 'demo-2'})

    def test_secret_input_is_masked_and_is_not_persisted(self):
        secret = 'https://example.org/demo-private-token-never-echo'
        self.screen.get_wch = mock.Mock(side_effect=list(secret) + ['\n'])
        self.assertEqual(self.ui.prompt('URL'), secret)
        self.assertNotIn(secret, '\n'.join(w[2] for w in self.screen.writes))
        self.assertIsNone(self.ui.preferences)

    def test_small_terminal_shows_an_actionable_message(self):
        self.screen.width, self.screen.height = 50, 12
        self.ui.draw()
        self.assertIn('Увеличьте', '\n'.join(w[2] for w in self.screen.writes))

    def test_old_poll_reply_does_not_undo_a_later_control_result(self):
        self.ui.data = {'snapshot_at': 20, 'enabled': False}
        self.ui.results.put((True, {'snapshot_at': 10, 'enabled': True}, ''))
        self.ui.collect()
        self.assertFalse(self.ui.data['enabled'])

    def test_manual_off_can_be_sent_while_another_ui_action_is_pending(self):
        self.ui.acting = 1
        received = []
        self.ui.rpc = lambda command, args: received.append(command) or {'snapshot_at': 30, 'enabled': False}
        with mock.patch('threading.Thread') as thread:
            self.ui.async_call('off')
            thread.assert_called_once()
        self.assertEqual(self.ui.acting, 2)

    def test_mouse_button_matches_its_keyboard_action(self):
        self.ui.draw()
        with mock.patch('curses.getmouse', return_value=(0, 3, 2, 0, 1)), \
                mock.patch.object(self.ui, 'action'):
            self.ui.page = 3
            self.ui.key(409)  # curses.KEY_MOUSE
        self.assertEqual(self.ui.page, 0)


if __name__ == '__main__':
    unittest.main()
