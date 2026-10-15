"""Generated statistics only; no real match recordings or account data."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ranking import RANKING_VERSION, score_match, sort_rankings, valid_ranking
from replay import LCU, ReplayError
from network import RemoteError
from companion import App


def game_fixture(kills=None):
    kills = [4] * 10 if kills is None else kills
    return {'gameId': 123, 'platformId': 'EUW1', 'mapId': 11, 'gameVersion': '16.20.1.2', 'gameDuration': 1800,
            'participants': [{'participantId': i + 1, 'teamId': 200 if i % 2 else 100,
                              'stats': {'kills': value, 'goldEarned': 12000}} for i, value in enumerate(kills)],
            'participantIdentities': [{'participantId': i + 1, 'player': {'puuid': f'foreign-player-{i}'}} for i in range(10)]}


def timeline_fixture(differences=(0, 0, 0, 0)):
    return {'frames': [{'timestamp': n * 600000, 'participantFrames': {
        str(i + 1): {'participantId': i + 1, 'totalGold': 500 + n * 3000 + (max(-d, 0) if i % 2 else max(d, 0)) / 5}
        for i in range(10)}} for n, d in enumerate(differences)]}


class ScoringTests(unittest.TestCase):
    def test_equal_teams_have_two_separate_ratios_not_a_mixed_balance(self):
        scores = score_match(game_fixture(), timeline_fixture())
        self.assertEqual({key: scores[key] for key in ('version', 'kills', 'gold', 'carry', 'momentum')},
                         {'version': RANKING_VERSION, 'kills': 1, 'gold': 1, 'carry': 0, 'momentum': 0})
        self.assertNotIn('balance', scores)
        self.assertNotIn('overall', scores)
        self.assertEqual(scores['metrics']['totalKills'], 40)
        self.assertEqual(scores['metrics']['formula'], 'bronze-brawl-local-v2')

    def test_ratios_are_smaller_over_larger_from_final_team_totals_not_timeline(self):
        game = game_fixture([4, 6] * 5)
        for player in game['participants']:
            player['stats']['goldEarned'] = 8000 if player['teamId'] == 100 else 10000
        for timeline in (None, timeline_fixture((0, 12000, 18000, 0))):
            scores = score_match(game, timeline)
            self.assertAlmostEqual(scores['kills'], 20 / 30)
            self.assertEqual(scores['gold'], .8)
            self.assertEqual(scores['metrics']['killsRatio'], {'smaller': 20, 'larger': 30, 'ratio': 20 / 30})
            self.assertEqual(scores['metrics']['goldRatio'], {'smaller': 40000, 'larger': 50000, 'ratio': .8})
        for player in game['participants']:
            player['teamId'] = 200 if player['teamId'] == 100 else 100
        self.assertEqual(score_match(game)['gold'], .8)
        self.assertAlmostEqual(score_match(game)['kills'], 20 / 30)

    def test_zero_numerator_is_zero_but_zero_over_zero_is_unavailable(self):
        scores = score_match(game_fixture([0, 4] * 5))
        self.assertEqual(scores['kills'], 0)
        zero = game_fixture([0] * 10)
        for player in zero['participants']:
            player['stats']['goldEarned'] = 0
        scores = score_match(zero)
        self.assertIsNone(scores['kills'])
        self.assertIsNone(scores['gold'])
        self.assertEqual(scores['metrics']['killsRatio'], {'smaller': 0, 'larger': 0, 'ratio': None})

    def test_stomp_carry_and_comeback_remain_distinct(self):
        stomp = score_match(game_fixture([8, 0] * 5), timeline_fixture((0, 12000, 18000, 0)))
        self.assertEqual(stomp['kills'], 0)
        self.assertEqual(stomp['gold'], 1)
        carry = score_match(game_fixture([20, 4, 0, 4, 0, 4, 0, 4, 0, 4]), timeline_fixture())
        self.assertEqual(carry['kills'], 1)
        self.assertGreater(carry['carry'], 75)
        big = score_match(game_fixture(), timeline_fixture((0, 12000, -6000, 6000)))
        noise = score_match(game_fixture(), timeline_fixture((0, 100, -100, 100)))
        self.assertGreater(big['momentum'], 60)
        self.assertLess(noise['momentum'], 5)
        self.assertEqual(big['metrics']['gold']['leadChanges'], 2)

    def test_missing_and_invalid_timelines_never_create_gold_or_momentum(self):
        bad = timeline_fixture(); bad['frames'][1]['timestamp'] = 0
        incomplete = timeline_fixture(); del incomplete['frames'][1]['participantFrames']['10']
        truncated = timeline_fixture(); truncated['frames'].pop()
        for timeline in (None, {}, bad, incomplete, truncated):
            scores = score_match(game_fixture([0] * 10), timeline)
            self.assertIsNone(scores['momentum'])
            self.assertIsNone(scores['metrics']['gold'])
            self.assertTrue(scores['metrics']['partial'])
            self.assertIsNone(scores['kills'])
            self.assertEqual(scores['gold'], 1)

    def test_rejects_bad_maps_rosters_stats_and_duration(self):
        for mutate in (
            lambda g: g.update(mapId=12), lambda g: g.update(gameDuration=0),
            lambda g: g['participants'][1].update(participantId=1),
            lambda g: g['participants'][1].update(teamId=100),
            lambda g: g['participants'][1]['stats'].update(kills=-1),
            lambda g: g['participants'][1]['stats'].update(kills=True),
            lambda g: g['participants'][1]['stats'].update(goldEarned=float('nan')),
        ):
            game = game_fixture(); mutate(game)
            with self.assertRaises(ValueError):
                score_match(game)


class SortingTests(unittest.TestCase):
    def test_each_score_sorts_independently_without_mutating_the_source(self):
        items = [
            {'matchId': 'EUW1_123', 'scores': {'kills': .8, 'gold': .6, 'carry': 90, 'momentum': None}},
            {'matchId': 'EUW1_456', 'scores': {'kills': .7, 'gold': .99, 'carry': 20, 'momentum': 85}},
        ]
        original = copy.deepcopy(items)
        for key, first in [('kills', 'EUW1_123'), ('gold', 'EUW1_456'), ('carry', 'EUW1_123'), ('momentum', 'EUW1_456')]:
            self.assertEqual(sort_rankings(items, key)[0]['matchId'], first)
        self.assertEqual(items, original)

    def test_unknown_scores_are_last_in_both_directions_and_zero_is_a_real_score(self):
        items = [{'matchId': identity, 'scores': {'momentum': score}} for identity, score in
                 [('EUW1_999', None), ('EUW1_456', 50), ('EUW1_123', 50), ('EUW1_789', 0)]]
        self.assertEqual([x['matchId'] for x in sort_rankings(items, 'momentum')],
                         ['EUW1_123', 'EUW1_456', 'EUW1_789', 'EUW1_999'])
        self.assertEqual([x['matchId'] for x in sort_rankings(items, 'momentum', False)],
                         ['EUW1_789', 'EUW1_123', 'EUW1_456', 'EUW1_999'])
        with self.assertRaises(ValueError):
            sort_rankings(items, 'not-a-score')

    def test_ratios_sort_by_the_full_quotient_not_team_totals_or_display_rounding(self):
        items = [{'matchId': identity, 'scores': {'kills': ratio}} for identity, ratio in
                 [('EUW1_123', 100 / 300), ('EUW1_456', 1 / 2), ('EUW1_789', 200 / 399)]]
        self.assertEqual([x['matchId'] for x in sort_rankings(items)], ['EUW1_789', 'EUW1_456', 'EUW1_123'])
        self.assertEqual([x['matchId'] for x in sort_rankings(items, 'kills', False)], ['EUW1_123', 'EUW1_456', 'EUW1_789'])


class LCURankingTests(unittest.TestCase):
    def test_identity_version_map_and_own_games_are_checked_before_timeline(self):
        client = LCU(None)
        for field, value in (('gameId', 456), ('platformId', 'NA1'), ('mapId', 12), ('gameVersion', '16.19.1.2')):
            game = game_fixture(); game[field] = value
            with patch.object(client, 'request', return_value=game) as request:
                with self.assertRaises(ReplayError):
                    client.analyze('EUW1_123', 'own-account', '16.20.1.2')
                self.assertEqual(request.call_count, 1)
        game = game_fixture(); game['participantIdentities'][0]['player']['puuid'] = 'own-account'
        with patch.object(client, 'request', return_value=game):
            with self.assertRaisesRegex(ReplayError, 'Eigene Spiele'):
                client.analyze('EUW1_123', 'own-account', '16.20.1.2')

    def test_actual_lcu_schema_produces_scores_without_account_identifiers(self):
        client = LCU(None)
        with patch.object(client, 'request', side_effect=[game_fixture(), timeline_fixture()]) as request:
            result = client.analyze('EUW1_123', 'own-account', '16.20.1.2')
        self.assertEqual(result['scores']['kills'], 1)
        self.assertEqual(result['scores']['gold'], 1)
        self.assertEqual(request.call_args.args, ('GET', '/lol-match-history/v1/game-timelines/123'))
        self.assertNotIn('foreign-player', json.dumps(result))
        with patch.object(client, 'request', side_effect=[game_fixture(), RemoteError(404)]):
            result = client.analyze('EUW1_123', 'own-account', '16.20.1.2')
        self.assertIsNone(result['scores']['momentum'])


class RankingStorageTests(unittest.TestCase):
    def test_rankings_do_not_require_downloaded_files(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root); client = LCU(None); app.lcu = client
            with patch.object(client, 'current_version', return_value='16.20.1.2'), \
                 patch.object(client, 'discover', return_value=[{'matchId': 'EUW1_123'}]), \
                 patch.object(client, 'request', side_effect=[{'puuid': 'own-account'}, game_fixture(), timeline_fixture()]), \
                 patch.object(client, 'replay_dir', return_value=Path(root)):
                result = app.rank_replays()
            self.assertEqual(len(result['items']), 1)
            self.assertFalse(result['items'][0]['downloaded'])
            self.assertIsNone(result['items'][0]['filename'])
            self.assertEqual(result['items'][0]['scores']['kills'], 1)
            app.close()

    def test_corrupt_persisted_rankings_are_ignored(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / 'rankings.json').write_text(json.dumps({'items': [{'scores': {}}]}))
            app = App(root)
            self.assertEqual(app.rankings()['items'], [])
            app.close()

    def test_local_files_are_scored_persisted_sorted_and_cached_but_not_uploaded(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root)
            files = Path(root) / 'replays'; files.mkdir()
            (files / 'EUW1-123.rofl').write_bytes(b'opaque modern ROFL')
            (files / 'EUW1-456.rofl').write_bytes(b'another opaque replay')
            (files / 'unknown.rofl').write_bytes(b'not a match id')
            client = LCU(None)
            app.lcu = client
            def analyze(identity, own, current):
                self.assertEqual(own, 'own-account')
                score = score_match(game_fixture([4, 6] * 5 if identity == 'EUW1_123' else None), timeline_fixture())
                return {'matchId': identity, 'gameVersion': current, 'patch': '16.20', 'mapId': 11,
                        'analysisStatus': 'ready', 'scores': score}
            with patch.object(client, 'current_version', return_value='16.20.1.2'), \
                 patch.object(client, 'discover', return_value=[{'matchId': 'EUW1_123'}, {'matchId': 'EUW1_456'}]), \
                 patch.object(client, 'request', return_value={'puuid': 'own-account'}), \
                 patch.object(client, 'replay_dir', return_value=files), \
                 patch.object(client, 'analyze', side_effect=analyze) as scorer:
                result = app.rank_replays()
                self.assertEqual([i['matchId'] for i in result['items']], ['EUW1_456', 'EUW1_123'])
                self.assertFalse(result['running'])
                self.assertIsNone(result['error'])
                app.rank_replays()
                self.assertEqual(scorer.call_count, 2)
                (files / 'EUW1-123.rofl').write_bytes(b'changed replay')
                app.rank_replays()
                self.assertEqual(scorer.call_count, 2)
            saved = (Path(root) / 'rankings.json').read_text()
            self.assertNotIn('own-account', saved)
            restored = App(root)
            self.assertEqual(len(restored.rankings()['items']), 2)
            (files / 'EUW1-456.rofl').unlink()
            with patch.object(client, 'current_version', return_value='16.20.1.2'), \
                 patch.object(client, 'discover', return_value=[{'matchId': 'EUW1_123'}, {'matchId': 'EUW1_456'}]), \
                 patch.object(client, 'request', return_value={'puuid': 'own-account'}), \
                 patch.object(client, 'replay_dir', return_value=files):
                rows = app.rank_replays()['items']
                self.assertEqual(len(rows), 2)
                self.assertFalse(rows[0]['downloaded'])
            app.close(); restored.close()

    def test_partial_scores_retry_and_failed_match_does_not_hide_success(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root); client = LCU(None); app.lcu = client
            for gid in (123, 456):
                (Path(root) / f'EUW1-{gid}.rofl').write_bytes(b'ROFL')
            result = {'matchId': 'EUW1_123', 'gameVersion': '16.20.1.2', 'patch': '16.20', 'mapId': 11,
                      'analysisStatus': 'ready', 'scores': score_match(game_fixture())}
            with patch.object(client, 'current_version', return_value='16.20.1.2'), \
                 patch.object(client, 'discover', return_value=[{'matchId': 'EUW1_123'}, {'matchId': 'EUW1_456'}]), \
                 patch.object(client, 'request', return_value={'puuid': 'own-account'}), \
                 patch.object(client, 'replay_dir', return_value=Path(root)), \
                 patch.object(client, 'analyze', side_effect=[copy.deepcopy(result), ReplayError('Own game'), copy.deepcopy(result), ReplayError('Own game')]) as scorer:
                first = app.rank_replays()
                second = app.rank_replays()
                self.assertEqual(len(first['items']), 1)
                self.assertEqual(second['skipped'], 1)
                self.assertEqual(scorer.call_count, 4)
            app.close()

    def test_old_mixed_score_cache_is_invalidated_and_inconsistent_ratios_are_rejected(self):
        row = {'matchId': 'EUW1_123', 'mapId': 11, 'scores': score_match(game_fixture())}
        self.assertTrue(valid_ranking(row))
        row['scores']['kills'] = .8
        self.assertFalse(valid_ranking(row))
        with tempfile.TemporaryDirectory() as root:
            row['scores']['version'] = 1
            (Path(root) / 'rankings.json').write_text(json.dumps({'items': [row]}))
            app = App(root)
            self.assertEqual(app.rankings()['items'], [])
            app.close()


if __name__ == '__main__':
    unittest.main()
