"""Dashboard interactions and original-file playback; no real League/network access."""
import asyncio
from contextlib import ExitStack
import importlib.util
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion import App
import companion
from network import RemoteError
from replay import LCU, ReplayError
from test_companion import DirectNetwork, connection_code, terminal_scores

HAS_TEXTUAL = importlib.util.find_spec('textual') is not None
if HAS_TEXTUAL:
    from textual.widgets import DataTable, Input, Select, Switch
    from tui import CompanionTUI, ConnectionDialog, MessageDialog, SortDialog


def ranked(identity='EUW1_123', **kwargs):
    return {'matchId': identity, 'gameVersion': '16.20.1.2', 'downloaded': True,
            'scores': terminal_scores(**kwargs)}


class LocalPlaybackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.client = LCU(None)
        self.calls = []
        self.state = 'watch'
        self.summoner = {'puuid': 'fixture-account'}
        self.file = self.root / 'EUW1-123.rofl'
        self.file.write_bytes(b'RLR\x00opaque modern client replay')
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(self.client, 'replay_dir', return_value=self.root))
        self.stack.enter_context(patch.object(self.client, 'current_version', return_value='16.20.7.8'))
        self.metadata = self.stack.enter_context(patch.object(self.client, 'ensure_metadata'))
        self.stack.enter_context(patch.object(self.client, 'request', side_effect=self.request))

    def tearDown(self):
        self.stack.close(); self.tmp.cleanup()

    def request(self, method, route, body=None):
        self.calls.append((method, route, body))
        if route == '/lol-summoner/v1/current-summoner':
            return self.summoner
        return {'state': self.state}

    def test_original_modern_file_is_launched_without_cache_copy_or_shell(self):
        before = self.file.read_bytes()
        result = self.client.watch_local('EUW1_123', '16.20.1.2')
        self.assertIn('angefordert', result['message'])
        self.assertEqual(self.file.read_bytes(), before)
        self.assertEqual(list(self.root.iterdir()), [self.file])
        self.metadata.assert_called_once_with('EUW1_123', '16.20.1.2')
        self.assertEqual(self.calls[-1], ('POST', '/lol-replays/v1/rofls/123/watch',
                                        {'componentType': 'replay-button_match-history'}))
        self.assertIn(('POST', '/lol-replays/v1/rofls/scan', None), self.calls)

    def test_underscore_filename_is_supported_without_renaming(self):
        self.file.rename(self.root / 'EUW1_123.rofl')
        self.client.watch_local('EUW1_123', '16.20.1.2')
        self.assertTrue((self.root / 'EUW1_123.rofl').exists())

    def test_missing_empty_or_directory_files_are_not_launched(self):
        for mode in ('missing', 'empty', 'directory'):
            with self.subTest(mode=mode):
                if self.file.is_file():
                    self.file.unlink()
                if mode == 'empty':
                    self.file.touch()
                elif mode == 'directory':
                    self.file.mkdir()
                with self.assertRaisesRegex(ReplayError, 'Datei fehlt'):
                    self.client.watch_local('EUW1_123', '16.20.1.2')
        self.assertFalse(any(route.endswith('/watch') for _, route, _ in self.calls))

    def test_login_patch_and_client_metadata_gate_launch(self):
        for summoner in (None, {}, {'puuid': ''}):
            self.summoner = summoner
            with self.assertRaisesRegex(ReplayError, 'einloggen'):
                self.client.watch_local('EUW1_123', '16.20.1.2')
        self.summoner = {'puuid': 'fixture-account'}
        with self.assertRaisesRegex(ReplayError, 'Patch'):
            self.client.watch_local('EUW1_123', '16.19.1.2')
        self.state = 'downloading'
        with self.assertRaisesRegex(ReplayError, 'keine Wiedergabe'):
            self.client.watch_local('EUW1_123', '16.20.1.2')
        with patch.object(self.client, 'request', side_effect=RemoteError(401)):
            with self.assertRaisesRegex(ReplayError, 'einloggen'):
                self.client.watch_local('EUW1_123', '16.20.1.2')
        self.assertFalse(any(route.endswith('/watch') for _, route, _ in self.calls))

    def test_cancelled_launch_and_invalid_identity_never_start(self):
        cancel = threading.Event(); cancel.set()
        with self.assertRaisesRegex(ReplayError, 'abgebrochen'):
            self.client.watch_local('EUW1_123', '16.20.1.2', cancel)
        with self.assertRaises(ReplayError):
            self.client.local_replay_path('../../outside')
        self.assertFalse(any(route.endswith('/watch') for _, route, _ in self.calls))

    def test_symlinks_and_oversized_files_are_not_accepted(self):
        with patch.object(Path, 'is_symlink', return_value=True):
            self.assertIsNone(self.client.local_replay_path('EUW1_123'))
        with patch('replay.MAX_FILE', 1):
            self.assertIsNone(self.client.local_replay_path('EUW1_123'))

    def test_shutdown_stops_client_requests_before_lockfile_or_transport_access(self):
        cancel = threading.Event(); cancel.set()
        client = LCU(Mock(), cancel=cancel)
        with patch.object(client, 'lockfile') as lockfile:
            with self.assertRaisesRegex(ReplayError, 'abgebrochen'):
                client.current_version()
        lockfile.assert_not_called()
        client.network.request.assert_not_called()


class OpenReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = App(self.tmp.name, network=DirectNetwork())
        self.app.ranking_state['items'] = [ranked()]
        self.client = Mock()
        self.client.watch_local.return_value = {'message': 'Wiedergabe angefordert.'}
        self.app.lcu = self.client

    def tearDown(self):
        self.app.close(); self.tmp.cleanup()

    def test_missing_file_requests_confirmation_even_if_cached_flag_is_local(self):
        self.client.local_replay_path.return_value = None
        result = self.app.open_replay('EUW1_123')
        self.assertEqual(result, {'requiresDownload': True, 'matchId': 'EUW1_123'})
        self.client.download.assert_not_called()
        self.client.watch_local.assert_not_called()

    def test_existing_file_launches_without_download_even_if_flag_is_stale(self):
        self.app.ranking_state['items'][0]['downloaded'] = False
        self.client.local_replay_path.return_value = Path(self.tmp.name) / 'EUW1-123.rofl'
        self.app.open_replay('EUW1_123')
        self.client.download.assert_not_called()
        self.client.watch_local.assert_called_once_with('EUW1_123', '16.20.1.2', self.app.stop_event)
        self.assertTrue(self.app.ranking_state['items'][0]['downloaded'])

    def test_confirmed_download_happens_before_launch_and_updates_row(self):
        self.client.local_replay_path.side_effect = [None, Path(self.tmp.name) / 'EUW1-123.rofl']
        self.app.open_replay('EUW1_123', download=True)
        self.client.download.assert_called_once_with('EUW1_123', '16.20.1.2', self.app.stop_event)
        self.client.watch_local.assert_called_once()
        self.assertEqual(self.app.ranking_state['items'][0]['filename'], 'EUW1-123.rofl')

    def test_unknown_match_failed_download_and_shutdown_do_not_launch(self):
        with self.assertRaisesRegex(ReplayError, 'nicht mehr'):
            self.app.open_replay('EUW1_456')
        self.client.local_replay_path.return_value = None
        self.client.download.side_effect = ReplayError('Download fehlgeschlagen')
        with self.assertRaisesRegex(ReplayError, 'Download fehlgeschlagen'):
            self.app.open_replay('EUW1_123', download=True)
        self.app.stop_event.set()
        with self.assertRaisesRegex(ReplayError, 'abgebrochen'):
            self.app.open_replay('EUW1_123', download=True)
        self.client.watch_local.assert_not_called()


class EntryPointTests(unittest.TestCase):
    def test_interactive_terminal_uses_dashboard_and_plain_or_redirected_uses_legacy(self):
        for flags, tty, dashboard in (([], True, True), (['--plain'], True, False), ([], False, False)):
            with self.subTest(flags=flags, tty=tty), tempfile.TemporaryDirectory() as root, \
                 patch.dict('os.environ', {'LOCALAPPDATA': root}), \
                 patch.object(sys, 'argv', ['companion.py', *flags]), \
                 patch.object(sys.stdin, 'isatty', return_value=tty), \
                 patch.object(sys.stdout, 'isatty', return_value=tty), \
                 patch.object(companion, 'run_dashboard', return_value=0) as tui, \
                 patch.object(companion, 'run_terminal', return_value=0) as plain:
                self.assertEqual(companion.main(), 0)
                self.assertEqual(tui.call_count, int(dashboard))
                self.assertEqual(plain.call_count, int(not dashboard))

    def test_missing_dashboard_dependency_gives_install_hint_and_closes_app(self):
        backend = Mock()
        with patch.dict(sys.modules, {'tui': None}), patch('sys.stderr') as stderr:
            self.assertEqual(companion.run_dashboard(backend), 1)
        backend.close.assert_called_once()
        self.assertIn('--plain', ''.join(call.args[0] for call in stderr.write.call_args_list))


@unittest.skipUnless(HAS_TEXTUAL, 'Install Companion/requirements.txt for headless TUI tests')
class DashboardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.backend = App(self.tmp.name, network=DirectNetwork())
        self.backend.ranking_state['items'] = [ranked(), ranked('EUW1_456', gold=(49000, 50000))]
        self.stack = ExitStack()
        self.stack.enter_context(patch.object(self.backend, 'start_workers'))
        self.stack.enter_context(patch.object(self.backend, 'rank_replays', side_effect=self.backend.rankings))
        self.ui = CompanionTUI(self.backend)

    async def asyncTearDown(self):
        self.stack.close()
        self.backend.close(); self.tmp.cleanup()

    async def settle(self, pilot):
        await self.ui.workers.wait_for_complete()
        await pilot.pause()

    async def test_dashboard_renders_in_place_and_keeps_selection_after_sort_and_refresh(self):
        async with self.ui.run_test(size=(100, 30)) as pilot:
            await self.settle(pilot)
            table = self.ui.table
            self.assertEqual(table.row_count, 2)
            self.assertEqual(self.ui.selected_match(), 'EUW1_123')
            await pilot.press('down')
            self.assertEqual(self.ui.selected_match(), 'EUW1_456')
            self.ui.apply_sort(('gold', True))
            self.assertEqual(self.ui.selected_match(), 'EUW1_456')
            self.assertEqual(table.cursor_row, 0)
            self.backend.feed.update(sent=123, connected=True, lastHeartbeat=time.time(), availability='live')
            self.ui.refresh_dashboard(); self.ui.refresh_dashboard()
            self.assertEqual(table.row_count, 2)
            self.assertEqual(self.ui.selected_match(), 'EUW1_456')
            self.assertIn('123 Snapshots', str(self.ui.connection_widget.render()))
            self.assertFalse(list(self.ui.query('#activity')))

    async def test_enter_launches_selected_match_once_and_displays_errors(self):
        with patch.object(self.backend, 'open_replay', side_effect=ReplayError('League öffnen und einloggen.')) as launch:
            async with self.ui.run_test() as pilot:
                await self.settle(pilot)
                await pilot.press('down', 'enter')
                await self.settle(pilot)
                launch.assert_called_once_with('EUW1_456')
                self.assertIsInstance(self.ui.screen, MessageDialog)
                self.assertIn('einloggen', self.ui.screen.text)
                await pilot.press('escape')
                self.assertEqual(self.ui.selected_match(), 'EUW1_456')

    async def test_objective_source_status_is_visible_and_refreshes_without_losing_selection(self):
        self.backend.ranking_state['items'][0]['objectiveSource'] = {'status': 'ready', 'count': 8}
        self.backend.ranking_state['items'][1]['objectiveSource'] = {'status': 'unavailable', 'count': 0}
        async with self.ui.run_test(size=(110, 30)) as pilot:
            await self.settle(pilot)
            self.assertEqual(str(self.ui.table.get_row_at(0)[5]), '✓ 8')
            self.assertEqual(str(self.ui.table.get_row_at(1)[5]), 'fehlt')
            await pilot.press('down')
            self.backend.ranking_state['items'][1]['objectiveSource'] = {'status': 'ready', 'count': 4}
            self.ui.refresh_dashboard()
            self.assertEqual(self.ui.selected_match(), 'EUW1_456')
            self.assertEqual(str(self.ui.table.get_row_at(1)[5]), '✓ 4')

    async def test_f5_refreshes_in_background_once_and_preserves_selection_and_feed(self):
        entered = threading.Event(); release = threading.Event()
        def refresh():
            entered.set()
            release.wait(5)
            with self.backend.lock:
                self.backend.ranking_state['items'][1]['statsSource'] = {'status': 'ready'}
                self.backend.ranking_state['items'][1]['objectiveSource'] = {'status': 'ready', 'count': 9}
                self.backend.ranking_state['notice'] = 'Neu geprüft: Stats-API 2/2, Objective-API 1/2.'
            return self.backend.rankings()
        with patch.object(self.backend, 'refresh_rankings', side_effect=refresh) as recheck:
            async with self.ui.run_test(size=(110, 30)) as pilot:
                await self.settle(pilot)
                try:
                    await pilot.press('f5')
                    self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                    await pilot.press('f5', 'down')
                    self.assertEqual(self.ui.selected_match(), 'EUW1_456')
                    self.assertEqual(recheck.call_count, 1)
                    self.backend.connect_code(connection_code())
                    await asyncio.to_thread(self.backend.feed_tick)
                    self.assertEqual(self.backend.feed['sent'], 1)
                finally:
                    release.set()
                await self.settle(pilot)
                self.assertEqual(self.ui.selected_match(), 'EUW1_456')
                self.assertEqual(str(self.ui.table.get_row_at(1)[5]), '✓ 9')
                self.assertEqual(str(self.ui.table.get_row_at(1)[7]), '✓')
                self.assertNotIsInstance(self.ui.screen, MessageDialog)
                self.assertIn('Neu geprüft:', str(self.ui.summary_widget.render()))

    async def test_missing_replay_confirmation_can_cancel_then_download_and_launch(self):
        with patch.object(self.backend, 'open_replay', side_effect=[
            {'requiresDownload': True, 'matchId': 'EUW1_123'},
            {'requiresDownload': True, 'matchId': 'EUW1_123'},
            {'message': 'Wiedergabe angefordert.'},
        ]) as launch:
            async with self.ui.run_test(size=(100, 30)) as pilot:
                await self.settle(pilot)
                await pilot.press('enter'); await self.settle(pilot)
                self.assertTrue(self.ui.screen.confirm)
                await pilot.click('#cancel')
                self.assertEqual(launch.call_count, 1)
                await pilot.press('enter'); await self.settle(pilot)
                await pilot.click('#accept'); await self.settle(pilot)
                self.assertEqual(launch.call_count, 3)
                self.assertEqual(launch.call_args.kwargs, {'download': True})

    async def test_sort_dialog_and_help_and_narrow_terminal(self):
        async with self.ui.run_test(size=(60, 22)) as pilot:
            await self.settle(pilot)
            await pilot.press('s')
            self.assertIsInstance(self.ui.screen, SortDialog)
            self.ui.screen.query_one(Select).value = 'momentum'
            self.ui.screen.query_one(Switch).value = False
            await pilot.click('#accept')
            self.assertEqual((self.ui.sort_by, self.ui.descending), ('momentum', False))
            await pilot.press('?')
            self.assertIsInstance(self.ui.screen, MessageDialog)
            self.assertIn('einloggen', self.ui.screen.text)
            await pilot.press('escape')
            self.assertEqual(self.ui.table.row_count, 2)

    async def test_connection_code_is_masked_and_not_echoed_on_failure(self):
        with patch.object(self.backend, 'connect_code', side_effect=ReplayError('Verbindungscode ungültig.')) as connect:
            async with self.ui.run_test() as pilot:
                await self.settle(pilot)
                await pilot.press('v')
                self.assertIsInstance(self.ui.screen, ConnectionDialog)
                field = self.ui.screen.query_one(Input)
                self.assertTrue(field.password)
                field.value = 'BB1.PRIVATE_SECRET'
                await pilot.press('enter'); await self.settle(pilot)
                connect.assert_called_once_with('BB1.PRIVATE_SECRET')
                self.assertEqual(field.value, '')
                self.assertNotIn('PRIVATE_SECRET', self.ui.screen.text)

    async def test_search_does_not_block_input_or_feed_and_no_duplicate_search_is_queued(self):
        entered = threading.Event(); release = threading.Event()
        def fetch():
            entered.set()
            release.wait(5)
            return {'items': [], 'message': 'Keine neuen Replays.'}
        with patch.object(self.backend, 'fetch_replays', side_effect=fetch) as search:
            async with self.ui.run_test(size=(100, 30)) as pilot:
                await self.settle(pilot)
                try:
                    await pilot.press('r')
                    self.assertTrue(await asyncio.to_thread(entered.wait, 2))
                    await pilot.press('r', 'down', 's')
                    self.assertIsInstance(self.ui.screen, SortDialog)
                    self.assertEqual(self.ui.selected_match(), 'EUW1_456')
                    self.backend.connect_code(connection_code())
                    await asyncio.to_thread(self.backend.feed_tick)
                    self.ui.refresh_dashboard()
                    self.assertEqual(self.backend.feed['sent'], 1)
                    self.assertEqual(search.call_count, 1)
                    await pilot.press('escape')
                finally:
                    release.set()
                await self.settle(pilot)

    async def test_empty_table_enter_is_safe_and_quit_stops_workers(self):
        self.backend.ranking_state['items'] = []
        with patch.object(self.backend, 'open_replay') as launch:
            async with self.ui.run_test() as pilot:
                await self.settle(pilot)
                await pilot.press('enter')
                launch.assert_not_called()
                await pilot.press('q')
                self.assertTrue(self.backend.stop_event.is_set())

    async def test_paging_and_resize_keep_selected_match(self):
        self.backend.ranking_state['items'] = [ranked(f'EUW1_{n}') for n in range(100, 160)]
        async with self.ui.run_test(size=(100, 30)) as pilot:
            await self.settle(pilot)
            await pilot.press('pagedown')
            self.assertGreater(self.ui.table.cursor_row, 0)
            selected = self.ui.selected_match()
            await pilot.resize_terminal(60, 22)
            self.ui.refresh_dashboard()
            self.assertEqual(self.ui.selected_match(), selected)
            self.assertEqual(self.ui.table.row_count, 60)


if __name__ == '__main__':
    unittest.main()
