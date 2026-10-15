"""Local metrics v2: separate team ratios; carry/momentum use backend formula v1.

Only real LCU match summaries/timelines enter here; never decode ROFL events.
No account identifiers are retained in the resulting metrics.
"""
import math

RANKING_VERSION = 2
SORT_KEYS = ('kills', 'gold', 'carry', 'momentum')


def sort_rankings(items, sort_by='kills', descending=True):
    """Unknown scores stay last in either direction; ties use the match ID."""
    if sort_by not in SORT_KEYS:
        raise ValueError('Unbekannte Ranking-Sortierung.')
    def key(item):
        value = item['scores'][sort_by]
        return (value is None, (-value if descending else value) if value is not None else 0, item['matchId'])
    return sorted(items, key=key)


def nonnegative(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def team_ratio(first, second):
    if not nonnegative(first) or not nonnegative(second):
        raise ValueError('Ungültige Teamwerte für das Verhältnis.')
    smaller, larger = min(first, second), max(first, second)
    return {'smaller': smaller, 'larger': larger, 'ratio': smaller / larger if larger else None}


def unit(value):
    return min(1, max(0, value))


def rounded(value):
    return math.floor(value * 100 + .5) / 100


def points(value):
    return rounded(unit(value) * 100)


def valid_ranking(item):
    """Ignore damaged persisted scores rather than publishing invalid numbers."""
    if not isinstance(item, dict) or item.get('mapId') != 11 or not isinstance(item.get('matchId'), str):
        return False
    scores = item.get('scores')
    if not isinstance(scores, dict) or not all(key in scores for key in SORT_KEYS) or scores.get('version') != RANKING_VERSION or not isinstance(scores.get('metrics'), dict):
        return False
    if not nonnegative(scores['carry']) or scores['carry'] > 100 or not (scores['momentum'] is None or nonnegative(scores['momentum']) and scores['momentum'] <= 100):
        return False
    for key in ('kills', 'gold'):
        measure = scores['metrics'].get(key + 'Ratio')
        if not isinstance(measure, dict) or 'ratio' not in measure or not nonnegative(measure.get('smaller')) or not nonnegative(measure.get('larger')) or measure['smaller'] > measure['larger']:
            return False
        expected = measure['smaller'] / measure['larger'] if measure['larger'] else None
        if expected is None:
            if scores[key] is not None or measure.get('ratio') is not None:
                return False
        elif not nonnegative(scores[key]) or not nonnegative(measure.get('ratio')) or not math.isclose(scores[key], expected, rel_tol=1e-12) or not math.isclose(measure['ratio'], expected, rel_tol=1e-12):
            return False
    return True


def score_match(game, timeline=None):
    players = game.get('participants') if isinstance(game, dict) else None
    duration = game.get('gameDuration') if isinstance(game, dict) else None
    if not isinstance(players, list) or len(players) != 10 or game.get('mapId') != 11 or not nonnegative(duration) or duration <= 0:
        raise ValueError('Vollständiges Summoner’s-Rift-Spiel mit zehn Spielern erforderlich.')
    p = []
    for player in players:
        stats = player.get('stats', {}) if isinstance(player, dict) else {}
        pid = player.get('participantId') if isinstance(player, dict) else None
        kills = stats.get('kills') if isinstance(stats, dict) else None
        if type(pid) is not int or not 1 <= pid <= 10 or player.get('teamId') not in (100, 200) or type(kills) is not int or not 0 <= kills <= 9007199254740991 or not nonnegative(stats.get('goldEarned')):
            raise ValueError('Spielstatistiken unvollständig oder ungültig.')
        p.append({'participantId': pid, 'teamId': player['teamId'], 'kills': kills})
    if len({x['participantId'] for x in p}) != 10 or any(sum(x['teamId'] == team for x in p) != 5 for team in (100, 200)):
        raise ValueError('Eindeutige Spieler und zwei Fünferteams erforderlich.')
    teams = []
    for team in (100, 200):
        members = [x for x in p if x['teamId'] == team]
        kills = sum(x['kills'] for x in members)
        team_gold = sum(x['stats']['goldEarned'] for x in players if x['teamId'] == team)
        shares = [x['kills'] / kills if kills else 0 for x in members]
        teams.append({'teamId': team, 'kills': kills, 'goldEarned': team_gold, 'players': members, 'killShares': shares,
                      'killConcentration': sum(s * s for s in shares)})
    total_kills = sum(t['kills'] for t in teams)
    kills_ratio = team_ratio(teams[0]['kills'], teams[1]['kills'])
    gold_ratio = team_ratio(teams[0]['goldEarned'], teams[1]['goldEarned'])
    leaders = sorted(p, key=lambda x: (-x['kills'], x['participantId']))
    leader = leaders[0]
    concentration = max(unit((max(t['killShares']) - .2) / .8) * min(1, t['kills'] / 10) if t['kills'] else 0 for t in teams)
    dominance = (leader['kills'] - leaders[1]['kills']) / leader['kills'] if leader['kills'] else 0
    timeline_status = 'missing' if timeline is None else 'invalid'
    gold = None; momentum = None
    try:
        frames = timeline['frames']
        if not isinstance(frames, list) or not 2 <= len(frames) <= 2000:
            raise ValueError()
        samples = []; previous = -1
        for frame in frames:
            timestamp = frame['timestamp']
            if not nonnegative(timestamp) or timestamp <= previous or timestamp > duration * 1000 + 120000:
                raise ValueError()
            previous = timestamp
            entries = frame['participantFrames']
            if not isinstance(entries, dict) or len(entries) != 10:
                raise ValueError()
            sums = {100: 0, 200: 0}
            for player in p:
                value = entries[str(player['participantId'])]
                if value['participantId'] != player['participantId'] or not nonnegative(value.get('totalGold')):
                    raise ValueError()
                sums[player['teamId']] += value['totalGold']
            total = sums[100] + sums[200]
            samples.append({'timestamp': timestamp, 'team100': sums[100], 'team200': sums[200],
                            'difference': sums[100] - sums[200], 'parity': 1 - abs(sums[100] - sums[200]) / total if total else 1})
        if samples[0]['timestamp'] > 120000 or samples[-1]['timestamp'] < duration * 1000 - 120000:
            raise ValueError()
        integral = 0; changes = 0; last_lead = 0; peak = 0; trough = 0; recovery = 0
        for i, sample in enumerate(samples):
            if i:
                before = samples[i - 1]
                integral += (sample['parity'] + before['parity']) / 2 * (sample['timestamp'] - before['timestamp'])
            diff = sample['difference']
            lead = 1 if diff > 1000 else -1 if diff < -1000 else 0
            if lead and last_lead and lead != last_lead:
                changes += 1
            if lead:
                last_lead = lead
            if peak > 1000:
                recovery = max(recovery, peak - diff)
            if trough < -1000:
                recovery = max(recovery, diff - trough)
            peak = max(peak, diff); trough = min(trough, diff)
        swing = peak - trough
        parity = integral / (samples[-1]['timestamp'] - samples[0]['timestamp'])
        momentum = points(.4 * unit((swing - 2000) / 18000) + .3 * unit(changes / 2) + .3 * unit((recovery - 2000) / 12000))
        gold = {'timeWeightedParity': parity, 'minLead': trough, 'maxLead': peak, 'swing': swing,
                'leadChanges': changes, 'comebackRecovery': recovery, 'deadband': 1000, 'samples': samples}
        timeline_status = 'valid'
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        pass  # Missing or malformed gold history is never replaced with zeros.
    carry = points(.75 * concentration + .25 * dominance)
    return {'version': RANKING_VERSION, 'kills': kills_ratio['ratio'], 'gold': gold_ratio['ratio'], 'carry': carry, 'momentum': momentum,
            'metrics': {'formula': 'bronze-brawl-local-v2', 'timelineStatus': timeline_status,
                        'partial': timeline_status != 'valid', 'durationSeconds': duration,
                        'totalKills': total_kills, 'killsPerMinute': total_kills / (duration / 60),
                        'killsRatio': kills_ratio, 'goldRatio': gold_ratio, 'teams': teams, 'carryPlayer': leader,
                        'concentration': concentration, 'dominance': dominance, 'gold': gold}}
