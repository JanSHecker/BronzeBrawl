"""Deterministic discovery fixtures: no real accounts or replay downloads."""
import json
from pathlib import Path
import random
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion import App
from network import RemoteError
from ranking import score_match
from replay import DiscoveryHistory, LCU, ReplayError
from test_ranking import game_fixture


class ReverseRandom:
    def shuffle(self, values):
        values.reverse()


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'discovery.json'
        self.players = [f'foreign-fixture-player-{n}' for n in range(20)]
        self.queries = []
        self.include_shared = False
        self.unavailable = False
        self.current = '16.20.1.2'

    def tearDown(self):
        self.tmp.cleanup()

    def request(self, method, route, body=None):
        self.assertEqual(method, 'GET')
        if route == '/lol-patch/v1/game-version':
            return self.current
        if route == '/lol-summoner/v1/current-summoner':
            return {'puuid': 'own-fixture-account'}
        if route.startswith('/lol-ranked/'):
            return {'divisions': [{'standings': [{'puuid': puuid} for puuid in self.players]}]}
        puuid = route.split('/lol/')[1].split('/')[0]
        self.queries.append(puuid)
        if self.unavailable:
            raise RemoteError(503)
        number = self.players.index(puuid)
        games = [{'gameId': 1000 + number, 'platformId': 'EUW1', 'mapId': 11, 'gameVersion': '16.20.1.2'}]
        if self.include_shared:
            games.append(dict(games[0], gameId=999))
        return {'games': {'games': games}}

    def client(self, rng=None):
        return LCU(None, discovery=DiscoveryHistory(self.path), rng=rng or ReverseRandom())

    def test_randomizes_players_and_results_instead_of_using_the_ladder_head(self):
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            result = client.discover()
        self.assertEqual(self.queries, self.players[-5:][::-1])
        self.assertEqual([item['matchId'] for item in result], [f'EUW1_{1000 + n}' for n in range(15, 20)])
        self.assertIsInstance(LCU(None).rng, random.SystemRandom)

    def test_new_client_after_restart_uses_unvisited_players_and_never_repeats_shared_matches(self):
        self.include_shared = True
        first = self.client(random.Random(41))
        with patch.object(first, 'request', side_effect=self.request):
            a = first.discover()
        first_players = set(self.queries)
        self.queries.clear()
        restarted = self.client(random.Random(42))
        with patch.object(restarted, 'request', side_effect=self.request):
            b = restarted.discover()
        self.assertTrue(first_players.isdisjoint(self.queries))
        self.assertTrue({item['matchId'] for item in a}.isdisjoint(item['matchId'] for item in b))
        self.assertEqual(len(a), 6)
        self.assertEqual(len(b), 5)
        saved = self.path.read_text()
        self.assertNotIn('foreign-fixture', saved)
        self.assertNotIn('own-fixture', saved)
        self.assertEqual(len(json.loads(saved)['players']), 10)

    def test_repeated_search_in_same_process_also_remembers_matches(self):
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            first = client.discover()
            second = client.discover()
        self.assertEqual(len(set(self.queries)), 10)
        self.assertTrue({item['matchId'] for item in first}.isdisjoint(item['matchId'] for item in second))

    def test_tries_a_second_batch_when_first_five_players_only_have_known_matches(self):
        history = DiscoveryHistory(self.path)
        history.for_patch('16.20')
        history.remember_matches(f'EUW1_{1000 + n}' for n in range(15, 20))
        history.save()
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            result = client.discover()
        self.assertEqual(len(self.queries), 10)
        self.assertEqual({item['matchId'] for item in result}, {f'EUW1_{1000 + n}' for n in range(10, 15)})

    def test_exhausted_sample_has_bounded_requests_and_does_not_fall_back_to_repeats(self):
        history = DiscoveryHistory(self.path)
        history.for_patch('16.20')
        history.remember_matches(f'EUW1_{1000 + n}' for n in range(20))
        history.save()
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            self.assertEqual(client.discover(), [])
        self.assertEqual(len(self.queries), 15)
        self.assertEqual(len(set(self.queries)), 15)

    def test_failed_requests_do_not_mark_unknown_matches_seen(self):
        self.unavailable = True
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            with self.assertRaises(ReplayError):
                client.discover()
        self.assertEqual(len(self.queries), 15)
        self.assertEqual(json.loads(self.path.read_text())['matches'], [])
        self.unavailable = False
        self.queries.clear()
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            self.assertEqual(len(client.discover()), 5)
        self.assertEqual(set(self.queries), set(self.players[:5]))

    def test_patch_change_resets_history_but_still_rejects_old_patch_matches(self):
        client = self.client()
        with patch.object(client, 'request', side_effect=self.request):
            self.assertTrue(client.discover())
            self.current = '16.21.1.2'
            self.assertEqual(client.discover(), [])
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved['patch'], '16.21')
        self.assertEqual(saved['matches'], [])

    def test_invalid_history_is_ignored_and_history_size_is_bounded(self):
        self.path.write_text('invalid json')
        history = DiscoveryHistory(self.path)
        self.assertEqual(history.matches, [])
        history.for_patch('16.20')
        history.remember_matches(f'EUW1_{n}' for n in range(1, 50003))
        history.save()
        restored = DiscoveryHistory(self.path)
        self.assertEqual(len(restored.matches), 50000)
        self.assertEqual(restored.matches[0], 'EUW1_3')
        self.assertEqual(restored.matches[-1], 'EUW1_50002')


class DiscoveryAppTests(unittest.TestCase):
    def test_existing_rankings_seed_history_and_reconfiguration_keeps_it(self):
        with tempfile.TemporaryDirectory() as root:
            item = {'matchId': 'EUW1_123', 'mapId': 11, 'patch': '16.20', 'scores': score_match(game_fixture())}
            (Path(root) / 'rankings.json').write_text(json.dumps({'items': [item]}))
            app = App(root)
            try:
                self.assertIn('EUW1_123', app.discovery.matches)
                app.configure({})
                self.assertIs(app.lcu.discovery, app.discovery)
                self.assertIn('EUW1_123', app.discovery.matches)
            finally:
                app.close()

    def test_empty_new_search_preserves_previous_rankings_and_does_not_download(self):
        with tempfile.TemporaryDirectory() as root:
            app = App(root)
            item = {'matchId': 'EUW1_123', 'mapId': 11, 'patch': '16.20', 'scores': score_match(game_fixture())}
            app.ranking_state['items'] = [item]
            try:
                with patch.object(app.lcu, 'current_version', return_value='16.20.1.2'), \
                     patch.object(app.lcu, 'discover', return_value=[]), \
                     patch.object(app.lcu, 'download') as download:
                    ranked = app.rank_replays()
                    result = app.fetch_replays()
                self.assertEqual(ranked['items'], [item])
                self.assertFalse(ranked['running'])
                self.assertIn('letzte Rangliste', ranked['notice'])
                self.assertIn('Keine neuen', result['message'])
                self.assertEqual(result['rankings']['items'], [item])
                download.assert_not_called()
            finally:
                app.close()


if __name__ == '__main__':
    unittest.main()
