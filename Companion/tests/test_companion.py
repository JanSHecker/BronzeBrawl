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
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion import App, create_server
from network import Network, RemoteError, validate_backend
from replay import Cache, LCU, ReplayError, inspect_rofl


def fixture(game=123, version='16.20.123.456'):
    meta = json.dumps({'gameVersion': version}).encode()
    header = bytearray(288)
    header[:6] = b'RIOT\x00\x00'
    payload = struct.pack('<Q', game) + b'\x00' * 30
    struct.pack_into('<HIIIIII', header, 262, 288, 288 + len(meta) + len(payload), 288, len(meta), 288 + len(meta), len(payload), 288 + len(meta) + len(payload))
    return bytes(header) + meta + payload


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
        self.app.configure({'gameId': 9}); self.app.feed_start(); self.app.feed_tick()
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
    def test_no_lol_real_http_unavailable_not_fake(self):
        self.app.network = Network(timeout=0.2)
        code, _, body = self.req('GET', '/lol-data')
        self.assertEqual(code, 503); self.assertIn('nicht', json.loads(body)['error'])


if __name__ == '__main__': unittest.main()
