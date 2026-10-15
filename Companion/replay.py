"""Local replay cache and local League Client API; no Riot/RSO credential export."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import threading
import time
import urllib.parse

from network import MAX_FILE, RemoteError
from ranking import score_match

PLATFORMS = 'BR1 EUN1 EUW1 JP1 KR LA1 LA2 NA1 OC1 TR1 RU PH2 SG2 TH2 TW2 VN2 ME1'.split()
MATCH = re.compile(r'(' + '|'.join(PLATFORMS) + r')_([1-9][0-9]{0,18})\Z')
VERSION = re.compile(r'[0-9]{1,3}\.[0-9]{1,3}(?:\.[0-9]{1,10}){1,2}\Z')


class ReplayError(ValueError):
    pass


def match_id(value):
    if not isinstance(value, str) or not MATCH.fullmatch(value):
        raise ReplayError('Match-ID als Plattform_Spielnummer eingeben, z.B. EUW1_123.')
    return value


def version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ReplayError('Vollständige Spielversion erforderlich (z.B. 16.20.123.456).')
    return value


def client_version(value):
    """Read the version LoL reports; +branch metadata is not part of the version."""
    if isinstance(value, dict):
        value = value.get('version') or value.get('gameVersion')
    if isinstance(value, str):
        value = value.strip().split('+', 1)[0]
    try:
        return version(value)
    except ReplayError:
        raise ReplayError('Spielversion vom League Client noch nicht verfügbar. Client geöffnet lassen und erneut versuchen.') from None


def patch_of(value):
    return '.'.join(version(value).split('.')[:2])


def sha_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    fd, name = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(value, out, allow_nan=False)
            out.flush(); os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def inspect_rofl(path, identity, game_version):
    """Validate RIOT/ROFL1 envelope + embedded numeric ID/version, never decode events.

    Historical documented layout: 6-byte magic, 256-byte signature, uint16 header
    length, six little-endian uint32 fields; uint64 game ID starts payload header.
    Signature is present but cryptographic authenticity is NOT verified.
    ROFL2/RLR is deliberately rejected until its format is implemented/tested.
    """
    match_id(identity); version(game_version)
    path = Path(path)
    size = path.stat().st_size
    if path.is_symlink() or not 326 <= size <= MAX_FILE:
        raise ReplayError('Replay unvollständig oder über 150 MiB.')
    with path.open('rb') as f:
        header = f.read(288)
        if header[:6] != b'RIOT\x00\x00':
            raise ReplayError('ROFL2/RLR oder unbekanntes Format wird noch nicht unterstützt; Datei nicht hochgeladen.')
        hlen, flen, moff, mlen, poff, plen, dataoff = struct.unpack_from('<HIIIIII', header, 262)
        if not (hlen >= 288 and flen == size and hlen <= moff and 2 <= mlen <= 2 * 1024 * 1024 and moff + mlen <= poff and plen >= 8 and poff + plen <= dataoff <= size):
            raise ReplayError('Ungültiger oder unvollständiger RIOT-Replay-Header.')
        f.seek(moff)
        try:
            metadata = json.loads(f.read(mlen))
        except (ValueError, UnicodeError):
            raise ReplayError('Replay-Metadaten ungültig.') from None
        if not isinstance(metadata, dict) or metadata.get('gameVersion') != game_version:
            raise ReplayError('Eingebettete Spielversion stimmt nicht überein.')
        f.seek(poff); numeric = struct.unpack('<Q', f.read(8))[0]
        if numeric != int(identity.split('_')[1]):
            raise ReplayError('Eingebettete Spielnummer stimmt nicht überein.')
    # ROFL1 has no independently verified platform field. User/LCU supplies platform.
    return {'gameId': numeric, 'gameVersion': game_version, 'patch': patch_of(game_version), 'sizeBytes': size, 'format': 'RIOT/ROFL1'}


class Cache:
    def __init__(self, root, quota=2 * 1024 * 1024 * 1024):
        self.root = Path(root); self.root.mkdir(parents=True, exist_ok=True)
        self.quota = quota; self.lock = threading.RLock()

    def path(self, identity):
        return self.root / (match_id(identity) + '.rofl')

    def items(self):
        with self.lock:
            result = []
            for p in sorted(self.root.glob('*.json'))[:500]:
                try:
                    item = json.loads(p.read_text(encoding='utf-8'))
                    if p.stem == match_id(item['matchId']) and self.path(item['matchId']).is_file():
                        result.append(item)
                except (ValueError, KeyError, OSError, TypeError):
                    continue
            return result

    def get(self, identity, verify=True):
        match_id(identity)
        with self.lock:
            item = next((i for i in self.items() if i['matchId'] == identity), None)
            if not item:
                raise ReplayError('Replay nicht im lokalen Cache.')
            path = self.path(identity)
            if verify:
                inspect_rofl(path, identity, item['gameVersion'])
                if sha_file(path) != item['sha256']:
                    raise ReplayError('Lokale Prüfsumme stimmt nicht mehr.')
            return item

    def add(self, source, identity, game_version, expected_sha=None):
        with self.lock:
            info = inspect_rofl(source, identity, game_version)
            digest = sha_file(source)
            if expected_sha is not None and digest != expected_sha:
                raise ReplayError('SHA256 des Serverdownloads stimmt nicht überein.')
            destination = self.path(identity)
            if destination.exists():
                existing = self.get(identity)
                if existing['sha256'] != digest:
                    raise ReplayError('Andere Datei unter derselben Match-ID; kein Überschreiben.')
                return existing
            total = sum(p.stat().st_size for p in self.root.glob('*.rofl'))
            if total + info['sizeBytes'] > self.quota or shutil.disk_usage(self.root).free < info['sizeBytes'] + 64 * 1024 * 1024:
                raise ReplayError('Cache-Limit oder freier Speicher erschöpft; Cache in der App bereinigen.')
            fd, name = tempfile.mkstemp(prefix='.copy-', dir=self.root); os.close(fd)
            try:
                with Path(source).open('rb') as inp, open(name, 'wb') as out:
                    shutil.copyfileobj(inp, out, 65536); out.flush(); os.fsync(out.fileno())
                inspect_rofl(name, identity, game_version)
                if sha_file(name) != digest:
                    raise ReplayError('Quelldatei wurde während des Kopierens verändert.')
                os.replace(name, destination)
                info.update(matchId=identity, sha256=digest, createdAt=int(time.time()), uploadedTo=[])
                atomic_json(self.root / (identity + '.json'), info)
                return info
            finally:
                Path(name).unlink(missing_ok=True)

    def mark_uploaded(self, identity, backend):
        with self.lock:
            item = self.get(identity)
            key = hashlib.sha256(backend.encode()).hexdigest()
            item['uploadedTo'] = list(set(item.get('uploadedTo', []) + [key]))
            atomic_json(self.root / (identity + '.json'), item)

    def delete(self, identity):
        with self.lock:
            self.path(identity).unlink(missing_ok=True)
            (self.root / (match_id(identity) + '.json')).unlink(missing_ok=True)


class LCU:
    def __init__(self, network, league_dir=None):
        self.network = network
        self.league_dir = Path(league_dir) if league_dir else None

    def lockfile(self):
        cached = getattr(self, '_lockfile', None)
        if cached and cached.is_file() and not cached.is_symlink():
            return cached
        roots = [self.league_dir] if self.league_dir else []
        if not self.league_dir:
            roots += [Path('C:/Riot Games/League of Legends')]
            for env in ('ProgramFiles', 'ProgramFiles(x86)'):
                if os.getenv(env):
                    roots.append(Path(os.environ[env]) / 'Riot Games' / 'League of Legends')
            if os.name == 'nt':
                # Fixed process lookup, no user-supplied commands, no auth-token extraction.
                try:
                    command = "Get-CimInstance Win32_Process -Filter \"Name='LeagueClient.exe'\" | Select-Object -ExpandProperty ExecutablePath"
                    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], capture_output=True, text=True, timeout=5, creationflags=0x08000000)
                    roots += [Path(s.strip()).parent for s in result.stdout.splitlines()[:5] if s.strip()]
                except (OSError, subprocess.SubprocessError):
                    pass
        for root in roots:
            if root and not str(root).startswith(('\\\\', '//')):
                p = root / 'lockfile'
                if p.is_file() and not p.is_symlink():
                    self._lockfile = p
                    return p
        raise ReplayError('League Client nicht gefunden. Einloggen oder League-Installationsordner angeben.')

    def request(self, method, route, body=None):
        if not route.startswith('/lol-') or '://' in route or '\\' in route or '..' in route:
            raise ReplayError('Ungültiger lokaler Client-Endpunkt.')
        try:
            raw = self.lockfile().read_text(encoding='utf-8')
            if len(raw) > 1024:
                raise ValueError()
            name, pid, port, password, protocol = raw.strip().split(':')
            if protocol != 'https' or not 1 <= int(port) <= 65535 or not password:
                raise ValueError()
        except (OSError, ValueError):
            raise ReplayError('Client-Lockfile nicht lesbar oder ungültig.') from None
        auth = base64.b64encode(('riot:' + password).encode()).decode()
        return self.network.request(method, f'https://127.0.0.1:{int(port)}{route}', {'Authorization': 'Basic ' + auth}, body, local=True)

    def current_version(self):
        result = self.request('GET', '/lol-patch/v1/game-version')
        return client_version(result)

    def replay_dir(self):
        try:
            path = self.request('GET', '/lol-replays/v1/rofls/path')
        except RemoteError:
            path = None
        if not isinstance(path, str) or not path:
            config = self.request('GET', '/lol-replays/v1/configuration')
            path = config.get('replaysPath') or config.get('replays-folder-path') if isinstance(config, dict) else None
        if not path:
            path = str(Path.home() / 'Documents' / 'League of Legends' / 'Replays')
        result = Path(path)
        if not result.is_absolute() or str(result).startswith(('\\\\', '//')) or result.is_symlink():
            raise ReplayError('Lokaler Replay-Ordner nicht unterstützt (kein Netzlaufwerk).')
        return result

    def discover(self, limit=20):
        current = self.current_version()
        summoner = self.request('GET', '/lol-summoner/v1/current-summoner')
        own_puuid = summoner.get('puuid') if isinstance(summoner, dict) else None
        if not isinstance(own_puuid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{10,200}', own_puuid):
            raise ReplayError('Aktuelles Konto nicht verfügbar.')
        # The local account identifies the region and is excluded, never used as
        # a replay source. Public ladder entries supply foreign match histories.
        ladder = self.request('GET', '/lol-ranked/v1/apex-leagues/RANKED_SOLO_5x5/CHALLENGER')
        divisions = ladder.get('divisions', []) if isinstance(ladder, dict) else []
        players = []
        for division in divisions if isinstance(divisions, list) else []:
            if not isinstance(division, dict):
                continue
            standings = division.get('standings', [])
            for entry in standings if isinstance(standings, list) else []:
                puuid = entry.get('puuid') if isinstance(entry, dict) else None
                if isinstance(puuid, str) and re.fullmatch(r'[A-Za-z0-9_-]{10,200}', puuid) and puuid != own_puuid and puuid not in players:
                    players.append(puuid)
        if not players:
            raise ReplayError('Keine fremden Spieler über die öffentliche Rangliste verfügbar. Der eigene Verlauf wird nicht verwendet.')
        entries = []; failure = None; histories = 0
        for puuid in players[:5]:
            route = '/lol-match-history/v1/products/lol/' + urllib.parse.quote(puuid, safe='') + '/matches?begIndex=0&endIndex=19'
            try:
                history = self.request('GET', route)
            except RemoteError as exc:
                failure = exc
                continue
            games = history.get('games', {}) if isinstance(history, dict) else {}
            games = games.get('games', []) if isinstance(games, dict) else games
            if isinstance(games, list):
                histories += 1
                entries.extend(games[:max(0, min(limit, 20))])
        if not histories and failure:
            raise ReplayError('Fremde Match-Verläufe sind momentan nicht verfügbar. Bitte später erneut versuchen.') from None
        result = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict) or entry.get('mapId') != 11:
                continue
            identities = entry.get('participantIdentities', [])
            if not isinstance(identities, list):
                continue
            if any(isinstance(p, dict) and isinstance(p.get('player'), dict) and p['player'].get('puuid') == own_puuid for p in identities):
                continue
            try:
                v = client_version(entry.get('gameVersion'))
                platform = str(entry.get('platformId', '')).upper()
                identity = match_id(platform + '_' + str(entry.get('gameId', '')))
                if patch_of(v) == patch_of(current) and identity not in seen:
                    result.append({'matchId': identity, 'gameVersion': v, 'mapId': 11})
                    seen.add(identity)
            except ReplayError:
                continue
        return result

    def analyze(self, identity, own_puuid, current_version):
        gid = match_id(identity).split('_')[1]
        game = self.request('GET', '/lol-match-history/v1/games/' + gid)
        if not isinstance(game, dict) or str(game.get('gameId')) != gid or str(game.get('platformId', '')).upper() != identity.split('_')[0] or game.get('mapId') != 11:
            raise ReplayError('Keine passenden Summoner’s-Rift-Matchdaten verfügbar.')
        v = client_version(game.get('gameVersion'))
        if patch_of(v) != patch_of(current_version):
            raise ReplayError('Replay ist nicht vom aktuellen Client-Patch.')
        identities = game.get('participantIdentities')
        if not isinstance(own_puuid, str) or not own_puuid or not isinstance(identities, list) or len(identities) != 10:
            raise ReplayError('Spielerzuordnung für den Ausschluss eigener Spiele fehlt.')
        if any(not isinstance(p, dict) or not isinstance(p.get('player'), dict) or not p['player'].get('puuid') or p['player']['puuid'] == own_puuid for p in identities):
            raise ReplayError('Eigene Spiele oder unvollständige Spielerzuordnung werden nicht bewertet.')
        timeline = None
        try:
            timeline = self.request('GET', '/lol-match-history/v1/game-timelines/' + gid)
        except RemoteError:
            pass
        try:
            scores = score_match(game, timeline)
        except ValueError as exc:
            raise ReplayError(str(exc)) from None
        return {'matchId': identity, 'gameVersion': v, 'patch': patch_of(v), 'mapId': 11,
                'analysisStatus': 'ready', 'scores': scores}

    def ensure_metadata(self, identity, game_version):
        gid = match_id(identity).split('_')[1]
        try:
            return self.request('GET', '/lol-replays/v1/metadata/' + gid)
        except RemoteError as e:
            if e.status != 404:
                raise
        # Retrieve real game details instead of inventing queue/type metadata.
        game = self.request('GET', '/lol-match-history/v1/games/' + gid)
        if not isinstance(game, dict) or client_version(game.get('gameVersion')) != game_version or str(game.get('platformId', '')).upper() != identity.split('_')[0] or str(game.get('gameId')) != gid:
            raise ReplayError('LCU-Metadaten für dieses Server-Replay fehlen; keine erfundenen Metadaten oder Shell-Starts.')
        game_type, queue = game.get('gameType'), game.get('queueId')
        if not isinstance(game_type, str) or not re.fullmatch('[A-Z_]{1,40}', game_type) or not isinstance(queue, int) or queue < 0:
            raise ReplayError('LCU-Spielmetadaten unvollständig.')
        route = f'/lol-replays/v1/metadata/{gid}/create/gameVersion/{version(game_version)}/gameType/{game_type}/queueId/{queue}'
        self.request('POST', route)
        return self.request('GET', '/lol-replays/v1/metadata/' + gid)

    def _download_path(self, identity, game_version, cancel=None, timeout=120):
        gid = match_id(identity).split('_')[1]; version(game_version)
        if patch_of(self.current_version()) != patch_of(game_version):
            raise ReplayError('Replay ist nicht vom aktuellen Client-Patch.')
        self.ensure_metadata(identity, game_version)
        self.request('POST', f'/lol-replays/v1/rofls/{gid}/download', {'componentType': 'replay-button_match-history'})
        directory = self.replay_dir(); deadline = time.monotonic() + timeout
        cancel = cancel or threading.Event()
        while time.monotonic() < deadline and not cancel.is_set():
            metadata = self.request('GET', '/lol-replays/v1/metadata/' + gid)
            state = metadata.get('state') if isinstance(metadata, dict) else None
            if state in ('incompatible', 'missingOrExpired', 'lost', 'unsupported', 'error'):
                raise ReplayError('LCU-Replay nicht verfügbar: ' + state)
            if state in ('watch', 'found'):
                for filename in (identity + '.rofl', identity.replace('_', '-') + '.rofl'):
                    path = directory / filename
                    if path.is_file() and not path.is_symlink():
                        size = path.stat().st_size
                        if 0 < size <= MAX_FILE:
                            return path
                        if size > MAX_FILE:
                            raise ReplayError('Replay ist größer als 150 MiB.')
            if cancel.wait(2):
                break
        raise ReplayError('Download nicht vollständig (abgebrochen oder Zeitlimit 120 Sekunden).')

    def download(self, identity, game_version=None, cancel=None, timeout=120):
        # League's completed-download state is authoritative. Pass through its
        # original .rofl file, including modern formats; do not decode events.
        game_version = self.current_version() if game_version is None else client_version(game_version)
        path = self._download_path(identity, game_version, cancel, timeout)
        return {'matchId': identity, 'gameVersion': game_version, 'filename': path.name}

    def acquire(self, cache, identity, game_version, cancel=None, timeout=120):
        path = self._download_path(identity, game_version, cancel, timeout)
        return cache.add(path, identity, game_version)

    def watch(self, cache, identity):
        item = cache.get(identity)
        if patch_of(self.current_version()) != item['patch']:
            raise ReplayError('Wiedergabe nur mit kompatiblem Client-Patch.')
        self.ensure_metadata(identity, item['gameVersion'])
        directory = self.replay_dir(); directory.mkdir(parents=True, exist_ok=True)
        # LCU uses PLATFORM-gameId.rofl; never overwrite a different existing replay.
        destination = directory / (match_id(identity).replace('_', '-') + '.rofl')
        if destination.exists():
            if destination.is_symlink() or sha_file(destination) != item['sha256']:
                raise ReplayError('Andere Datei im Client-Replay-Ordner; kein Überschreiben.')
        else:
            fd, tmp = tempfile.mkstemp(prefix='.bronze-', dir=directory); os.close(fd)
            try:
                shutil.copyfile(cache.path(identity), tmp)
                if sha_file(tmp) != item['sha256']:
                    raise ReplayError('Replay beim Kopieren verändert.')
                os.replace(tmp, destination)
            finally:
                Path(tmp).unlink(missing_ok=True)
        self.request('POST', '/lol-replays/v1/rofls/scan')
        gid = identity.split('_')[1]
        metadata = self.request('GET', '/lol-replays/v1/metadata/' + gid)
        if not isinstance(metadata, dict) or metadata.get('state') not in ('watch', 'found'):
            raise ReplayError('Datei platziert, aber LCU bietet noch keine Wiedergabe an. Im Client prüfen und erneut starten.')
        self.request('POST', f'/lol-replays/v1/rofls/{gid}/watch', {'componentType': 'replay-button_match-history'})
        return {'message': 'LCU-Wiedergabe angefordert. Replay-Live-Daten sind unbewiesen; /lol-data zeigt nur echte verfügbare Daten.'}
