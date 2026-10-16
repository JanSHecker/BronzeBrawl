"""BronzeBrawl Companion: one local app, independent feed and bounded replay jobs."""
import argparse
import base64
import getpass
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
from replay import Cache, DiscoveryHistory, LCU, ReplayError, atomic_json, match_id, patch_of, version
from ranking import RANKING_VERSION, sort_rankings, valid_ranking
from capture import LiveCapture

DEFAULT_BACKEND = 'https://bronze-brawl.de/api'
PUBLIC_ORIGINS = frozenset(('https://bronze-brawl.de', 'https://bronze-brawl.janhec.de',
                            'http://localhost:5173', 'http://127.0.0.1:5173'))
STATIC = Path(__file__).resolve().parent
RANKING_LABELS = {'kills': 'Kills-Verhältnis', 'gold': 'Gold-Verhältnis', 'carry': 'Carry', 'momentum': 'Momentum'}
TERMINAL_HELP = 'v = App verbinden | t = Verbindungsstatus | r = Replays holen | l = Rankings anzeigen | s = Sortierung | q = Beenden'
SORT_HELP = 'Sortieren: s kills | s gold | s carry | s momentum (optional: auf/ab)'


class LiveUnavailable(ReplayError):
    pass


def positive_id(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 < value <= 9007199254740991:
        raise ValueError('Positive ganzzahlige BronzeBrawl-Spiel-ID erforderlich.')
    return value


def safe_error(exc):
    if isinstance(exc, (ReplayError, RemoteError)):
        return str(exc)
    return 'Lokaler Vorgang fehlgeschlagen. Client, Einstellungen und freien Speicher prüfen.'


def connection_settings(data, allow_http_local=False):
    if not isinstance(data, dict):
        raise ValueError('Ungültiger Verbindungscode.')
    backend = validate_backend(data.get('backendUrl'), allow_http_local)
    gid = positive_id(data.get('gameId'))
    token = data.get('token')
    if not isinstance(token, str) or len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
        raise ValueError('Ungültiger Verbindungscode.')
    return {'backendUrl': backend, 'gameId': gid, 'token': token}


def parse_connection(code, allow_http_local=False):
    try:
        if not isinstance(code, str) or not code.startswith('BB1.') or len(code) > 8192:
            raise ValueError()
        encoded = code[4:]
        data = json.loads(base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True))
        return connection_settings(data, allow_http_local)
    except (ValueError, TypeError, UnicodeError):
        raise ReplayError('Verbindungscode ungültig. In der Haupt-App einen neuen Code erstellen und vollständig einfügen.') from None


def connection_status(feed):
    if not feed['enabled']:
        return 'Nicht verbunden. ' + (feed.get('error') or 'In der Haupt-App unter Companion einen Code erstellen; hier v eingeben.')
    connected = feed.get('connected') and time.time() - (feed.get('lastHeartbeat') or 0) <= 15
    if not connected:
        return 'Verbindung zur App unterbrochen – erneuter Versuch automatisch.' + (' ' + feed['error'] if feed.get('error') else '')
    if feed.get('error'):
        return 'App verbunden – ' + feed['error']
    if feed.get('availability') == 'conflict':
        return 'App verbunden – Spiel gewechselt. Ein neues BronzeBrawl-Spiel verbinden.'
    if feed.get('gameState') == 'ended':
        return 'App verbunden – Spiel beendet. Für das nächste Spiel einen neuen Code verwenden.'
    if feed.get('availability') != 'live':
        return 'App verbunden – warte auf LoL-Livedaten.'
    return 'App verbunden – Live-Daten werden direkt an den Server gesendet.'


class App:
    def __init__(self, root, network=None, allow_http_local=False):
        self.root = Path(root); self.root.mkdir(parents=True, exist_ok=True)
        self.network = network or Network(); self.allow_http_local = allow_http_local
        self.cache = Cache(self.root / 'cache')
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock(); self.feed_lock = threading.Lock(); self.replay_lock = threading.Lock()
        self.recording = LiveCapture(self.root)
        self.stop_event = threading.Event(); self.feed_wake = threading.Event(); self.refill_wake = threading.Event()
        self.backend = DEFAULT_BACKEND; self.pool_token = ''; self.host_token = ''; self.companion_token = ''; self.game_id = None
        self.league_dir = ''; self.target = 5; self.refill_enabled = False; self.workers = []
        self.discovery = DiscoveryHistory(self.root / 'discovery.json')
        self.lcu = LCU(self.network, discovery=self.discovery)
        self.feed = {'enabled': False, 'connected': False, 'lastHeartbeat': None, 'gameState': None, 'error': None, 'sent': 0, 'failures': 0, 'lastSuccess': None, 'availability': 'nicht geprüft'}
        self.refill = {'enabled': False, 'error': None, 'lastCheck': None, 'compatibleUnreserved': None}
        self.jobs = {}; self.job_queue = queue.Queue(maxsize=8); self.candidates = []
        self.ranking_lock = threading.Lock()
        self.ranking_state = {'items': [], 'running': False, 'updatedAt': None, 'skipped': 0, 'error': None, 'notice': None}
        self.ranking_account = None
        try:
            saved_rankings = json.loads((self.root / 'rankings.json').read_text(encoding='utf-8'))
            if isinstance(saved_rankings.get('items'), list) and len(saved_rankings['items']) <= 500 and all(valid_ranking(item) for item in saved_rankings['items']):
                self.ranking_state.update(items=saved_rankings['items'], updatedAt=saved_rankings.get('updatedAt'))
                self.ranking_account = saved_rankings.get('account')
                self.discovery.seed_rankings(saved_rankings['items'])
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        self.sessions = {}
        try:
            saved = json.loads((self.root / 'settings.json').read_text(encoding='utf-8'))
            self.backend = validate_backend(saved.get('backendUrl', DEFAULT_BACKEND), allow_http_local)
            self.league_dir = saved.get('leagueDir', '')
            self.lcu = LCU(self.network, self.league_dir, discovery=self.discovery)
            self.target = max(1, min(20, int(saved.get('target', 5))))
        except (OSError, ValueError, TypeError):
            pass
        try:
            sessions = json.loads((self.root / 'sessions.json').read_text(encoding='utf-8'))
            if isinstance(sessions, dict):
                self.sessions = sessions
        except (OSError, ValueError):
            pass

        try:
            saved = connection_settings(json.loads((self.root / 'connection.json').read_text(encoding='utf-8')), allow_http_local)
            self.backend = saved['backendUrl']; self.game_id = saved['gameId']; self.companion_token = saved['token']
            self.feed.update(enabled=True, availability='waiting')
        except (OSError, ValueError, TypeError):
            pass

    def connect_code(self, code):
        settings = parse_connection(code, self.allow_http_local)
        with self.feed_lock, self.lock:
            # Only the restricted feed capability is stored, never the host token.
            atomic_json(self.root / 'connection.json', settings)
            self.backend = settings['backendUrl']; self.game_id = settings['gameId']; self.companion_token = settings['token']
            self.host_token = ''
            self.feed.update(enabled=True, connected=False, lastHeartbeat=None, lastSuccess=None, gameState=None, error=None, failures=0, sent=0, availability='waiting')
        self.feed_wake.set()
        return {'ok': True}

    def configure(self, data):
        if not isinstance(data, dict):
            raise ValueError('JSON-Objekt erforderlich.')
        # Wait for a previous tick before changing its destination/capability.
        # The user never has to stop/start the passive feed to change settings.
        with self.feed_lock, self.lock:
            if self.replay_lock.locked():
                raise ReplayError('Replays werden gerade geholt. Bitte kurz abwarten.')
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
            # Blank fields retain capabilities only for the same destination/game.
            if backend != self.backend:
                self.host_token = ''; self.pool_token = ''
                self.companion_token = ''
            if gid != self.game_id:
                self.host_token = ''
                self.companion_token = ''
            self.backend = backend; self.game_id = gid; self.target = target; self.league_dir = league
            if data.get('poolToken'):
                self.pool_token = data['poolToken']
            if data.get('hostToken'):
                self.host_token = data['hostToken']
            self.lcu = LCU(self.network, league, discovery=self.discovery)
            atomic_json(self.root / 'settings.json', {'backendUrl': backend, 'leagueDir': league, 'target': target})
            self.feed.update(enabled=bool(self.game_id and (self.host_token or self.companion_token)), error=None, failures=0, lastSuccess=None)
        self.feed_wake.set()
        return {'ok': True}

    def forget(self):
        self.feed_stop()
        with self.lock:
            self.pool_token = ''; self.host_token = ''; self.companion_token = ''; self.game_id = None
            (self.root / 'connection.json').unlink(missing_ok=True)
            self.refill_enabled = False; self.refill['enabled'] = False
        return {'ok': True}

    def status(self):
        with self.lock:
            return {'poolPaired': bool(self.pool_token), 'gamePaired': bool(self.game_id and (self.host_token or self.companion_token)),
                    'feed': dict(self.feed), 'recording': self.recording.status(),
                    'refill': dict(self.refill), 'jobs': [dict(j) for j in self.jobs.values()],
                    'localItems': self.cache.items(), 'candidates': list(self.candidates),
                    'replayFormat': 'RIOT/ROFL1 unterstützt; ROFL2/RLR derzeit ausdrücklich nicht unterstützt',
                    'replayLiveData': 'Unbewiesen: Ein gestartetes Replay garantiert keine Liveclient-Daten. Keine Ereignisrekonstruktion.'}

    def live_data(self):
        try:
            data = self.network.request('GET', 'https://127.0.0.1:2999/liveclientdata/allgamedata', local=True)
        except RemoteError:
            with self.lock:
                self.feed['availability'] = 'nicht verfügbar (LoL/Replay stellt keine Liveclient-Daten bereit)'
            raise LiveUnavailable('Live-Daten sind noch nicht verfügbar. Warte auf ein laufendes Spiel.') from None
        # Capture at the shared fetch boundary, before validation, session checks
        # or backend delivery can reject a snapshot needed for diagnostics.
        self.recording.save(data)
        if not isinstance(data, dict) or not isinstance(data.get('gameData'), dict) or not isinstance(data.get('allPlayers'), list):
            raise ReplayError('LoL liefert keine unterstützten Live-Daten.')
        with self.lock:
            self.feed['availability'] = 'echte Liveclient-Daten verfügbar'
        return data

    def feed_start(self):
        with self.lock:
            if not self.game_id or not (self.host_token or self.companion_token):
                raise ReplayError('Zuerst Spiel-ID und Host-Token paaren.')
            self.feed.update(enabled=True, error=None, failures=0)
        self.feed_wake.set()
        return {'ok': True}

    def feed_stop(self):
        with self.lock:
            self.feed['enabled'] = False
            self.feed['connected'] = False
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
                companion_token = self.companion_token
            if companion_token:
                return self._direct_tick(gid, companion_token, backend)
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
                        self.feed.update(enabled=False, error='Spiel gewechselt oder Zeit zurückgesetzt. Bitte ein neues Spiel verbinden.')
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
                if e.status == 413:
                    return self._feed_size_failure()
                with self.lock:
                    if e.status in (401, 403, 409) or (400 <= e.status < 500 and e.status != 429):
                        self.feed.update(enabled=False, error=f'Spielverbindung ungültig (HTTP {e.status}). Bitte Spiel-ID und Schlüssel erneut verbinden.')
                        return 3
                return self._feed_failure(e)
            except (ReplayError, OSError, ValueError, KeyError, TypeError) as e:
                return self._feed_failure(e)
        finally:
            self.feed_lock.release()

    def _direct_tick(self, gid, token, backend):
        """Independent HTTPS sender; browser and replay jobs are not involved."""
        headers = {'X-Companion-Token': token}
        heartbeat_ok = False
        try:
            try:
                data = self.live_data()
            except ReplayError:
                data = None
            availability = 'live' if data is not None else 'waiting'
            session = None
            key = hashlib.sha256((backend + ':' + str(gid)).encode()).hexdigest()
            if data is not None:
                clock = data['gameData'].get('gameTime')
                players = data['allPlayers']
                if isinstance(clock, bool) or not isinstance(clock, (int, float)) or not math.isfinite(clock) or clock < 0 or not 0 < len(players) <= 20 or not all(isinstance(p, dict) for p in players):
                    data = None; availability = 'waiting'
                else:
                    roster = sorted((str(p.get('riotId', p.get('summonerName', ''))), str(p.get('championName', '')), str(p.get('team', ''))) for p in players)
                    identity = hashlib.sha256(json.dumps([roster, data['gameData'].get('gameMode'), data['gameData'].get('mapNumber')], sort_keys=True).encode()).hexdigest()
                    session = {'identity': identity, 'clock': clock}
                    previous = self.sessions.get(key)
                    if previous and (previous.get('identity') != identity or clock < previous.get('clock', 0)):
                        data = None; availability = 'conflict'
                    elif previous and previous.get('ended'):
                        data = None; availability = 'waiting'
                        with self.lock:
                            self.feed['gameState'] = 'ended'
            # A heartbeat also proves connectivity when LoL is closed or paused.
            result = self.network.request('POST', backend + '/companion/heartbeat', headers, {'gameId': gid, 'availability': availability})
            if not isinstance(result, dict) or result.get('ok') is not True or result.get('gameId') != gid:
                raise RemoteError(502)
            heartbeat_ok = True
            with self.lock:
                self.feed.update(connected=True, lastHeartbeat=time.time(), availability=availability)
            if data is not None:
                # Repeated clocks are safe: the server handles event idempotency.
                # Sending paused snapshots keeps connection and feed freshness honest.
                accepted = self.network.request('POST', backend + '/companion/input', headers, {'gameId': gid, 'input': data})
                if not isinstance(accepted, dict) or accepted.get('gameId') != gid or accepted.get('state') not in ('live', 'ended'):
                    raise RemoteError(502)
                session['ended'] = accepted['state'] == 'ended'
                self.sessions[key] = session
                atomic_json(self.root / 'sessions.json', self.sessions)
                with self.lock:
                    self.feed.update(sent=self.feed['sent'] + 1, lastSuccess=time.time(), gameState=accepted['state'])
            with self.lock:
                self.feed.update(failures=0, error=None)
            return 3
        except RemoteError as exc:
            if exc.status == 413:
                with self.lock:
                    self.feed['connected'] = heartbeat_ok
                return min(12, self._feed_size_failure())
            if exc.status == 409:
                with self.lock:
                    self.feed.update(availability='conflict', error='Spieldaten abgelehnt. Ein neues BronzeBrawl-Spiel verbinden.')
                # Keep reporting liveness, but do not change the game's source.
                try:
                    self.network.request('POST', backend + '/companion/heartbeat', headers, {'gameId': gid, 'availability': 'conflict'})
                except RemoteError:
                    with self.lock:
                        self.feed['connected'] = False
                return 3
            with self.lock:
                self.feed['connected'] = False
                if 400 <= exc.status < 500 and exc.status != 429:
                    self.feed.update(enabled=False, error=f'Verbindung abgelehnt (HTTP {exc.status}). Mit v einen neuen Verbindungscode hinterlegen.')
                    return 3
            return min(12, self._feed_failure(exc))
        except (OSError, ValueError, KeyError, TypeError) as exc:
            return min(12, self._feed_failure(exc))

    def _feed_size_failure(self):
        return self._feed_failure(ReplayError(
            'Live-Snapshot zu groß (HTTP 413). Größenlimit von Backend/Proxy prüfen; '
            'erneuter Versuch automatisch mit frischen Daten.'))

    def _feed_failure(self, exc):
        with self.lock:
            if isinstance(exc, LiveUnavailable):
                self.feed.update(failures=0, error=None, lastSuccess=None)
                return 3  # A closed game is a normal idle state, not an outage.
            failures = self.feed['failures'] + 1
            self.feed.update(failures=failures, error=safe_error(exc))
            # No game/client or a temporary outage is normal for a passive app.
            # Keep waiting with bounded backoff; never require a manual restart.
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
        return {'items': result, 'boundary': 'Zufällig ausgewählte fremde Challenger-Spieler deiner Region, zuletzt geprüfte Spieler später; je 20 Spiele, fünf Konten pro Batch, höchstens 15 pro Suche. Nur neue Summoner’s-Rift-Matches des aktuellen Patches, kein eigener Verlauf.'}

    def fetch_replays(self):
        """Download foreign, current-patch Summoner's Rift matches via League.

        These remain original client files. No pool credentials, upload,
        reservation, playback or replay-format parsing is involved.
        """
        client = self.lcu
        candidates = client.discover()
        if not candidates:
            return {'items': [], 'message': 'Keine neuen Summoner’s-Rift-Replays im aktuellen Suchlauf gefunden. Erneut versuchen, um andere Spieler zu prüfen; bekannte Matches werden nicht wiederholt.', 'rankings': self.rankings()}
        items = []; errors = []
        for candidate in candidates:
            if self.stop_event.is_set():
                break
            try:
                items.append(client.download(candidate['matchId'], candidate['gameVersion'], self.stop_event))
            except (ReplayError, RemoteError, OSError, ValueError, KeyError, TypeError) as exc:
                errors.append(safe_error(exc))
        if not items and errors:
            raise ReplayError(errors[0])
        message = f'{len(items)} Replay' + ('s' if len(items) != 1 else '') + ' im League-Replay-Ordner bereit.'
        if errors:
            message += f' {len(errors)} nicht verfügbar.'
        rankings = self.rank_replays(candidates)
        return {'items': items, 'message': message, 'rankings': rankings}

    def rankings(self):
        with self.lock:
            result = dict(self.ranking_state)
            result['items'] = sort_rankings(result['items'])
            return result

    def rank_replays(self, candidates=None):
        """Rank discovered foreign matches independently of slow file downloads."""
        with self.ranking_lock:
            with self.lock:
                self.ranking_state.update(running=True, error=None, skipped=0, notice=None)
            try:
                client = self.lcu
                current = client.current_version()
                candidates = client.discover() if candidates is None else candidates
                if not candidates:
                    with self.lock:
                        self.ranking_state.update(running=False, notice='Keine neuen Matches in diesem Suchlauf. Die letzte Rangliste bleibt erhalten; die nächste Suche prüft andere Spieler.')
                    return self.rankings()
                summoner = client.request('GET', '/lol-summoner/v1/current-summoner')
                own = summoner.get('puuid') if isinstance(summoner, dict) else None
                if not isinstance(own, str) or not own:
                    raise ReplayError('Aktuelles Konto für den Ausschluss eigener Spiele nicht verfügbar.')
                account = hashlib.sha256(own.encode()).hexdigest()
                directory = client.replay_dir()
                cached = {item['matchId']: item for item in self.rankings()['items']} if account == self.ranking_account else {}
                files = {}
                for path in sorted(directory.glob('*.rofl'))[:500]:
                    try:
                        identity = match_id(path.stem.replace('-', '_'))
                        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_FILE:
                            continue
                        files[identity] = path
                    except (ReplayError, OSError):
                        continue
                items = []
                with self.lock:
                    self.ranking_state['items'] = []
                self.ranking_account = account
                for candidate in candidates:
                    if self.stop_event.is_set():
                        break
                    try:
                        identity = match_id(candidate['matchId'])
                        path = files.get(identity)
                        stat = path.stat() if path else None
                        size = stat.st_size if stat else None
                        mtime = stat.st_mtime_ns if stat else None
                        old = cached.get(identity)
                        if old and old.get('patch') == patch_of(current) and old.get('scores', {}).get('version') == RANKING_VERSION and not old['scores']['metrics'].get('partial', True):
                            item = dict(old)
                        else:
                            item = client.analyze(identity, own, current)
                        if not valid_ranking(item) or item['matchId'] != identity:
                            raise ReplayError('Ungültige Bewertung des League-Clients.')
                        item.update(downloaded=path is not None, filename=path.name if path else None, sizeBytes=size, mtimeNs=mtime)
                        items.append(item)
                        with self.lock:
                            self.ranking_state.update(items=list(items), updatedAt=int(time.time()))
                    except (ReplayError, RemoteError, OSError, ValueError, KeyError, TypeError):
                        with self.lock:
                            self.ranking_state['skipped'] += 1
                with self.lock:
                    self.ranking_state.update(updatedAt=int(time.time()))
                atomic_json(self.root / 'rankings.json', {**self.rankings(), 'account': account})
            except (ReplayError, RemoteError, OSError, ValueError, KeyError, TypeError) as exc:
                with self.lock:
                    self.ranking_state['error'] = safe_error(exc)
            finally:
                with self.lock:
                    self.ranking_state['running'] = False
            return self.rankings()

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
        actions = {'fetch-replays', 'discover', 'scan', 'acquire', 'upload', 'server-download', 'watch', 'reserve', 'refill', 'analyze', 'release', 'delete-local'}
        if action not in actions:
            raise ReplayError('Unbekannter Auftrag.')
        # Validate identities before placing anything in queue.
        if action in {'acquire', 'upload', 'server-download', 'watch', 'analyze', 'release', 'delete-local'}:
            match_id(data.get('matchId'))
        if action == 'acquire':
            version(data.get('gameVersion'))
        with self.lock:
            if action == 'fetch-replays':
                existing = next((job for job in self.jobs.values() if job['action'] == action and job['state'] in ('queued', 'running')), None)
                if existing:
                    return {'jobId': existing['id']}
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
        if action == 'fetch-replays': return self.fetch_replays()
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

    def start_workers(self, feed_only=False, on_feed=None):
        if self.workers:
            return
        def feed_worker():
            while not self.stop_event.is_set():
                delay = self.feed_tick()
                if on_feed is not None:
                    with self.lock:
                        snapshot = dict(self.feed)
                    on_feed(snapshot)
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
        workers = [('feed', feed_worker)]
        if not feed_only:
            workers += [('jobs', replay_worker), ('refill', refill_worker)]
        for name, target in workers:
            thread = threading.Thread(target=target, name='companion-' + name, daemon=True)
            self.workers.append(thread); thread.start()

    def close(self):
        self.feed_stop()
        self.stop_event.set(); self.feed_wake.set(); self.refill_wake.set()
        for worker in self.workers:
            worker.join(timeout=2)


class CompanionServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    def __init__(self, address, app, handler=None):
        self.app = app
        super().__init__(address, handler or Handler)


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
        if cors and self.headers.get('Origin') in PUBLIC_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', self.headers['Origin'])
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
        if origin is not None and origin != 'http://' + host and not (legacy and origin in PUBLIC_ORIGINS):
            self.reply(403, {'error': 'Origin nicht erlaubt.'}); return False
        if self.headers.get('Sec-Fetch-Site') == 'cross-site' and not (legacy and origin in PUBLIC_ORIGINS):
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
                if self.headers.get('Origin') in PUBLIC_ORIGINS and app.feed['enabled']:
                    self.reply(409, {'error': 'Direkt-Feed aktiv; Browser-Relay deaktivieren.'}, cors=True); return
                try: data = app.live_data()
                except ReplayError as e:
                    self.reply(503, {'error': str(e)}, cors=True); return
                self.reply(200, data, cors=True); return
            if self.path == '/api/bootstrap':
                with app.lock:
                    settings = {'backendUrl': app.backend, 'leagueDir': app.league_dir, 'gameId': app.game_id}
                self.reply(200, {'token': app.token, 'settings': settings}); return
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


class LiveFeedHandler(Handler):
    """Read-only LoL feed. No browser UI, game pairing or management API."""
    def do_GET(self):
        if not self.gate():
            return
        if self.path == '/health':
            self.reply(200, {'status': 'ok'}, cors=True)
        elif self.path == '/lol-data':
            try:
                data = self.server.app.live_data()
            except ReplayError as exc:
                self.reply(503, {'error': str(exc)}, cors=True)
                return
            self.reply(200, data, cors=True)
        else:
            self.reply(404, {'error': 'Nur der lokale Live-Feed ist verfügbar: /lol-data'})

    def do_POST(self):
        if self.gate():
            self.reply(405, {'error': 'Der Live-Feed ist nur lesbar.'})


def create_feed_server(app, port=3002):
    return CompanionServer(('127.0.0.1', port), app, LiveFeedHandler)


def format_team_ratio(measure):
    return '–' if measure['ratio'] is None else f"{measure['ratio'] * 100:.2f} %".replace('.', ',')


def print_rankings(rankings, output_fn, sort_by='kills', descending=True):
    items = sort_rankings(rankings['items'], sort_by, descending)
    direction = 'absteigend' if descending else 'aufsteigend'
    output_fn(f'\nReplay-Ranking ({RANKING_LABELS[sort_by]} {direction})')
    output_fn(f"{'Rang':>4} {'Match':<20} {'Kills':>10} {'Gold (Ende)':>12} {'Carry':>8} {'Momentum':>8}  Datei")
    for index, item in enumerate(items, 1):
        scores = item['scores']
        values = [('–' if scores[key] is None else f'{scores[key]:.2f}').rjust(8) for key in ('carry', 'momentum')]
        rank = str(index) if scores[sort_by] is not None else '–'
        kills = format_team_ratio(scores['metrics']['killsRatio'])
        gold = format_team_ratio(scores['metrics']['goldRatio'])
        output_fn(f"{rank:>4} {item['matchId']:<20} {kills:>10} {gold:>12}" + ''.join(values) + ('  lokal' if item.get('downloaded') else '  noch nicht geladen'))
    if not items:
        output_fn('Noch keine bewertbaren fremden Summoner’s-Rift-Matches gefunden.')
    if rankings.get('running'):
        output_fn('Bewertungen werden im Hintergrund aktualisiert.')
    if rankings.get('error'):
        output_fn(rankings['error'])
    if rankings.get('notice'):
        output_fn(rankings['notice'])
    if rankings.get('skipped'):
        output_fn(f"{rankings['skipped']} Matches ausgeschlossen oder Matchdaten nicht verfügbar.")
    output_fn('Kills und Gold: kleinerer / größerer Teamwert × 100 %. 100 % = gleich, 50 % = halb so viel; nicht verfügbar = –.')
    output_fn('Gold = Summe goldEarned je Team am Spielende. Carry/Momentum: 0–100; ohne Timeline bleibt Momentum nicht verfügbar (–).')
    output_fn(SORT_HELP)
    output_fn('Beispiel: s gold auf = Gold-Verhältnis aufsteigend; ohne auf/ab wird absteigend sortiert.')
    output_fn(TERMINAL_HELP)


def run_terminal(app, input_fn=None, output_fn=None, port=3002, code_input_fn=None):
    """Direct server feed in its own worker; replay commands remain local."""
    input_fn = input if input_fn is None else input_fn
    output_fn = print if output_fn is None else output_fn
    code_input_fn = getpass.getpass if code_input_fn is None else code_input_fn
    output_fn('BronzeBrawl Companion')
    output_fn('Direkt-Feed: Companion → HTTPS → BronzeBrawl. Kein lokaler Webserver erforderlich.')
    output_fn(f'Lokale Live-Aufzeichnungen: {app.recording.directory} (enthält Spielernamen; nicht ungeprüft teilen).')
    output_fn(TERMINAL_HELP)
    output_fn(SORT_HELP)
    display_lock = threading.RLock()
    last_status = None
    def show_connection(feed=None):
        nonlocal last_status
        with display_lock:
            message = connection_status(app.feed if feed is None else feed)
            recording = app.recording.status()
            if recording['error']:
                message += ' ' + recording['error']
            if message != last_status:
                output_fn(message)
                last_status = message
    show_connection()
    app.start_workers(feed_only=True, on_feed=show_connection)
    sort_by = 'kills'; descending = True
    def show_rankings(rankings=None):
        with display_lock:
            print_rankings(app.rankings() if rankings is None else rankings, output_fn, sort_by, descending)
    if app.rankings()['items']:
        show_rankings()
    def rank_existing():
        rankings = app.rank_replays()
        if not app.stop_event.is_set():
            show_rankings(rankings)
    ranking_worker = threading.Thread(target=rank_existing, name='companion-rankings', daemon=True)
    app.workers.append(ranking_worker)
    ranking_worker.start()
    try:
        while True:
            command = input_fn('\n> ').strip().lower()
            if command in ('q', 'quit', 'exit'):
                break
            try:
                if command in ('v', 'verbinden'):
                    app.connect_code(code_input_fn('Verbindungscode aus der Haupt-App (Eingabe verborgen): ').strip())
                    output_fn('Verbindung gespeichert. Server wird kontaktiert …')
                elif command in ('t', 'status'):
                    with display_lock:
                        output_fn(connection_status(app.feed))
                        output_fn(f"Erfolgreich gesendete Snapshots: {app.feed['sent']}")
                        recording = app.recording.status()
                        output_fn(f"Lokal gespeicherte Snapshots: {recording['saved']} — {recording['directory']}")
                        if recording['error']:
                            output_fn(recording['error'])
                elif command in ('r', 'replays'):
                    output_fn('Suche fremde Summoner’s-Rift-Replays über die Rangliste deiner Region. Patch wird automatisch erkannt ...')
                    result = app.fetch_replays()
                    output_fn(result['message'])
                    for item in result['items']:
                        output_fn('  ' + item['filename'])
                    if 'rankings' in result:
                        show_rankings(result['rankings'])
                elif command in ('l', 'liste', 'rankings'):
                    show_rankings()
                elif command == 's' or command.startswith('s '):
                    selection = command[1:].strip() or input_fn('Sortierung (kills/gold/carry/momentum, optional auf/ab): ').strip().lower()
                    parts = selection.split()
                    key = {key: key for key in RANKING_LABELS}.get(parts[0]) if parts else None
                    order = parts[1] if len(parts) == 2 else 'ab'
                    if key is None or len(parts) > 2 or order not in ('auf', 'ab', 'asc', 'desc'):
                        output_fn('Ungültige Sortierung. ' + SORT_HELP)
                        continue
                    with display_lock:
                        sort_by = key; descending = order in ('ab', 'desc')
                        show_rankings()
                elif command:
                    output_fn(TERMINAL_HELP)
                    output_fn(SORT_HELP)
            except (ReplayError, RemoteError, OSError, ValueError, KeyError, TypeError) as exc:
                output_fn(safe_error(exc))
    except (EOFError, KeyboardInterrupt):
        pass
    finally:
        app.close()
    output_fn('Companion beendet.')
    return 0


def main():
    parser = argparse.ArgumentParser(description='BronzeBrawl Companion: Replays holen und Live-Daten im Hintergrund weitergeben.')
    parser.add_argument('--server', help=argparse.SUPPRESS)
    parser.add_argument('--league-dir', help='League-Ordner, falls die automatische Erkennung fehlschlägt')
    parser.add_argument('--web', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--no-browser', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--allow-http-local', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    root = Path(os.getenv('LOCALAPPDATA', str(Path.home() / '.local' / 'share'))) / 'BronzeBrawl' / 'companion'
    app = App(root, allow_http_local=args.allow_http_local)
    if args.server or args.league_dir:
        settings = {}
        if args.server: settings['backendUrl'] = args.server
        if args.league_dir: settings['leagueDir'] = args.league_dir
        try:
            app.configure(settings)
        except (ValueError, OSError) as exc:
            app.close()
            parser.error(safe_error(exc))
    if not args.web:
        return run_terminal(app)
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
