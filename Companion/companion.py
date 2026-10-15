"""BronzeBrawl Companion: one local app, independent feed and bounded replay jobs."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import queue
import secrets
import shutil
import tempfile
import threading
import time
import webbrowser

from network import MAX_FILE, Network, RemoteError, validate_backend
from replay import Cache, LCU, ReplayError, atomic_json, match_id, patch_of, version

DEFAULT_BACKEND = 'https://bronze-brawl.janhec.de/api'
PUBLIC_ORIGIN = 'https://bronze-brawl.janhec.de'
STATIC = Path(__file__).resolve().parent


def positive_id(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= 9007199254740991:
        raise ValueError('Positive ganzzahlige BronzeBrawl-Spiel-ID erforderlich.')
    return value


def safe_error(exc):
    if isinstance(exc, (ReplayError, RemoteError)):
        return str(exc)
    return 'Lokaler Vorgang fehlgeschlagen. Client, Einstellungen und freien Speicher prüfen.'


class App:
    def __init__(self, root, network=None, allow_http_local=False):
        self.root = Path(root); self.root.mkdir(parents=True, exist_ok=True)
        self.network = network or Network(); self.allow_http_local = allow_http_local
        self.cache = Cache(self.root / 'cache')
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock(); self.feed_lock = threading.Lock(); self.replay_lock = threading.Lock()
        self.stop_event = threading.Event(); self.feed_wake = threading.Event(); self.refill_wake = threading.Event()
        self.backend = DEFAULT_BACKEND; self.pool_token = ''; self.host_token = ''; self.game_id = None
        self.league_dir = ''; self.target = 5; self.refill_enabled = False; self.workers = []
        self.lcu = LCU(self.network)
        self.feed = {'enabled': False, 'error': None, 'sent': 0, 'failures': 0, 'lastSuccess': None, 'availability': 'nicht geprüft'}
        self.refill = {'enabled': False, 'error': None, 'lastCheck': None, 'compatibleUnreserved': None}
        self.jobs = {}; self.job_queue = queue.Queue(maxsize=8); self.candidates = []
        self.sessions = {}
        try:
            saved = json.loads((self.root / 'settings.json').read_text(encoding='utf-8'))
            self.backend = validate_backend(saved.get('backendUrl', DEFAULT_BACKEND), allow_http_local)
            self.league_dir = saved.get('leagueDir', '')
            self.lcu = LCU(self.network, self.league_dir)
            self.target = max(1, min(20, int(saved.get('target', 5))))
        except (OSError, ValueError, TypeError):
            pass
        try:
            sessions = json.loads((self.root / 'sessions.json').read_text(encoding='utf-8'))
            if isinstance(sessions, dict):
                self.sessions = sessions
        except (OSError, ValueError):
            pass

    def configure(self, data):
        if not isinstance(data, dict):
            raise ValueError('JSON-Objekt erforderlich.')
        with self.lock:
            if self.feed['enabled'] or self.replay_lock.locked():
                raise ReplayError('Vor Änderungen Direkt-Feed stoppen und Replay-Auftrag abwarten.')
            backend = validate_backend(data.get('backendUrl', self.backend), self.allow_http_local)
            gid = positive_id(data['gameId']) if 'gameId' in data else self.game_id
            target = data.get('target', self.target)
            if isinstance(target, bool) or not isinstance(target, int) or not 1 <= target <= 20:
                raise ValueError('Refill-Ziel muss zwischen 1 und 20 liegen.')
            league = data.get('leagueDir', self.league_dir)
            if not isinstance(league, str) or len(league) > 1024 or (league and (not Path(league).is_absolute() or league.startswith(('\\\\', '//')) or not Path(league).is_dir())):
                raise ValueError('League-Installationsordner muss ein vorhandener lokaler absoluter Ordner sein.')
            for key in ('poolToken', 'hostToken'):
                value = data.get(key, '')
                if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 or ord(c) > 126 for c in value):
                    raise ValueError('Token ungültig.')
            # Blank fields retain current memory-only tokens. Explicit forget clears all.
            self.backend = backend; self.game_id = gid; self.target = target; self.league_dir = league
            if data.get('poolToken'):
                self.pool_token = data['poolToken']
            if data.get('hostToken'):
                self.host_token = data['hostToken']
            self.lcu = LCU(self.network, league)
            atomic_json(self.root / 'settings.json', {'backendUrl': backend, 'leagueDir': league, 'target': target})
        return {'ok': True}

    def forget(self):
        self.feed_stop()
        with self.lock:
            self.pool_token = ''; self.host_token = ''; self.game_id = None
            self.refill_enabled = False; self.refill['enabled'] = False
        return {'ok': True}

    def status(self):
        with self.lock:
            return {'poolPaired': bool(self.pool_token), 'gamePaired': bool(self.game_id and self.host_token),
                    'feed': dict(self.feed), 'refill': dict(self.refill), 'jobs': [dict(j) for j in self.jobs.values()],
                    'localItems': self.cache.items(), 'candidates': list(self.candidates),
                    'replayFormat': 'RIOT/ROFL1 unterstützt; ROFL2/RLR derzeit ausdrücklich nicht unterstützt',
                    'replayLiveData': 'Unbewiesen: Ein gestartetes Replay garantiert keine Liveclient-Daten. Keine Ereignisrekonstruktion.'}

    def live_data(self):
        try:
            data = self.network.request('GET', 'https://127.0.0.1:2999/liveclientdata/allgamedata', local=True)
        except RemoteError:
            with self.lock:
                self.feed['availability'] = 'nicht verfügbar (LoL/Replay stellt keine Liveclient-Daten bereit)'
            raise ReplayError('LoL-Live-Daten nicht verfügbar. Spiel starten; Replay-Unterstützung ist unbewiesen.') from None
        if not isinstance(data, dict) or not isinstance(data.get('gameData'), dict) or not isinstance(data.get('allPlayers'), list):
            raise ReplayError('LoL liefert keine unterstützten Live-Daten.')
        with self.lock:
            self.feed['availability'] = 'echte Liveclient-Daten verfügbar'
        return data

    def feed_start(self):
        with self.lock:
            if not self.game_id or not self.host_token:
                raise ReplayError('Zuerst Spiel-ID und Host-Token paaren.')
            self.feed.update(enabled=True, error=None, failures=0)
        self.feed_wake.set()
        return {'ok': True}

    def feed_stop(self):
        with self.lock:
            self.feed['enabled'] = False
        self.feed_wake.set()
        return {'ok': True}

    def feed_tick(self):
        if not self.feed_lock.acquire(blocking=False):
            return 3
        try:
            with self.lock:
                if not self.feed['enabled']:
                    return 3
                gid, token, backend = self.game_id, self.host_token, self.backend
            try:
                data = self.live_data()
                clock = data['gameData'].get('gameTime')
                players = data['allPlayers']
                if isinstance(clock, bool) or not isinstance(clock, (int, float)) or not math.isfinite(clock) or clock < 0 or not 0 < len(players) <= 20 or not all(isinstance(p, dict) for p in players):
                    raise ReplayError('LoL-Live-Daten unvollständig.')
                roster = sorted((str(p.get('riotId', p.get('summonerName', ''))), str(p.get('championName', '')), str(p.get('team', ''))) for p in players)
                identity = hashlib.sha256(json.dumps([roster, data['gameData'].get('gameMode'), data['gameData'].get('mapNumber')], sort_keys=True).encode()).hexdigest()
                # Scope session to backend + BronzeBrawl game id; preserve across stop/restart.
                key = hashlib.sha256((backend + ':' + str(gid)).encode()).hexdigest()
                previous = self.sessions.get(key)
                if previous and (previous.get('identity') != identity or clock < previous.get('clock', 0)):
                    with self.lock:
                        self.feed.update(enabled=False, error='Zeit-Rücksprung oder Spielidentität geändert. Dasselbe Spiel wird nicht neu etikettiert; Host muss eine neue Spielsession anlegen.')
                    return 3
                if previous and clock == previous.get('clock'):
                    return 3
                with self.lock:
                    if not self.feed['enabled']:
                        return 3
                # One fresh fetch, one POST; retries fetch again, never replay a stale buffer.
                self.network.request('POST', backend + '/sendLoLInput', {'X-Game-Token': token}, {'gameId': gid, 'input': data})
                self.sessions[key] = {'identity': identity, 'clock': clock}
                atomic_json(self.root / 'sessions.json', self.sessions)
                with self.lock:
                    self.feed.update(sent=self.feed['sent'] + 1, failures=0, error=None, lastSuccess=int(time.time()))
                return 3
            except RemoteError as e:
                with self.lock:
                    if e.status in (401, 403, 409) or (400 <= e.status < 500 and e.status != 429):
                        self.feed.update(enabled=False, error=f'Direkt-Feed gestoppt (HTTP {e.status}); Paarung/Host-Spiel prüfen. Kein automatisches Neuverbinden dieser Session.')
                        return 3
                return self._feed_failure(e)
            except (ReplayError, OSError, ValueError, KeyError, TypeError) as e:
                return self._feed_failure(e)
        finally:
            self.feed_lock.release()

    def _feed_failure(self, exc):
        with self.lock:
            failures = self.feed['failures'] + 1
            self.feed.update(failures=failures, error=safe_error(exc))
            if failures >= 6:
                self.feed['enabled'] = False
                self.feed['error'] += ' Nach 6 Versuchen pausiert; manuell erneut starten.'
        return min(60, 3 * 2 ** min(failures, 5))

    def _pool(self, method, route, body=None, extra=None):
        with self.lock:
            if not self.pool_token:
                raise ReplayError('Replay-Pool-Token fehlt. Nicht den Host-Spiel-Token verwenden.')
            backend, token = self.backend, self.pool_token
        return self.network.request(method, backend + route, {'X-Replay-Token': token, **(extra or {})}, body)

    def server_list(self):
        result = self._pool('GET', '/replays')
        if not isinstance(result, dict) or not isinstance(result.get('items'), list):
            raise ReplayError('Replay-Pool antwortet nicht im erwarteten API-Format.')
        return result

    def upload(self, identity):
        item = self.cache.get(identity)
        key = hashlib.sha256(self.backend.encode()).hexdigest()
        if key in item.get('uploadedTo', []):
            return {'matchId': identity, 'alreadyUploaded': True}
        result = self._pool('PUT', '/replays/' + match_id(identity) + '/file', self.cache.path(identity), {'X-Replay-Version': item['gameVersion']})
        self.cache.mark_uploaded(identity, self.backend)
        return result

    def server_download(self, identity):
        match_id(identity)
        item = next((i for i in self.server_list()['items'] if i.get('matchId') == identity), None)
        if not item:
            raise ReplayError('Server-Replay nicht gefunden.')
        version(item.get('gameVersion'))
        digest = item.get('sha256')
        if not isinstance(digest, str) or len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ReplayError('Server liefert keine gültige SHA256-Prüfsumme.')
        if not isinstance(item.get('sizeBytes'), int) or not 0 < item['sizeBytes'] <= MAX_FILE:
            raise ReplayError('Server-Replay-Dateigröße ungültig.')
        if shutil.disk_usage(self.root).free < item['sizeBytes'] * 2 + 64 * 1024 * 1024:
            raise ReplayError('Nicht genügend freier Speicher für Download und atomare Cache-Kopie.')
        fd, tmp = tempfile.mkstemp(prefix='.download-', dir=self.root); os.close(fd)
        try:
            self.network.download(self.backend + '/replays/' + identity + '/file', tmp, {'X-Replay-Token': self.pool_token})
            if Path(tmp).stat().st_size != item['sizeBytes']:
                raise ReplayError('Server-Dateigröße stimmt nicht überein.')
            return self.cache.add(tmp, identity, item['gameVersion'], expected_sha=digest)
        finally:
            Path(tmp).unlink(missing_ok=True)

    def reserve(self, data):
        gid = positive_id(data.get('gameId'))
        v = data.get('gameVersion') or self.lcu.current_version(); version(v)
        sort = data.get('sortBy', 'overall')
        if sort not in ('overall', 'balance', 'carry', 'momentum'):
            raise ReplayError('Unbekannte Sortierung.')
        result = self._pool('POST', '/replays/reserve', {'gameId': gid, 'gameVersion': v, 'sortBy': sort})
        item = result.get('item') if isinstance(result, dict) else None
        if not isinstance(item, dict):
            raise ReplayError('Server hat kein vorbereitetes Replay reserviert.')
        # Reserve is separate from slow discovery; fetch only the selected prepared file.
        local = self.server_download(item['matchId'])
        return {'item': local, 'message': 'Reserviert und geladen. Wiedergabe separat starten; Reservierung bleibt bei Fehlern erhalten.'}

    def discover(self):
        result = self.lcu.discover()
        with self.lock:
            self.candidates = result
        return {'items': result, 'boundary': 'Nur letzte 20 Spiele des aktuell lokal eingeloggten Kontos, gleicher Patch. Kein globaler Replay-Dienst.'}

    def scan(self):
        directory = self.lcu.replay_dir()
        result = []; errors = []
        # Scan only the client-selected folder, never a user-supplied file path.
        import re
        for p in sorted(directory.glob('*.rofl'))[:100]:
            try:
                identity = match_id(p.stem.replace('-', '_'))
                with p.open('rb') as f:
                    h = f.read(288)
                    if h[:6] != b'RIOT\x00\x00':
                        raise ReplayError('ROFL2/RLR oder unbekanntes Format nicht unterstützt.')
                    import struct
                    offset, length = struct.unpack_from('<II', h, 268)
                    if length > 2 * 1024 * 1024:
                        raise ReplayError('Metadaten zu groß.')
                    f.seek(offset); v = version(json.loads(f.read(length))['gameVersion'])
                result.append(self.cache.add(p, identity, v))
            except (ReplayError, OSError, ValueError, KeyError, TypeError) as e:
                errors.append({'file': p.name, 'error': safe_error(e)})
        return {'items': result, 'errors': errors}

    def refill_once(self):
        try:
            current = self.lcu.current_version()
            items = self.server_list()['items']
            compatible = [i for i in items if i.get('patch') == patch_of(current) and i.get('reservedGameId') is None]
            with self.lock:
                self.refill.update(lastCheck=int(time.time()), compatibleUnreserved=len(compatible), error=None)
            if len(compatible) >= self.target:
                return {'uploaded': 0}
            known = {i.get('matchId') for i in items}; uploaded = 0
            candidates = self.discover()['items']
            # A refill pass has at most three acquisitions, no concurrent replay job.
            for candidate in candidates:
                if self.stop_event.is_set() or (self.refill_enabled is False and threading.current_thread().name == 'companion-refill'):
                    break
                identity = candidate['matchId']
                if identity in known:
                    continue
                try:
                    self.cache.get(identity)
                except ReplayError:
                    self.lcu.acquire(self.cache, identity, candidate['gameVersion'], self.stop_event)
                self.upload(identity); uploaded += 1; known.add(identity)
                if uploaded >= min(3, self.target - len(compatible)):
                    break
            return {'uploaded': uploaded}
        except (ReplayError, RemoteError, OSError, ValueError, KeyError, TypeError) as e:
            with self.lock:
                self.refill['error'] = safe_error(e)
                if isinstance(e, RemoteError) and e.status in (401, 403):
                    self.refill_enabled = False; self.refill['enabled'] = False
            raise

    def set_refill(self, enabled):
        if not isinstance(enabled, bool):
            raise ValueError('enabled muss boolesch sein.')
        with self.lock:
            self.refill_enabled = enabled; self.refill['enabled'] = enabled
        self.refill_wake.set()
        return {'ok': True}

    def enqueue(self, action, data):
        actions = {'discover', 'scan', 'acquire', 'upload', 'server-download', 'watch', 'reserve', 'refill', 'analyze', 'release', 'delete-local'}
        if action not in actions:
            raise ReplayError('Unbekannter Auftrag.')
        # Validate identities before placing anything in queue.
        if action in {'acquire', 'upload', 'server-download', 'watch', 'analyze', 'release', 'delete-local'}:
            match_id(data.get('matchId'))
        if action == 'acquire':
            version(data.get('gameVersion'))
        with self.lock:
            if self.job_queue.full():
                raise ReplayError('Auftragswarteschlange voll (maximal 8).')
            jid = secrets.token_hex(8)
            self.jobs[jid] = {'id': jid, 'action': action, 'state': 'queued', 'error': None}
            self.job_queue.put_nowait((jid, action, dict(data)))
            while len(self.jobs) > 20:
                done = next((key for key, job in self.jobs.items() if job['state'] in ('done', 'failed')), None)
                if done is None:
                    break
                del self.jobs[done]
        return {'jobId': jid}

    def run_job(self, action, data):
        identity = data.get('matchId')
        if action == 'discover': return self.discover()
        if action == 'scan': return self.scan()
        if action == 'acquire': return self.lcu.acquire(self.cache, identity, data['gameVersion'], self.stop_event)
        if action == 'upload': return self.upload(identity)
        if action == 'server-download': return self.server_download(identity)
        if action == 'watch': return self.lcu.watch(self.cache, identity)
        if action == 'reserve': return self.reserve(data)
        if action == 'refill': return self.refill_once()
        if action == 'analyze': return self._pool('POST', '/replays/' + identity + '/analyze', {})
        if action == 'release': return self._pool('POST', '/replays/' + identity + '/release', {'gameId': positive_id(data.get('gameId'))})
        if action == 'delete-local': self.cache.delete(identity); return {'ok': True}
        raise ReplayError('Unbekannter Auftrag.')

    def start_workers(self):
        if self.workers:
            return
        def feed_worker():
            while not self.stop_event.is_set():
                delay = self.feed_tick()
                self.feed_wake.wait(delay); self.feed_wake.clear()
        def replay_worker():
            while not self.stop_event.is_set():
                try: jid, action, data = self.job_queue.get(timeout=0.5)
                except queue.Empty: continue
                with self.replay_lock:
                    with self.lock: self.jobs[jid]['state'] = 'running'
                    try:
                        result = self.run_job(action, data)
                        with self.lock: self.jobs[jid].update(state='done', result=result)
                    except Exception as exc:
                        with self.lock: self.jobs[jid].update(state='failed', error=safe_error(exc))
                    finally: self.job_queue.task_done()
        def refill_worker():
            while not self.stop_event.is_set():
                self.refill_wake.wait(300); self.refill_wake.clear()
                if self.refill_enabled and not self.stop_event.is_set() and self.replay_lock.acquire(blocking=False):
                    try: self.refill_once()
                    except Exception as exc:
                        with self.lock: self.refill['error'] = safe_error(exc)
                    finally: self.replay_lock.release()
        for name, target in [('feed', feed_worker), ('jobs', replay_worker), ('refill', refill_worker)]:
            thread = threading.Thread(target=target, name='companion-' + name, daemon=True)
            self.workers.append(thread); thread.start()

    def close(self):
        self.stop_event.set(); self.feed_wake.set(); self.refill_wake.set()
        for worker in self.workers:
            worker.join(timeout=2)


class CompanionServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    def __init__(self, address, app):
        self.app = app
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = 'BronzeBrawlCompanion'
    def setup(self):
        super().setup(); self.connection.settimeout(15)
    def log_message(self, fmt, *args):
        pass  # No URLs, headers, credentials, or game data in logs.

    def reply(self, status, value, kind='application/json; charset=utf-8', cors=False):
        raw = json.dumps(value, allow_nan=False).encode() if kind.startswith('application/json') else value
        self.send_response(status)
        self.send_header('Content-Type', kind); self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY'); self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin' if cors else 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; connect-src 'self'")
        self.send_header('Connection', 'close'); self.close_connection = True
        if cors and self.headers.get('Origin') == PUBLIC_ORIGIN:
            self.send_header('Access-Control-Allow-Origin', PUBLIC_ORIGIN)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
        self.wfile.write(raw)

    def gate(self, write=False):
        port = self.server.server_port
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
        origins = {'http://' + h for h in hosts}
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        legacy = self.path in ('/health', '/lol-data') and self.command in ('GET', 'OPTIONS')
        if len(self.headers.get_all('Host', [])) != 1 or host not in hosts:
            self.reply(403, {'error': 'Host nicht erlaubt.'}); return False
        if origin is not None and origin != 'http://' + host and not (legacy and origin == PUBLIC_ORIGIN):
            self.reply(403, {'error': 'Origin nicht erlaubt.'}); return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site' and not (legacy and origin == PUBLIC_ORIGIN):
            self.reply(403, {'error': 'Fremde Website nicht erlaubt.'}); return False
        if '?' in self.path or '#' in self.path or '%' in self.path:
            self.reply(400, {'error': 'Keine Query oder kodierten Pfade erlaubt.'}); return False
        if write:
            token = self.headers.get('X-Companion-Token', '')
            if origin != 'http://' + host or not secrets.compare_digest(token, self.server.app.token):
                self.reply(403, {'error': 'Lokaler Sitzungstoken und gleicher Origin erforderlich.'}); return False
        return True

    def do_OPTIONS(self):
        if not self.gate(): return
        if self.path not in ('/health', '/lol-data'):
            self.reply(403, {'error': 'Kein Management-CORS.'}); return
        self.reply(200, {'ok': True}, cors=True)

    def do_GET(self):
        if not self.gate(): return
        app = self.server.app
        try:
            if self.path in ('/', '/ui.js', '/style.css'):
                name, kind = {'/': ('index.html', 'text/html; charset=utf-8'), '/ui.js': ('ui.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}[self.path]
                self.reply(200, (STATIC / name).read_bytes(), kind); return
            if self.path == '/health':
                self.reply(200, {'status': 'ok', 'directFeedEnabled': app.feed['enabled']}, cors=True); return
            if self.path == '/lol-data':
                if self.headers.get('Origin') == PUBLIC_ORIGIN and app.feed['enabled']:
                    self.reply(409, {'error': 'Direkt-Feed aktiv; Browser-Relay deaktivieren.'}, cors=True); return
                try: data = app.live_data()
                except ReplayError as e:
                    self.reply(503, {'error': str(e)}, cors=True); return
                self.reply(200, data, cors=True); return
            if self.path == '/api/bootstrap':
                self.reply(200, {'token': app.token}); return
            if self.path == '/api/status':
                self.reply(200, app.status()); return
            if self.path == '/api/server-replays':
                self.reply(200, app.server_list()); return
            self.reply(404, {'error': 'Nicht gefunden.'})
        except (RemoteError, ReplayError) as e:
            self.reply(502, {'error': safe_error(e)})
        except Exception as e:
            self.reply(500, {'error': safe_error(e)})

    def length(self, maximum):
        if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
            raise ValueError('Genau eine Content-Length erforderlich.')
        size = int(self.headers.get('Content-Length', '-1'))
        if not 0 <= size <= maximum:
            raise ValueError('Anfrage zu groß oder ungültig.')
        return size

    def do_POST(self):
        if not self.gate(write=True): return
        app = self.server.app
        try:
            if self.path == '/api/import':
                self.import_file(); return
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('Content-Type application/json erforderlich.')
            size = self.length(64 * 1024)
            raw = self.rfile.read(size)
            if len(raw) != size:
                raise ValueError('Unvollständige Anfrage.')
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError('JSON-Objekt erforderlich.')
            if self.path == '/api/config': result = app.configure(data)
            elif self.path == '/api/forget': result = app.forget()
            elif self.path == '/api/feed/start': result = app.feed_start()
            elif self.path == '/api/feed/stop': result = app.feed_stop()
            elif self.path == '/api/refill': result = app.set_refill(data.get('enabled'))
            elif self.path.startswith('/api/jobs/'):
                self.reply(202, app.enqueue(self.path.removeprefix('/api/jobs/'), data)); return
            else:
                self.reply(404, {'error': 'Nicht gefunden.'}); return
            self.reply(200, result)
        except (ValueError, UnicodeError) as e:
            # Never echo JSON parser snippets or untrusted input, especially tokens.
            self.reply(400, {'error': str(e) if isinstance(e, ReplayError) else 'Eingabe ungültig. IDs, Version, URL und Feldformate prüfen.'})
        except RemoteError as e:
            self.reply(502, {'error': safe_error(e)})
        except Exception as e:
            self.reply(500, {'error': safe_error(e)})

    def import_file(self):
        app = self.server.app
        identity = match_id(self.headers.get('X-Replay-Match'))
        v = version(self.headers.get('X-Replay-Version'))
        size = self.length(MAX_FILE)
        if not size or self.headers.get('Content-Type') != 'application/octet-stream':
            raise ReplayError('ROFL-Datei als application/octet-stream erforderlich.')
        if shutil.disk_usage(app.root).free < size * 2 + 64 * 1024 * 1024:
            raise ReplayError('Nicht genügend freier Speicher.')
        fd, tmp = tempfile.mkstemp(prefix='.import-', dir=app.root)
        try:
            with os.fdopen(fd, 'wb') as out:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(65536, remaining))
                    if not chunk:
                        raise ReplayError('Upload unvollständig.')
                    out.write(chunk); remaining -= len(chunk)
            self.reply(200, app.cache.add(tmp, identity, v))
        finally:
            Path(tmp).unlink(missing_ok=True)


def create_server(app, port=3002):
    return CompanionServer(('127.0.0.1', port), app)


def main():
    parser = argparse.ArgumentParser(description='BronzeBrawl Windows Python Companion (stdlib)')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--allow-http-local', action='store_true', help='HTTP-Backend nur localhost/127.0.0.1, expliziter Testmodus')
    args = parser.parse_args()
    root = Path(os.getenv('LOCALAPPDATA', str(Path.home() / '.local' / 'share'))) / 'BronzeBrawl' / 'companion'
    app = App(root, allow_http_local=args.allow_http_local)
    try:
        server = create_server(app)
    except OSError:
        print('Port 3002 nicht verfügbar. Läuft der Companion bereits? http://127.0.0.1:3002 öffnen.')
        app.close(); return 1
    app.start_workers()
    print('BronzeBrawl Companion: http://127.0.0.1:3002 — Beenden mit Strg+C. Keine Tokens im Terminal eingeben.')
    if not args.no_browser:
        # Server socket is already listening; opening a tab cannot race the bind.
        threading.Thread(target=lambda: webbrowser.open('http://127.0.0.1:3002'), daemon=True).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close(); app.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
