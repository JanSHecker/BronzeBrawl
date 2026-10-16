"""Validated historical objective events, never inferred from live stats or ROFL bytes."""
import copy
import math
import re


SOURCE_VERSION = 1
NEUTRAL_EVENTS = {'DragonKill', 'BaronKill', 'HeraldKill', 'HordeKill', 'VoidGrubKill'}
MONSTERS = {'DRAGON': 'DragonKill', 'BARON_NASHOR': 'BaronKill',
            'RIFTHERALD': 'HeraldKill', 'HORDE': 'HordeKill'}


def base_champion(player):
    # rawChampionName also changes during possession; rawSkinName does not.
    if re.match(r'^game_character_(?:skin_)?displayname_Viego(?:_|$)', str(player.get('rawSkinName', '')), re.I):
        return 'Viego'
    return player.get('championName', '')


def player_identity(player):
    name = player.get('riotId')
    if not name:
        name = player.get('riotIdGameName', '')
        if name and player.get('riotIdTagLine'):
            name += '#' + player['riotIdTagLine']
    return str(name or player.get('summonerName', '')).strip().lower()


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def valid_source(source):
    try:
        if not isinstance(source, dict) or source.get('version') != SOURCE_VERSION or not re.fullmatch(r'[A-Z0-9]+_[1-9][0-9]*', source.get('matchId', '')):
            return False
        roster, events, kills = source['roster'], source['events'], source['kills']
        identities = {player_identity(player) for player in roster}
        if len(roster) != 10 or len(identities) != 10 or '' in identities or any(sum(p['team'] == team for p in roster) != 5 for team in ('ORDER', 'CHAOS')):
            return False
        if not isinstance(events, list) or len(events) > 1000 or len({event['SourceEventIndex'] for event in events}) != len(events) or not isinstance(kills, list):
            return False
        for event in events:
            if type(event['SourceEventIndex']) is not int or not 0 <= event['SourceEventIndex'] < 1_000_000 or event['EventName'] not in NEUTRAL_EVENTS or not finite(event['EventTime']) or event['KillerName'].lower() not in identities or event['KillerTeam'] not in (100, 200):
                return False
        return all(finite(kill['time']) and kill['victim'].lower() in identities and (kill['killer'] is None or kill['killer'].lower() in identities) for kill in kills)
    except (TypeError, KeyError, AttributeError):
        return False


def build_source(identity, game, timeline):
    """Raise on incomplete/mismatched data rather than mark a partial source ready."""
    if not isinstance(game, dict) or f"{game.get('platformId')}_{game.get('gameId')}" != identity or game.get('mapId') != 11:
        raise ValueError('Matchdaten passen nicht zum Replay.')
    if not finite(game.get('gameDuration')) or game['gameDuration'] <= 0:
        raise ValueError('Spieldauer fehlt.')
    participants = game.get('participants', [])
    identities = game.get('participantIdentities', [])
    if len(participants) != 10 or len(identities) != 10:
        raise ValueError('Vollständige Teilnehmerzuordnung fehlt.')
    roster = {}
    for participant in participants:
        pid, team = participant.get('participantId'), participant.get('teamId')
        if type(pid) is not int or not 1 <= pid <= 10 or pid in roster or team not in (100, 200):
            raise ValueError('Ungültige Teilnehmerzuordnung.')
        roster[pid] = {'participantId': pid, 'team': 'ORDER' if team == 100 else 'CHAOS'}
    assigned = set()
    for entry in identities:
        pid, player = entry.get('participantId'), entry.get('player', {})
        name, tag = player.get('gameName'), player.get('tagLine')
        if pid not in roster or pid in assigned or not isinstance(name, str) or not name.strip() or not isinstance(tag, str) or not tag.strip():
            raise ValueError('Riot-ID zur Timeline fehlt.')
        roster[pid]['riotId'] = name.strip() + '#' + tag.strip()
        assigned.add(pid)
    if len({player_identity(player) for player in roster.values()}) != 10 or any(sum(p['team'] == team for p in roster.values()) != 5 for team in ('ORDER', 'CHAOS')):
        raise ValueError('Doppelte oder unvollständige Teams.')
    frames = timeline.get('frames') if isinstance(timeline, dict) else None
    if not isinstance(frames, list) or len(frames) < 2:
        raise ValueError('Vollständige Timeline nicht verfügbar.')
    if not finite(frames[0].get('timestamp')) or frames[0]['timestamp'] > 120000 or not finite(frames[-1].get('timestamp')) or frames[-1]['timestamp'] < game['gameDuration'] * 1000 - 120000:
        raise ValueError('Timeline ist unvollständig.')
    events, kills = [], []
    previous = -1
    for frame in frames:
        if not finite(frame.get('timestamp')) or frame['timestamp'] <= previous or not isinstance(frame.get('events'), list):
            raise ValueError('Timeline-Ereignisse fehlen oder sind ungültig.')
        previous = frame['timestamp']
        for event in frame['events']:
            if not isinstance(event, dict) or not finite(event.get('timestamp')) or event['timestamp'] > game['gameDuration'] * 1000 + 120000:
                raise ValueError('Ungültiges Timeline-Ereignis.')
            if event.get('type') == 'CHAMPION_KILL':
                victim, killer = event.get('victimId'), event.get('killerId')
                if victim not in roster or killer not in (0, *roster):
                    raise ValueError('Kill-Teilnehmer fehlt.')
                kills.append({'time': event['timestamp'] / 1000, 'victim': roster[victim]['riotId'],
                              'killer': roster[killer]['riotId'] if killer else None})
            if event.get('type') != 'ELITE_MONSTER_KILL':
                continue
            kind = MONSTERS.get(event.get('monsterType'))
            if kind is None:
                continue  # Unknown monster types are not relabelled as supported objectives.
            killer = roster.get(event.get('killerId'))
            if killer is None:
                raise ValueError('Objective-Killer fehlt.')
            objective = {'SourceEventIndex': len(events), 'EventName': kind, 'EventTime': event['timestamp'] / 1000,
                         'KillerName': killer['riotId'], 'KillerTeam': 100 if killer['team'] == 'ORDER' else 200}
            if kind == 'DragonKill':
                subtype = event.get('monsterSubType', '')
                if not isinstance(subtype, str) or not subtype:
                    raise ValueError('Drachentyp fehlt.')
                objective['DragonType'] = subtype.removesuffix('_DRAGON').title()
            events.append(objective)
    # Summary counters independently detect missing event arrays in otherwise valid frames.
    for team in game.get('teams', []):
        for counter, monster in (('dragonKills', 'DragonKill'), ('baronKills', 'BaronKill'), ('riftHeraldKills', 'HeraldKill')):
            expected = team.get(counter)
            if type(expected) is int and expected >= 0 and sum(e['EventName'] == monster and e['KillerTeam'] == team.get('teamId') for e in events) != expected:
                raise ValueError('Objective-Timeline stimmt nicht mit dem Matchergebnis überein.')
    return {'version': SOURCE_VERSION, 'matchId': identity, 'roster': list(roster.values()),
            'events': sorted(events, key=lambda event: (event['EventTime'], event['SourceEventIndex'])), 'kills': kills}


def matches_source(source, data):
    roster = data.get('allPlayers', [])
    if {(player_identity(p), p.get('team')) for p in roster} != {(player_identity(p), p['team']) for p in source['roster']} or len(roster) != 10:
        return False
    # Same players can play more than once: corroborate any available kill history.
    aliases = {}
    for player in roster:
        canonical = player_identity(player)
        for name in (canonical, player.get('summonerName'), player.get('riotIdGameName')):
            if name:
                aliases.setdefault(str(name).strip().lower(), set()).add(canonical)
    def resolve(name):
        candidates = aliases.get(str(name).strip().lower(), set())
        return next(iter(candidates)) if len(candidates) == 1 else None
    for event in data.get('events', {}).get('Events', []):
        if event.get('EventName') != 'ChampionKill':
            continue
        killer, victim = resolve(event.get('KillerName')), resolve(event.get('VictimName'))
        if not finite(event.get('EventTime')) or not any(abs(kill['time'] - event['EventTime']) <= 0.5
                and kill['victim'].lower() == victim and (kill['killer'].lower() if kill['killer'] else None) == killer for kill in source['kills']):
            return False
    return True


def enrich_snapshot(source, data):
    if not matches_source(source, data) or not finite(data.get('gameData', {}).get('gameTime')):
        raise ValueError('Live-Daten passen nicht zur Objective-Timeline.')
    result = copy.deepcopy(data)
    clock = data['gameData']['gameTime']
    result['replayTimeline'] = {'matchId': source['matchId'],
                              'events': [copy.deepcopy(event) for event in source['events'] if event['EventTime'] <= clock]}
    return result
