import curses
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from tui_vpn.manual_profiles import server_port
from tui_vpn.ui import UI, Demo, reachability_text
from tui_vpn.ui_forms import Form, field
from test_ui import Screen


class FormTests(unittest.TestCase):
    def setUp(self):
        for name in ('start_color', 'use_default_colors', 'init_pair', 'curs_set', 'mousemask', 'color_pair'):
            patch = mock.patch('curses.' + name, create=True, return_value=0)
            patch.start()
            self.addCleanup(patch.stop)
        patch = mock.patch('curses.COLORS', 8, create=True)
        patch.start()
        self.addCleanup(patch.stop)
        self.screen = Screen()
        self.ui = UI(self.screen, Demo(), demo=True)
        self.ui.data = Demo()('status')

    def test_password_is_masked_during_multi_field_input(self):
        secret = 'private-test-password'
        self.screen.get_wch = mock.Mock(side_effect=list('owner') + ['\t'] + list(secret) + ['\n'])
        value = Form(self.ui, 'SOCKS5', [field('username', 'Логин'), field('password', 'Пароль', True)]).run()
        self.assertEqual(value, {'username': 'owner', 'password': secret})
        self.assertNotIn(secret, '\n'.join(item[2] for item in self.screen.writes))

    def test_invalid_port_can_be_corrected_without_losing_the_form(self):
        self.screen.get_wch = mock.Mock(side_effect=['\n', '\x15'] + list('45004') + ['\n'])
        value = Form(self.ui, 'Порт', [field('port', 'Порт')], {'port': 'bad'},
                     validate=lambda values: server_port(values['port'])).run()
        self.assertEqual(value['port'], '45004')
        self.assertIn('Порт должен', '\n'.join(item[2] for item in self.screen.writes))

    def test_resize_preserves_secret_input_and_escape_cancels(self):
        keys = iter(list('secret') + [curses.KEY_RESIZE, curses.KEY_RESIZE, '\n'])
        resized = []
        def next_key():
            key = next(keys)
            if key == curses.KEY_RESIZE:
                self.screen.width = 40 if not resized else 100
                resized.append(True)
            return key
        self.screen.get_wch = next_key
        value = Form(self.ui, 'Тест', [field('password', 'Пароль', True)]).run()
        self.assertEqual(value['password'], 'secret')
        self.assertNotIn('secret', '\n'.join(item[2] for item in self.screen.writes))
        self.screen.get_wch = lambda: '\x1b'
        self.assertIsNone(Form(self.ui, 'Отмена', [field('value', 'Поле')]).run())

    def test_mouse_save_uses_the_same_validation_as_enter(self):
        form = Form(self.ui, 'Тест', [field('port', 'Порт')], {'port': '1080'},
                    validate=lambda values: server_port(values['port']))
        form.draw()
        row, left, _right, _index = form.hits[-2]
        self.screen.get_wch = lambda: curses.KEY_MOUSE
        with mock.patch('curses.getmouse', return_value=(0, left, row, 0, curses.BUTTON1_CLICKED)):
            self.assertEqual(form.run()['port'], '1080')

    def test_editing_socks_without_new_password_sends_keep_instruction(self):
        details = {'id': 'node', 'name': 'Reserve', 'host': 'example.org',
                   'port': 1080, 'username': 'owner', 'has_password': True}
        values = {'name': 'Reserve', 'host': 'example.org', 'port': '1080',
                  'username': 'owner', 'password': ''}
        with mock.patch('tui_vpn.ui_forms.Form.run', return_value=values), \
                mock.patch.object(self.ui, 'async_call') as call:
            self.ui.socks_dialog(details)
        self.assertEqual(call.call_args.args[0], 'socks_save')
        self.assertIsNone(call.call_args.args[1]['password'])

    def test_add_url_is_available_from_overview(self):
        values = {'name': 'Provider', 'url': ' https://example.org/private-feed '}
        with mock.patch('tui_vpn.ui_forms.Form.run', return_value=values), \
                mock.patch.object(self.ui, 'async_call') as call:
            self.ui.action('n')
        call.assert_called_once_with('subscription_add', {'name': 'Provider', 'url': 'https://example.org/private-feed'})

    def test_refresh_checks_offline_profiles_or_the_running_tunnel(self):
        self.ui.page = 0
        with mock.patch.object(self.ui, 'async_call') as call:
            self.ui.data['enabled'] = False
            self.ui.refresh()
            call.assert_called_with('probe')
            self.ui.data['enabled'] = True
            self.ui.refresh()
            call.assert_called_with('test')

    def test_mouse_quit_does_not_turn_the_vpn_off(self):
        self.ui.draw()
        row, left, _right, _action = next(value for value in self.ui.buttons if value[-1] == 'q')
        with mock.patch('curses.getmouse', return_value=(0, left, row, 0, curses.BUTTON1_CLICKED)), \
                mock.patch.object(self.ui, 'async_call') as call:
            self.ui.key(curses.KEY_MOUSE)
        self.assertTrue(self.ui.exiting)
        call.assert_not_called()

    def test_mouse_wheel_and_button_press_do_not_toggle_the_connection(self):
        self.ui.draw()
        row, left, _right, _action = next(value for value in self.ui.buttons if value[-1] == ' ')
        for state in (curses.BUTTON4_PRESSED, curses.BUTTON1_PRESSED):
            with self.subTest(state=state), \
                    mock.patch('curses.getmouse', return_value=(0, left, row, 0, state)), \
                    mock.patch.object(self.ui, 'async_call') as call:
                self.ui.key(curses.KEY_MOUSE)
            call.assert_not_called()

    def test_demo_update_never_installs_the_real_program(self):
        with mock.patch('tui_vpn.updates.interactive_update') as update:
            self.ui.update()
        update.assert_not_called()

    def test_stale_probe_does_not_display_old_green_latency(self):
        text = reachability_text({'healthy': True, 'delay_ms': 5,
                                  'reachability': {'state': 'stale', 'delay_ms': None}})
        self.assertIn('устарела', text)
        self.assertNotIn('5 мс', text)
        self.assertIn('0 мс', reachability_text({'reachability': {'state': 'ok', 'delay_ms': 0}}))


if __name__ == '__main__':
    unittest.main()
