"""Tests use structural replay fixtures and fake transports, not real match recordings."""
import hashlib
import http.client
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
import urllib.error
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion import App, create_server, create_feed_server, run_terminal
import companion
from network import Network, RemoteError, validate_backend
from replay import Cache, LCU, ReplayError, inspect_rofl
from ranking import RANKING_VERSION, team_ratio


def fixture(game=123, version='16.20.123.456'):
    meta = json.dumps({'gameVersion': version}).encode()
    header = bytearray(288)
    header[:6] = b'RIOT\x00\x00'
    payload = struct.pack('<Q', game) + b'\x00' * 30
    struct.pack_into('<HIIIIII', header, 262, 288, 288 + len(meta) + len(payload), 288, len(meta), 288 + len(meta), len(payload), 288 + len(meta) + len(payload))
    return bytes(header) + meta + payload


def terminal_scores(kills=(20, 30), gold=(43000, 50000), carry=90, momentum=None):
    kill_ratio = team_ratio(*kills); gold_ratio = team_ratio(*gold)
    return {'version': RANKING_VERSION, 'kills': kill_ratio['ratio'], 'gold': gold_ratio['ratio'],
            'carry': carry, 'momentum': momentum, 'metrics': {'killsRatio': kill_ratio, 'goldRatio': gold_ratio}}


class FakeNetwork:
    def __init__(self):
        self.calls = []
        self.data = {'gameData': {'gameTime': 10, 'gameMode': 'CLASSIC'}, 'allPlayers': [{'summonerName': 'Test', 'championName': 'Ahri', 'team': 'ORDER'}], 'events': {'Events': []}}
        self.fail = None
        self.pool = []
        self.bytes = fixture()
    def request(self, method, url, headers=None, body=None, local=False):
        self.calls.append((method, url, headers or {}, body, local))
        if (self.fail and '/sendLoLInput' in url):
            raise RemoteError(self.fail)
        if method == 'POST' and url.endswith('/sendLoLInput'):
            return {'ok': True}
        if url.endswith('/allgamedata'):
            return self.data
        if '/replays/reserve' in url:
            return {'item': self.pool[0]}
        if url.endswith('/replays'):
            return {'items': self.pool, 'riotConfigured': False}
        if method == 'PUT':
            return {'matchId': 'EUW1_123'}
        raise RemoteError(503)
    def download(self, url, target, headers=None):
        self.calls.append(('GET', url, headers, None, False))
        Path(target).write_bytes(self.bytes)


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()
    def test_embedded_identity_version_size_and_unsupported(self):
        p = self.root / 'input.rofl'
        p.write_bytes(fixture())
        self.assertEqual(inspect_rofl(p, 'EUW1_123', '16.20.123.456')['gameId'], 123)
        for ident, version in [('EUW1_124', '16.20.123.456'), ('EUW1_123', '16.21.1.1')]:
            with self.assertRaises(ReplayError): inspect_rofl(p, ident, version)
        p.write_bytes(fixture()[:-1])
        with self.assertRaises(ReplayError): inspect_rofl(p, 'EUW1_123', '16.20.123.456')
        p.write_bytes(b'RLR\x00' + b'0' * 400)
        with self.assertRaisesRegex(ReplayError, 'ROFL2|unterstützt'): inspect_rofl(p, 'EUW1_123', '16.20.1.1')
    def test_cache_atomic_dedup_restart_hash_and_quota(self):
        p = self.root / 'in.rofl'; p.write_bytes(fixture())
        cache = Cache(self.root / 'cache', quota=10000)
        item = cache.add(p, 'EUW1_123', '16.20.123.456')
        self.assertEqual(item['sha256'], hashlib.sha256(p.read_bytes()).hexdigest())
        self.assertEqual(len(cache.items()), 1)
        cache.add(p, 'EUW1_123', '16.20.123.456')
        self.assertEqual(len(Cache(self.root / 'cache').items()), 1)
        with self.assertRaises(ReplayError): cache.path('../../outside')
        other = self.root / 'other.rofl'; other.write_bytes(fixture(version='16.20.123.456') + b'x')
        with self.assertRaises(ReplayError): cache.add(other, 'EUW1_123', '16.20.123.456')
        with self.assertRaises(ReplayError): Cache(self.root / 'small', quota=10).add(p, 'EUW1_123', '16.20.123.456')
    def test_lcu_lockfile_credentials_only_fixed_loopback(self):
        (self.root / 'lockfile').write_text('LeagueClient:42:54321:local-secret:https')
        net = FakeNetwork(); lcu = LCU(net, self.root)
        with self.assertRaises(RemoteError): lcu.request('GET', '/lol-patch/v1/game-version')
        call = net.calls[0]
        self.assertTrue(call[1].startswith('https://127.0.0.1:54321/'))
        self.assertTrue(call[4]); self.assertIn('Authorization', call[2])
        with self.assertRaises(ReplayError): lcu.request('GET', '//evil.example/a')

    def test_current_version_uses_lol_build_version_without_manual_input(self):
        client = LCU(FakeNetwork())
        for response in ('16.20.8248524+branch.releases-16-20.code.public.content.release.anticheat.vanguard',
                         {'version': '16.20.8248524+branch.releases-16-20'},
                         '16.20.123.456'):
            with patch.object(client, 'request', return_value=response) as request:
                self.assertEqual(client.current_version(), response.get('version').split('+')[0] if isinstance(response, dict) else response.split('+')[0])
                request.assert_called_once_with('GET', '/lol-patch/v1/game-version')

    def test_discovery_accepts_lol_versions_with_build_suffixes(self):
        client = LCU(FakeNetwork())
        def request(method, route, body=None):
            if route == '/lol-patch/v1/game-version':
                return '16.20.8248524+branch.releases-16-20'
            if route == '/lol-summoner/v1/current-summoner':
                return {'puuid': 'fixture-account-123'}
            if route.startswith('/lol-ranked/'):
                return {'divisions': [{'standings': [{'puuid': 'foreign-account-123'}]}]}
            return {'games': {'games': [
                {'gameId': 123, 'platformId': 'EUW1', 'gameVersion': '16.20.8248524+branch.releases-16-20', 'mapId': 11},
                {'gameId': 124, 'platformId': 'EUW1', 'gameVersion': '16.19.123.456', 'mapId': 11},
            ]}}
        with patch.object(client, 'request', side_effect=request):
            self.assertEqual(client.discover(), [{'matchId': 'EUW1_123', 'gameVersion': '16.20.8248524', 'mapId': 11}])

    def test_discovery_uses_foreign_histories_and_rejects_other_maps_old_and_own_games(self):
        client = LCU(FakeNetwork())
        own = 'fixture-own-account'
        players = [own, 'fixture-foreign-one', 'fixture-foreign-two']
        def request(method, route, body=None):
            if route == '/lol-summoner/v1/current-summoner':
                return {'puuid': own}
            if route.startswith('/lol-ranked/'):
                return {'divisions': [{'standings': [{'puuid': player} for player in players]}]}
            self.assertNotIn(own, route)
            base = {'platformId': 'EUW1', 'gameVersion': '16.20.123.456', 'mapId': 11}
            return {'games': {'games': [
                dict(base, gameId=123),
                dict(base, gameId=124, mapId=12),  # ARAM
                dict(base, gameId=125, mapId=30),  # Arena
                dict(base, gameId=126, mapId=None),
                dict(base, gameId=127, gameVersion='16.19.123.456'),
                dict(base, gameId=128, participantIdentities=[{'player': {'puuid': own}}]),
            ]}}
        with patch.object(client, 'current_version', return_value='16.20.123.456'), \
             patch.object(client, 'request', side_effect=request) as requests:
            self.assertEqual(client.discover(), [{'matchId': 'EUW1_123', 'gameVersion': '16.20.123.456', 'mapId': 11}])
        histories = [call for call in requests.call_args_list if '/matches?' in call.args[1]]
        self.assertEqual(len(histories), 2)

    def test_discovery_never_falls_back_to_own_history_when_ladder_is_empty(self):
        client = LCU(FakeNetwork())
        with patch.object(client, 'current_version', return_value='16.20.123.456'), \
             patch.object(client, 'request', side_effect=[{'puuid': 'fixture-own-account'}, {'divisions': []}]) as requests:
            with self.assertRaisesRegex(ReplayError, 'eigene Verlauf wird nicht verwendet'):
                client.discover()
        self.assertEqual(requests.call_count, 2)

    def test_discovery_bounds_foreign_accounts_and_tolerates_one_unavailable_history(self):
        client = LCU(FakeNetwork())
        histories = []
        def request(method, route, body=None):
            if route == '/lol-summoner/v1/current-summoner':
                return {'puuid': 'fixture-own-account'}
            if route.startswith('/lol-ranked/'):
                return {'divisions': [{'standings': [{'puuid': f'foreign-account-{n}'} for n in range(10)]}]}
            histories.append(route)
            if len(histories) == 1:
                raise RemoteError(503)
            return {'games': {'games': [{'gameId': 123, 'platformId': 'EUW1', 'gameVersion': '16.20.123.456', 'mapId': 11}]}}
        with patch.object(client, 'current_version', return_value='16.20.123.456'), patch.object(client, 'request', side_effect=request):
            self.assertEqual(len(client.discover()), 1)
        self.assertEqual(len(histories), 5)

    def test_discovery_reports_unavailable_foreign_histories_without_own_fallback(self):
        client = LCU(FakeNetwork())
        with patch.object(client, 'current_version', return_value='16.20.123.456'), \
             patch.object(client, 'request', side_effect=[
                 {'puuid': 'fixture-own-account'},
                 {'divisions': [{'standings': [{'puuid': 'foreign-account-123'}]}]},
                 RemoteError(503),
             ]) as requests:
            with self.assertRaisesRegex(ReplayError, 'Fremde Match-Verläufe'):
                client.discover()
        self.assertEqual(requests.call_count, 3)

    def test_plain_download_can_get_its_version_from_lol(self):
        path = self.root / 'EUW1-123.rofl'; path.write_bytes(b'RLR\x00client replay')
        client = LCU(FakeNetwork())
        with patch.object(client, 'current_version', return_value='16.20.8248524'), \
             patch.object(client, 'ensure_metadata') as metadata, \
             patch.object(client, 'replay_dir', return_value=self.root), \
             patch.object(client, 'request', return_value={'state': 'watch'}):
            item = client.download('EUW1_123')
        self.assertEqual(item['gameVersion'], '16.20.8248524')
        metadata.assert_called_once_with('EUW1_123', '16.20.8248524')

    def test_plain_download_keeps_modern_client_file_without_parsing_or_cache(self):
        path = self.root / 'EUW1-123.rofl'
        contents = b'RLR\x00opaque current League replay'
        path.write_bytes(contents)
        lcu = LCU(FakeNetwork())
        with patch.object(lcu, 'current_version', return_value='16.20.123.456'), \
             patch.object(lcu, 'ensure_metadata'), \
             patch.object(lcu, 'replay_dir', return_value=self.root), \
             patch.object(lcu, 'request', return_value={'state': 'watch'}) as request:
            item = lcu.download('EUW1_123', '16.20.123.456')
        self.assertEqual(item['filename'], 'EUW1-123.rofl')
        self.assertEqual(path.read_bytes(), contents)
        self.assertTrue(any(call.args[0] == 'POST' and call.args[1].endswith('/download') for call in request.call_args_list))
        self.assertFalse((self.root / 'cache').exists())

    def test_plain_download_still_requires_client_completion(self):
        path = self.root / 'EUW1-123.rofl'; path.write_bytes(b'partial replay')
        lcu = LCU(FakeNetwork())
        with patch.object(lcu, 'current_version', return_value='16.20.123.456'), \
             patch.object(lcu, 'ensure_metadata'), \
             patch.object(lcu, 'replay_dir', return_value=self.root), \
             patch.object(lcu, 'request', return_value={'state': 'error'}):
            with self.assertRaises(ReplayError):
                lcu.download('EUW1_123', '16.20.123.456')


class AppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.net = FakeNetwork()
        self.app = App(Path(self.tmp.name), network=self.net)
        self.app.configure({'poolToken': 'POOL_SECRET', 'gameId': 8, 'hostToken': 'GAME_SECRET'})
    def tearDown(self):
        self.app.close(); self.tmp.cleanup()
    def test_secret_separation_exact_feed_and_pool_contract(self):
        self.app.feed_start(); self.app.feed_tick()
        call = next(c for c in self.net.calls if c[1].endswith('/sendLoLInput'))
        self.assertEqual(call[2], {'X-Game-Token': 'GAME_SECRET'})
        self.assertEqual(call[3], {'gameId': 8, 'input': self.net.data})
        self.app.server_list()
        pool = self.net.calls[-1]
        self.assertEqual(pool[2], {'X-Replay-Token': 'POOL_SECRET'})
        status = json.dumps(self.app.status())
        self.assertNotIn('SECRET', status); self.assertNotIn('https://bronze', status)
        for f in Path(self.tmp.name).rglob('*.json'):
            self.assertNotIn('SECRET', f.read_text())
    def test_clockback_identity_halt_and_session_preserved(self):
        self.app.feed_start(); self.app.feed_tick(); self.app.feed_stop(); self.app.feed_start()
        self.net.data['gameData']['gameTime'] = 2
        self.app.feed_tick()
        self.assertFalse(self.app.status()['feed']['enabled'])
        self.assertIn('Zeit', self.app.status()['feed']['error'])
        self.app.configure({'gameId': 9, 'hostToken': 'NEXT_GAME_SECRET'}); self.app.feed_start(); self.app.feed_tick()
        self.net.data['allPlayers'][0]['summonerName'] = 'Other'
        self.app.feed_tick(); self.assertFalse(self.app.status()['feed']['enabled'])
    def test_feed_auth_conflict_terminal_and_transient_backoff(self):
        for code in (401, 403, 409):
            self.net.fail = code; self.app.feed_start(); self.app.feed_tick()
            self.assertFalse(self.app.status()['feed']['enabled'])
        self.net.fail = 503; self.app.feed_start(); delay = self.app.feed_tick()
        self.assertTrue(self.app.status()['feed']['enabled']); self.assertGreater(delay, 3)
    def test_feed_no_parallel_duplicate_requests(self):
        self.app.feed_start()
        self.app.feed_lock.acquire()
        try: self.app.feed_tick()
        finally: self.app.feed_lock.release()
        self.assertFalse(any(c[1].endswith('/sendLoLInput') for c in self.net.calls))
    def test_server_download_sha_and_raw_upload(self):
        item = {'matchId': 'EUW1_123', 'gameVersion': '16.20.123.456', 'sha256': hashlib.sha256(self.net.bytes).hexdigest(), 'sizeBytes': len(self.net.bytes)}
        self.net.pool = [item]
        self.app.server_download('EUW1_123')
        self.app.upload('EUW1_123')
        put = self.net.calls[-1]
        self.assertEqual(put[0], 'PUT'); self.assertIsInstance(put[3], Path)
        self.assertEqual(put[2]['X-Replay-Version'], item['gameVersion'])
        self.net.bytes = b'tampered'
        with self.assertRaises(ReplayError): self.app.server_download('EUW1_123')
    def test_url_validation(self):
        for url in ('http://example.com/api', 'https://user:pass@host/api', 'https://host/api?token=x', 'https://host/api#x', 'file:///tmp/a'):
            with self.assertRaises(ValueError): validate_backend(url)
        with self.assertRaises(ValueError): validate_backend('http://127.0.0.1:9999/api')
        self.assertEqual(validate_backend('http://127.0.0.1:9999/api', True), 'http://127.0.0.1:9999/api')

    def test_configuration_starts_passive_feed_without_an_extra_start_action(self):
        self.assertTrue(self.app.status()['feed']['enabled'])
        self.app.feed_tick()
        self.assertEqual(self.app.status()['feed']['sent'], 1)
        self.app.configure({'leagueDir': ''})
        self.assertTrue(self.app.status()['feed']['enabled'])

    def test_passive_feed_keeps_waiting_through_long_transient_outages(self):
        self.net.fail = 503
        for _ in range(12):
            delay = self.app.feed_tick()
            self.assertTrue(self.app.status()['feed']['enabled'])
            self.assertLessEqual(delay, 60)
        self.net.fail = None
        self.app.feed_tick()
        self.assertEqual(self.app.status()['feed']['sent'], 1)

    def test_no_running_game_is_normal_idle_and_starts_forwarding_when_available(self):
        with patch.object(self.net, 'request', side_effect=RemoteError(503)):
            for _ in range(12):
                self.assertEqual(self.app.feed_tick(), 3)
                self.assertTrue(self.app.status()['feed']['enabled'])
                self.assertIsNone(self.app.status()['feed']['error'])
        self.app.feed_tick()
        self.assertEqual(self.app.status()['feed']['sent'], 1)
        with patch.object(self.net, 'request', side_effect=RemoteError(503)):
            self.app.feed_tick()
        self.assertIsNone(self.app.status()['feed']['lastSuccess'])

    def test_changing_game_requires_its_own_host_capability(self):
        self.app.configure({'gameId': 9})
        self.assertFalse(self.app.status()['gamePaired'])
        self.assertFalse(self.app.status()['feed']['enabled'])

    def test_fetch_replays_gets_all_discovered_matches_without_three_file_cap(self):
        self.app.forget()
        client = Mock()
        client.discover.return_value = [{'matchId': f'EUW1_{n}', 'gameVersion': '16.20.123.456'} for n in range(123, 128)]
        client.download.side_effect = lambda identity, game_version, cancel: {'matchId': identity, 'gameVersion': game_version, 'filename': identity + '.rofl'}
        self.app.lcu = client
        result = self.app.run_job('fetch-replays', {})
        self.assertEqual(len(result['items']), 5)
        self.assertEqual(client.download.call_count, 5)
        self.assertFalse(self.net.calls)
        self.assertIn('5 Replays', result['message'])

    def test_fetch_replays_creates_rankings_without_conflating_analysis_and_download(self):
        client = Mock()
        candidates = [{'matchId': 'EUW1_123', 'gameVersion': '16.20.1.2'}]
        client.discover.return_value = candidates
        client.download.return_value = {'matchId': 'EUW1_123', 'filename': 'EUW1-123.rofl'}
        self.app.lcu = client
        rankings = {'items': [], 'error': 'Statistiken gerade nicht verfügbar.'}
        with patch.object(self.app, 'rank_replays', return_value=rankings) as rank:
            result = self.app.fetch_replays()
        rank.assert_called_once_with(candidates)
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['rankings'], rankings)
        first = self.app.enqueue('fetch-replays', {})
        self.assertEqual(self.app.enqueue('fetch-replays', {}), first)


class TerminalTests(unittest.TestCase):
    def test_sort_instructions_stay_visible_below_the_entire_ranking(self):
        output = []
        items = [{'matchId': f'EUW1_{n}', 'scores': terminal_scores()}
                 for n in range(100, 147)]
        companion.print_rankings({'items': items}, output.append)
        last_row = max(index for index, line in enumerate(output) if 'EUW1_' in line)
        self.assertGreater(output.index(companion.SORT_HELP), last_row)
        self.assertIn('s kills | s gold | s carry | s momentum', output[-3])
        self.assertIn('s gold auf = Gold-Verhältnis aufsteigend', output[-2])
        self.assertEqual(output[-1], companion.TERMINAL_HELP)

    def test_terminal_displays_two_ratios_with_raw_team_totals_and_no_mixed_score(self):
        output = []
        companion.print_rankings({'items': [{'matchId': 'EUW1_123', 'scores': terminal_scores()}]}, output.append)
        text = '\n'.join(output)
        self.assertIn('20 / 30 = 0,67', text)
        self.assertIn('43000 / 50000 = 0,86', text)
        self.assertIn('Gold am Ende', text)
        self.assertNotIn('Balance', text)
        self.assertNotIn('Gesamt', text)
        self.assertEqual(companion.format_team_ratio(team_ratio(0, 0)), '0 / 0 = nicht verfügbar')

    def test_terminal_shows_cached_rankings_and_sorts_without_new_downloads(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root, network=FakeNetwork())
            app.ranking_state['items'] = [
                {'matchId': 'EUW1_123', 'scores': terminal_scores()},
                {'matchId': 'EUW1_456', 'scores': terminal_scores(kills=(10, 30), gold=(49000, 50000), carry=20, momentum=85)},
            ]
            commands = iter(('l', 's gold', 's carry', 's momentum', 's kills auf', 'r', 'q'))
            output = []
            result = {'items': [], 'message': 'Replays bereit.', 'rankings': app.rankings()}
            with patch.object(app, 'rank_replays', return_value=app.rankings()) as analyze, \
                 patch.object(app, 'fetch_replays', return_value=result) as fetch, \
                 patch.object(companion, 'print_rankings', wraps=companion.print_rankings) as display, \
                 patch.object(companion.webbrowser, 'open') as browser:
                self.assertEqual(run_terminal(app, input_fn=lambda prompt: next(commands), output_fn=output.append, port=0), 0)
            analyze.assert_called_once_with()  # Startup only; reordering is local.
            fetch.assert_called_once_with()
            browser.assert_not_called()
            selections = [call.args[2:] for call in display.call_args_list]
            for selection in [('kills', True), ('gold', True), ('carry', True), ('momentum', True), ('kills', False)]:
                self.assertIn(selection, selections)
            self.assertEqual(selections[-1], ('kills', False))
            rows = [line for line in output if 'EUW1_123' in line]
            self.assertTrue(rows)
            self.assertTrue(all(row.endswith('       –  noch nicht geladen') for row in rows))
            self.assertIn('noch nicht geladen', '\n'.join(output))

    def test_sort_prompt_and_invalid_choice_preserve_previous_selection(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root, network=FakeNetwork())
            commands = iter(('s', 'momentum auf', 's invalid', 's gold sideways', 'l', 'q'))
            output = []
            with patch.object(app, 'rank_replays', return_value=app.rankings()), \
                 patch.object(app, 'fetch_replays') as fetch, \
                 patch.object(companion, 'print_rankings', wraps=companion.print_rankings) as display:
                run_terminal(app, input_fn=lambda prompt: next(commands), output_fn=output.append, port=0)
            fetch.assert_not_called()
            self.assertEqual(display.call_args.args[2:], ('momentum', False))
            self.assertEqual(sum('Ungültige Sortierung.' in line for line in output), 2)

    def test_terminal_never_asks_for_game_version_id_or_tokens(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root, network=FakeNetwork())
            commands = iter(('r', 'q'))
            output = []
            prompts = []
            def read(prompt):
                prompts.append(prompt)
                return next(commands)
            with patch.object(app, 'configure') as configure, \
                 patch.object(app, 'fetch_replays', return_value={'items': [{'filename': 'EUW1-123.rofl'}], 'message': '1 Replay bereit.'}) as fetch:
                result = run_terminal(app, input_fn=read, output_fn=output.append, port=0)
            self.assertEqual(result, 0)
            fetch.assert_called_once_with()
            configure.assert_not_called()
            self.assertIsNone(app.game_id)
            self.assertFalse(app.feed['enabled'])
            text = '\n'.join(output)
            self.assertIn('EUW1-123.rofl', text)
            self.assertIn('Live-Feed bereit:', text)
            self.assertNotIn('Spiel verbinden', text)
            self.assertNotIn('Token', ''.join(prompts))
            self.assertNotIn('Spiel-ID', ''.join(prompts))
            self.assertNotIn('SECRET', text)
            for file in Path(root).rglob('*.json'):
                self.assertNotIn('SECRET', file.read_text())

    def test_normal_start_never_creates_webserver_or_opens_browser(self):
        with tempfile.TemporaryDirectory() as root, \
             patch.dict('os.environ', {'LOCALAPPDATA': root}), \
             patch.object(sys, 'argv', ['companion.py']), \
             patch.object(companion, 'run_terminal', return_value=0) as terminal, \
             patch.object(companion, 'create_server') as server, \
             patch.object(companion.webbrowser, 'open') as browser:
            self.assertEqual(companion.main(), 0)
            terminal.assert_called_once()
            server.assert_not_called()
            browser.assert_not_called()

    def test_feed_is_available_during_replay_download_without_pairing(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root, network=FakeNetwork())
            output = []
            commands = iter(('r', 'q'))
            def fetch():
                address = next(line for line in output if line.startswith('Live-Feed bereit: ')).split('http://', 1)[1]
                host = address.split('/')[0]
                connection = http.client.HTTPConnection(host)
                connection.request('GET', '/lol-data')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), app.network.data)
                connection.close()
                return {'items': [], 'message': 'Keine Replays.'}
            with patch.object(app, 'fetch_replays', side_effect=fetch):
                self.assertEqual(run_terminal(app, input_fn=lambda prompt: next(commands), output_fn=output.append, port=0), 0)


class PassiveFeedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = App(self.tmp.name, network=FakeNetwork())
        self.server = create_feed_server(self.app, port=0)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.worker.join()
        self.app.close(); self.tmp.cleanup()

    def request(self, path, method='GET', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_live_feed_works_from_startup_without_game_or_token(self):
        self.assertIsNone(self.app.game_id)
        self.assertFalse(self.app.host_token)
        self.assertEqual(self.request('/health')[0], 200)
        code, headers, raw = self.request('/lol-data', headers={'Origin': 'https://bronze-brawl.de'})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(raw), self.app.network.data)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://bronze-brawl.de')

    def test_no_ui_management_or_write_api_is_exposed(self):
        for path in ('/', '/api/bootstrap', '/api/status'):
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request('/api/config', method='POST')[0], 405)
        self.assertEqual(self.request('/lol-data', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/lol-data', headers={'Host': 'evil.example'})[0], 403)

    def test_rankings_are_terminal_only_not_a_web_api(self):
        self.assertEqual(self.request('/replay-rankings')[0], 404)
        self.assertEqual(self.request('/replay-rankings', method='OPTIONS')[0], 403)
        self.assertEqual(self.request('/replay-rankings', headers={'Origin': 'https://bronze-brawl.de'})[0], 403)
        self.assertEqual(self.request('/replay-rankings', headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('/replay-rankings', method='POST')[0], 405)

    def test_unavailable_client_recovers_without_restarting_or_pairing(self):
        with patch.object(self.app.network, 'request', side_effect=RemoteError(503)):
            self.assertEqual(self.request('/lol-data')[0], 503)
        self.assertEqual(self.request('/lol-data')[0], 200)


class HTTPTests(AppTests):
    def setUp(self):
        super().setUp()
        self.server = create_server(self.app, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.host = '127.0.0.1:' + str(self.server.server_port); self.origin = 'http://' + self.host
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); super().tearDown()
    def req(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request(method, path, body=body, headers=headers or {})
        r = conn.getresponse(); out = (r.status, dict(r.getheaders()), r.read()); conn.close(); return out
    def test_real_http_host_origin_csrf_and_no_secret_echo(self):
        self.assertEqual(self.req('GET', '/health')[0], 200)
        self.assertEqual(self.req('GET', '/', headers={'Host': 'evil.example'})[0], 403)
        self.assertEqual(self.req('GET', '/api/status', headers={'Origin': 'https://evil.example'})[0], 403)
        public = {'Origin': 'https://bronze-brawl.janhec.de'}
        self.app.feed_stop()  # Browser relay is only permitted without direct forwarding.
        code, h, body = self.req('GET', '/lol-data', headers=public)
        self.assertEqual(code, 200); self.assertEqual(h['Access-Control-Allow-Origin'], public['Origin'])
        self.assertEqual(self.req('GET', '/api/bootstrap', headers=public)[0], 403)
        code, h, body = self.req('GET', '/api/bootstrap')
        token = json.loads(body)['token']; self.assertGreaterEqual(len(token), 32)
        self.assertEqual(self.req('POST', '/api/feed/start', '{}', {'Origin': self.origin, 'Content-Type': 'application/json'})[0], 403)
        auth = {'Origin': self.origin, 'Content-Type': 'application/json', 'X-Companion-Token': token}
        self.assertEqual(self.req('POST', '/api/feed/start', '{}', auth)[0], 200)
        self.assertEqual(self.req('POST', '/api/feed/stop', '{}', {**auth, 'Origin': 'https://evil.example'})[0], 403)
        self.assertNotIn(b'SECRET', self.req('GET', '/api/status')[2])
        self.assertEqual(self.req('GET', '/api/status?token=oops')[0], 400)
        self.assertEqual(self.req('POST', '/api/config', '{', auth)[0], 400)
        self.assertEqual(self.req('GET', '/nope')[0], 404)
        self.assertIn(b'BronzeBrawl', self.req('GET', '/')[2])
        code, _, html = self.req('GET', '/')
        self.assertIn(b'Replays holen', html)
        self.assertIn(b'Livegame-Daten', html)
        for removed in (b'Pool-Token', b'feedStart', b'feedStop', b'reserve', b'refillToggle', b'localItems'):
            self.assertNotIn(removed, html)
        code, _, bootstrap = self.req('GET', '/api/bootstrap')
        self.assertNotIn(b'SECRET', bootstrap)
        self.assertIn('backendUrl', json.loads(bootstrap)['settings'])

    def test_current_public_site_can_read_passive_relay_but_not_management(self):
        self.app.feed_stop()
        origin = {'Origin': 'https://bronze-brawl.de'}
        code, headers, _ = self.req('GET', '/lol-data', headers=origin)
        self.assertEqual(code, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], origin['Origin'])
        self.assertEqual(self.req('GET', '/api/bootstrap', headers=origin)[0], 403)
    def test_no_lol_real_http_unavailable_not_fake(self):
        self.app.network = Network(timeout=0.2)
        # Do not assume the developer's real LoL client is closed on port 2999.
        with patch.object(self.app.network, '_open', side_effect=urllib.error.URLError('test: client unavailable')):
            code, _, body = self.req('GET', '/lol-data')
        self.assertEqual(code, 503); self.assertIn('nicht', json.loads(body)['error'])


if __name__ == '__main__': unittest.main()
