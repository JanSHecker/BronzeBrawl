"""Tests use structural replay fixtures and fake transports, not real match recordings."""
import hashlib
import base64
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


def connection_code(game_id=8, token='a' * 64, backend='https://app.example/api'):
    raw = json.dumps({'backendUrl': backend, 'gameId': game_id, 'token': token}).encode()
    return 'BB1.' + base64.urlsafe_b64encode(raw).decode().rstrip('=')


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


class DirectNetwork(FakeNetwork):
    def __init__(self):
        super().__init__()
        self.unavailable = False
        self.input_fail = None
        self.sent = threading.Event()
        self.state = 'live'

    def request(self, method, url, headers=None, body=None, local=False):
        if '/companion/' not in url:
            if self.unavailable and url.endswith('/allgamedata'):
                raise RemoteError(503)
            return super().request(method, url, headers, body, local)
        self.calls.append((method, url, headers or {}, body, local))
        if self.fail:
            raise RemoteError(self.fail)
        if url.endswith('/heartbeat'):
            return {'ok': True, 'gameId': body['gameId']}
        if self.input_fail:
            raise RemoteError(self.input_fail)
        self.sent.set()
        return {'gameId': body['gameId'], 'state': self.state}


class DirectFeedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.net = DirectNetwork()
        self.app = App(self.tmp.name, network=self.net)
        self.app.connect_code(connection_code())

    def tearDown(self):
        self.app.close(); self.tmp.cleanup()

    def test_direct_sender_uses_scoped_token_and_fresh_reads_even_when_clock_is_paused(self):
        for _ in range(2):
            self.assertEqual(self.app.feed_tick(), 3)
        inputs = [call for call in self.net.calls if call[1].endswith('/companion/input')]
        self.assertEqual(len(inputs), 2)
        self.assertTrue(all(call[1] == 'https://app.example/api/companion/input' for call in inputs))
        self.assertTrue(all(call[2] == {'X-Companion-Token': 'a' * 64} for call in inputs))
        self.assertEqual(inputs[0][3], {'gameId': 8, 'input': self.net.data})
        self.assertEqual(sum(call[1].endswith('/allgamedata') for call in self.net.calls), 2)
        self.assertTrue(self.app.feed['connected'])
        self.assertEqual(self.app.feed['sent'], 2)

    def test_heartbeat_proves_connection_without_lol_and_recovers_automatically(self):
        self.net.unavailable = True
        self.app.feed_tick()
        self.assertTrue(self.app.feed['connected'])
        self.assertIn('warte auf LoL', companion.connection_status(self.app.feed))
        self.assertEqual(self.net.calls[-1][3]['availability'], 'waiting')
        self.assertFalse(self.net.sent.is_set())
        self.net.unavailable = False
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 1)
        self.net.fail = 503
        for _ in range(8):
            self.assertLessEqual(self.app.feed_tick(), 12)
            self.assertTrue(self.app.feed['enabled'])
            self.assertFalse(self.app.feed['connected'])
        self.net.fail = None
        self.app.feed_tick()
        self.assertTrue(self.app.feed['connected'])

    def test_restart_restores_only_restricted_connection_and_revocation_stops_sender(self):
        self.app.feed_tick()
        restored = App(self.tmp.name, network=self.net)
        try:
            self.assertEqual(restored.companion_token, 'a' * 64)
            self.assertFalse(restored.host_token)
            self.assertTrue(restored.feed['enabled'])
            self.assertFalse(restored.feed['connected'])
            restored.feed_tick()
            self.net.fail = 403
            restored.feed_tick()
            self.assertFalse(restored.feed['enabled'])
            self.assertIn('Verbindung abgelehnt', restored.feed['error'])
            count = len(self.net.calls)
            restored.feed_tick()
            self.assertEqual(len(self.net.calls), count)
        finally:
            restored.close()

    def test_input_413_keeps_heartbeats_and_retries_fresh_data_without_advancing_session(self):
        self.app.feed_tick()
        previous_session = dict(self.app.sessions)
        last_success = self.app.feed['lastSuccess']
        self.net.data = json.loads(json.dumps(self.net.data))
        self.net.data['gameData']['gameTime'] = 11
        self.net.input_fail = 413
        for attempt in range(8):
            self.assertEqual(self.app.feed_tick(), 6 if attempt == 0 else 12)
            self.assertTrue(self.app.feed['enabled'])
            self.assertTrue(self.app.feed['connected'])
            self.assertEqual(self.app.feed['sent'], 1)
            self.assertEqual(self.app.feed['lastSuccess'], last_success)
            self.assertEqual(self.app.sessions, previous_session)
            self.assertIn('HTTP 413', self.app.feed['error'])
            self.assertIn('Größenlimit', companion.connection_status(self.app.feed))
            self.assertIn('App verbunden', companion.connection_status(self.app.feed))
            self.assertNotIn('Verbindungscode', self.app.feed['error'])
        self.assertEqual(sum(call[1].endswith('/companion/heartbeat') for call in self.net.calls), 9)
        self.assertEqual(sum(call[1].endswith('/allgamedata') for call in self.net.calls), 9)
        self.net.input_fail = None
        self.net.data = json.loads(json.dumps(self.net.data))
        self.net.data['gameData']['gameTime'] = 12
        self.assertEqual(self.app.feed_tick(), 3)
        self.assertEqual(self.app.feed['sent'], 2)
        self.assertEqual(self.app.feed['failures'], 0)
        self.assertIsNone(self.app.feed['error'])
        self.assertEqual(self.net.calls[-1][3]['input']['gameData']['gameTime'], 12)
        self.assertEqual(next(iter(self.app.sessions.values()))['clock'], 12)
        self.assertEqual(self.app.companion_token, 'a' * 64)

    def test_heartbeat_413_does_not_claim_connectivity_or_disable_sender(self):
        self.app.feed_tick()
        self.net.fail = 413
        self.app.feed_tick()
        self.assertTrue(self.app.feed['enabled'])
        self.assertFalse(self.app.feed['connected'])
        self.assertIn('HTTP 413', self.app.feed['error'])
        self.net.fail = None
        self.app.feed_tick()
        self.assertTrue(self.app.feed['connected'])
        self.assertIsNone(self.app.feed['error'])

    def test_changed_game_is_not_forwarded_but_heartbeat_continues(self):
        self.app.feed_tick()
        self.net.data['gameData']['gameTime'] = 0
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 1)
        self.assertEqual(self.app.feed['availability'], 'conflict')
        self.assertEqual(self.net.calls[-1][3]['availability'], 'conflict')
        self.assertTrue(self.app.feed['connected'])
        self.app.connect_code(connection_code(game_id=9))
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 1)

    def test_bad_codes_are_rejected_without_changing_destination_or_echoing_secrets(self):
        for code in ('bad', 'BB1.@@@', connection_code(token='wrong'), connection_code(game_id=True), connection_code(backend='http://example.com/api')):
            with self.assertRaisesRegex(ReplayError, 'Verbindungscode ungültig'):
                self.app.connect_code(code)
        self.assertEqual(self.app.backend, 'https://app.example/api')
        self.assertNotIn('a' * 64, json.dumps(self.app.status()))
        self.app.forget()
        self.assertFalse((Path(self.tmp.name) / 'connection.json').exists())

    def test_game_end_keeps_heartbeat_without_resubmitting_a_finished_game(self):
        self.net.state = 'ended'
        self.app.feed_tick()
        self.net.data['gameData']['gameTime'] += 1
        self.app.feed_tick()
        self.assertTrue(self.app.feed['connected'])
        self.assertEqual(self.app.feed['sent'], 1)
        self.assertIn('Spiel beendet', companion.connection_status(self.app.feed))
        self.assertTrue(self.net.calls[-1][1].endswith('/heartbeat'))


class LiveCaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.net = DirectNetwork()
        self.app = App(self.tmp.name, network=self.net)
        self.app.connect_code(connection_code())

    def tearDown(self):
        self.app.close(); self.tmp.cleanup()

    def snapshots(self, app=None):
        return sorted((app or self.app).recording.directory.glob('snapshot-*.json'))

    def test_each_fetch_preserves_the_full_payload_even_when_paused(self):
        self.net.data['events']['Events'] = [{
            'EventID': 12, 'EventName': 'HordeKill', 'EventTime': 9.125,
            'KillerName': 'Tést#EUW', 'Assisters': ['Support#EUW'], 'unknownFutureField': {'value': 3},
        }]
        original = json.loads(json.dumps(self.net.data))
        self.app.feed_tick(); self.app.feed_tick()
        files = self.snapshots()
        self.assertEqual(len(files), 2)
        self.assertTrue(files[0].name.startswith('snapshot-00000001-'))
        self.assertTrue(files[1].name.startswith('snapshot-00000002-'))
        for file in files:
            self.assertEqual(json.loads(file.read_text(encoding='utf-8')), original)
        self.net.data['gameData']['gameTime'] = 11
        self.net.data['events']['Events'].clear()
        self.app.feed_tick()
        self.assertEqual(json.loads(files[0].read_text(encoding='utf-8')), original)
        self.assertEqual(self.app.status()['recording']['saved'], 3)
        self.assertIsNone(self.app.status()['recording']['error'])
        manifest = json.loads((self.app.recording.directory / 'run.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['schemaVersion'], 1)
        self.assertEqual(manifest['source'], 'https://127.0.0.1:2999/liveclientdata/allgamedata')
        self.assertEqual(manifest['snapshotPattern'], 'snapshot-*.json')
        self.assertEqual(list(self.app.recording.directory.glob('.state-*')), [])
        for file in self.app.recording.directory.glob('*.json'):
            self.assertNotIn('a' * 64, file.read_text(encoding='utf-8'))
            self.assertNotIn('backendUrl', file.read_text(encoding='utf-8'))

    def test_backend_rejection_and_source_conflicts_still_leave_captures(self):
        self.net.input_fail = 400
        self.app.feed_tick()
        self.assertEqual(len(self.snapshots()), 1)
        self.assertEqual(self.app.feed['sent'], 0)
        self.assertFalse(self.app.feed['enabled'])
        self.net.input_fail = None
        self.app.feed_start(); self.app.feed_tick()
        self.net.data['gameData']['gameTime'] = 0
        self.app.feed_tick()
        self.assertEqual(len(self.snapshots()), 3)
        self.assertEqual(self.app.feed['availability'], 'conflict')
        self.assertEqual(json.loads(self.snapshots()[-1].read_text())['gameData']['gameTime'], 0)

    def test_unavailable_client_creates_no_empty_run_but_incomplete_json_is_retained(self):
        self.net.unavailable = True
        self.app.feed_tick()
        self.assertFalse(self.app.recording.directory.exists())
        self.net.unavailable = False
        self.net.data = {'unexpected': 'incomplete client response'}
        self.app.feed_tick()
        self.assertEqual(json.loads(self.snapshots()[0].read_text()), self.net.data)
        self.assertEqual(self.app.feed['sent'], 0)

    def test_restart_uses_a_new_folder_without_overwriting_previous_run(self):
        self.app.feed_tick()
        previous_file = self.snapshots()[0]
        previous_data = previous_file.read_bytes()
        restored = App(self.tmp.name, network=self.net)
        try:
            self.assertNotEqual(restored.recording.directory, self.app.recording.directory)
            restored.feed_tick()
            self.assertEqual(len(self.snapshots(restored)), 1)
            self.assertTrue(self.snapshots(restored)[0].name.startswith('snapshot-00000001-'))
            self.assertEqual(previous_file.read_bytes(), previous_data)
        finally:
            restored.close()

    def test_disk_failure_does_not_stop_delivery_and_recording_retries(self):
        blocked = Path(self.tmp.name) / 'captures'
        blocked.write_text('not a directory')
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 1)
        self.assertTrue(self.app.feed['connected'])
        self.assertIsNone(self.app.feed['error'])
        self.assertEqual(self.app.recording.status()['saved'], 0)
        self.assertIn('Live-Aufzeichnung fehlgeschlagen', self.app.recording.status()['error'])
        blocked.unlink()
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 2)
        self.assertEqual(len(self.snapshots()), 1)
        self.assertTrue(self.snapshots()[0].name.startswith('snapshot-00000002-'))
        self.assertIsNone(self.app.recording.status()['error'])

    def test_concurrent_shared_fetches_have_unique_complete_files(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.app.live_data(), range(12)))
        self.assertEqual(len(results), 12)
        self.assertEqual(len(self.snapshots()), 12)
        self.assertEqual(self.app.recording.status()['saved'], 12)
        for index, file in enumerate(self.snapshots(), 1):
            self.assertTrue(file.name.startswith(f'snapshot-{index:08d}-'))
            self.assertEqual(json.loads(file.read_text()), self.net.data)

    def test_legacy_sender_records_fetches_that_it_skips_at_an_unchanged_clock(self):
        legacy = App(Path(self.tmp.name) / 'legacy', network=FakeNetwork())
        try:
            legacy.configure({'gameId': 8, 'hostToken': 'HOST_SECRET'})
            legacy.feed_tick(); legacy.feed_tick()
            self.assertEqual(legacy.feed['sent'], 1)
            self.assertEqual(len(self.snapshots(legacy)), 2)
        finally:
            legacy.close()

    def test_terminal_prints_capture_location_count_and_independent_warning(self):
        (Path(self.tmp.name) / 'captures').write_text('not a directory')
        self.app.feed_tick()
        commands = iter(('t', 'q'))
        output = []
        with patch.object(self.app, 'start_workers'), \
             patch.object(self.app, 'rank_replays', return_value=self.app.rankings()):
            run_terminal(self.app, input_fn=lambda prompt: next(commands), output_fn=output.append)
        text = '\n'.join(output)
        self.assertIn(str(self.app.recording.directory), text)
        self.assertIn('Lokal gespeicherte Snapshots: 0', text)
        self.assertIn('Live-Aufzeichnung fehlgeschlagen', text)
        self.assertNotIn('a' * 64, text)


class DirectHTTPTests(unittest.TestCase):
    def test_real_http_sender_needs_no_browser_or_local_feed_server(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        received = []
        input_status = {'value': 200}
        class Backend(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                received.append((self.path, self.headers.get('X-Companion-Token'), data))
                response = {'ok': True, 'gameId': data['gameId']} if self.path.endswith('/heartbeat') else {'gameId': data['gameId'], 'state': 'live'}
                raw = json.dumps(response).encode()
                self.send_response(200 if self.path.endswith('/heartbeat') else input_status['value'])
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        class LocalLoL(Network):
            def request(self, method, url, headers=None, body=None, local=False):
                if local:
                    return FakeNetwork().data
                return super().request(method, url, headers, body, local)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory() as root:
                app = App(root, network=LocalLoL(), allow_http_local=True)
                try:
                    app.connect_code(connection_code(backend=f'http://127.0.0.1:{server.server_port}/api'))
                    app.feed_tick(); app.feed_tick()
                    self.assertEqual(app.feed['sent'], 2)
                    self.assertTrue(app.feed['connected'])
                    self.assertEqual([row[0] for row in received], ['/api/companion/heartbeat', '/api/companion/input'] * 2)
                    self.assertTrue(all(row[1] == 'a' * 64 and row[2]['gameId'] == 8 for row in received))
                    self.assertEqual(received[1][2]['input'], FakeNetwork().data)
                    # Exercise urllib's real HTTPError mapping, not only a fake transport.
                    input_status['value'] = 413
                    self.assertEqual(app.feed_tick(), 6)
                    self.assertTrue(app.feed['enabled'])
                    self.assertTrue(app.feed['connected'])
                    self.assertEqual(app.feed['sent'], 2)
                    self.assertIn('HTTP 413', app.feed['error'])
                    input_status['value'] = 200
                    self.assertEqual(app.feed_tick(), 3)
                    self.assertEqual(app.feed['sent'], 3)
                    self.assertIsNone(app.feed['error'])
                finally:
                    app.close()
        finally:
            server.shutdown(); server.server_close(); worker.join()


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
    def test_legacy_feed_413_retries_without_new_credentials_or_skipping_rejected_clock(self):
        self.net.fail = 413
        for attempt in range(8):
            delay = self.app.feed_tick()
            self.assertTrue(self.app.feed['enabled'])
            self.assertLessEqual(delay, 60)
            self.assertGreater(delay, 3)
            self.assertEqual(self.app.feed['sent'], 0)
            self.assertFalse(self.app.sessions)
            self.assertIn('HTTP 413', self.app.feed['error'])
            self.assertNotIn('erneut verbinden', self.app.feed['error'])
        self.net.fail = None
        self.app.feed_tick()  # Same clock must still be eligible after rejection.
        self.assertEqual(self.app.feed['sent'], 1)
        self.assertIsNone(self.app.feed['error'])
        self.assertEqual(self.app.feed['failures'], 0)
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

    def test_terminal_displays_only_percentages_without_absolute_team_totals_or_mixed_score(self):
        output = []
        companion.print_rankings({'items': [{'matchId': 'EUW1_123', 'scores': terminal_scores()}]}, output.append)
        text = '\n'.join(output)
        self.assertIn('66,67 %', text)
        self.assertIn('86,00 %', text)
        self.assertNotIn('20 / 30', text)
        self.assertNotIn('43000', text)
        self.assertNotIn('50000', text)
        self.assertIn('Gold (Ende)', text)
        self.assertNotIn('Balance', text)
        self.assertNotIn('Gesamt', text)
        self.assertEqual(companion.format_team_ratio(team_ratio(0, 0)), '–')
        self.assertEqual(companion.format_team_ratio(team_ratio(0, 10)), '0,00 %')
        self.assertEqual(companion.format_team_ratio(team_ratio(10, 10)), '100,00 %')

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
            self.assertIn('Direkt-Feed:', text)
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

    def test_direct_sender_runs_during_replay_download_without_webserver(self):
        with tempfile.TemporaryDirectory() as root:
            net = DirectNetwork()
            app = App(root, network=net)
            output = []
            commands = iter(('v', 'r', 'q'))
            def fetch():
                self.assertTrue(net.sent.wait(5), 'Background sender did not run during replay command')
                return {'items': [], 'message': 'Keine Replays.'}
            with patch.object(app, 'fetch_replays', side_effect=fetch), \
                 patch.object(companion, 'create_feed_server') as server:
                self.assertEqual(run_terminal(app, input_fn=lambda prompt: next(commands), output_fn=output.append, code_input_fn=lambda prompt: connection_code()), 0)
            server.assert_not_called()
            self.assertNotIn('a' * 64, '\n'.join(output))


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
        snapshots = list(self.app.recording.directory.glob('snapshot-*.json'))
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(json.loads(snapshots[0].read_text()), self.app.network.data)

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
