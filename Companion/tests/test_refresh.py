"""F5 re-probes listed stats/timelines, with no discovery or download side effects."""
import copy
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion import App
from network import RemoteError
from ranking import score_match
from replay import LCU, ReplayError
from timeline import build_source
from test_timeline import fixture


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = App(self.tmp.name)
        self.client = LCU(None)
        self.app.lcu = self.client
        self.game, self.timeline, _ = fixture()
        self.game['gameVersion'] = '16.20.1.2'
        for participant, identity in zip(self.game['participants'], self.game['participantIdentities']):
            participant['stats'] = {'kills': 4, 'goldEarned': 12000}
            identity['player']['puuid'] = f"foreign-{participant['participantId']}"
        self.own = 'fixture-local-account'
        self.app.ranking_account = hashlib.sha256(self.own.encode()).hexdigest()
        self.old = {'matchId': 'EUW1_123', 'mapId': 11, 'patch': '16.20', 'gameVersion': '16.20.1.2',
                    'downloaded': True, 'scores': score_match(self.game)}
        self.old['scores']['metrics']['partial'] = False
        self.old['scores']['carry'] = 99
        self.old['objectiveSource'] = {'status': 'ready', 'count': 0}
        self.app.ranking_state['items'] = [copy.deepcopy(self.old)]
        self.source = build_source('EUW1_123', self.game, self.timeline)
        stale = copy.deepcopy(self.source); stale['events'] = []
        self.client.objective_sources['EUW1_123'] = stale
        self.app.objective_sources['EUW1_123'] = stale
        (Path(self.tmp.name) / 'EUW1-123.rofl').write_bytes(b'opaque client replay')
        self.timeline_fail = False
        self.summary_fail = False
        self.calls = []

    def tearDown(self):
        self.app.close(); self.tmp.cleanup()

    def request(self, method, route, body=None):
        self.assertEqual(method, 'GET')
        self.calls.append(route)
        if route == '/lol-patch/v1/game-version': return '16.20.1.2'
        if route == '/lol-summoner/v1/current-summoner': return {'puuid': self.own}
        if route.endswith('/games/456') or self.summary_fail and '/games/' in route:
            raise RemoteError(503)
        if route.endswith('/games/123'): return copy.deepcopy(self.game)
        if '/game-timelines/' in route:
            if self.timeline_fail: raise RemoteError(404)
            return copy.deepcopy(self.timeline)
        self.fail(f'Unexpected request: {route}')

    def refresh(self):
        with patch.object(self.client, 'request', side_effect=self.request), \
             patch.object(self.client, 'replay_dir', return_value=Path(self.tmp.name)), \
             patch.object(self.client, 'discover') as discover, \
             patch.object(self.client, 'download') as download:
            result = self.app.refresh_rankings()
        discover.assert_not_called(); download.assert_not_called()
        self.assertFalse(result['running'])
        return result

    def test_forces_fresh_stats_and_objective_api_reads_even_with_complete_caches(self):
        result = self.refresh()
        self.assertEqual(self.calls.count('/lol-match-history/v1/games/123'), 1)
        self.assertEqual(self.calls.count('/lol-match-history/v1/game-timelines/123'), 1)
        item = result['items'][0]
        self.assertNotEqual(item['scores']['carry'], 99)
        self.assertEqual(item['statsSource']['status'], 'ready')
        self.assertEqual(item['objectiveSource'], {'status': 'ready', 'count': 6})
        self.assertEqual(len(self.app.objective_sources['EUW1_123']['events']), 6)
        self.assertTrue(item['downloaded'])
        self.assertIn('Stats-API 1/1, Objective-API 1/1', result['notice'])

    def test_missing_timeline_is_reported_despite_old_source_and_recovers_on_next_refresh(self):
        self.timeline_fail = True
        result = self.refresh()
        self.assertEqual(result['items'][0]['statsSource']['status'], 'ready')
        self.assertEqual(result['items'][0]['objectiveSource']['status'], 'unavailable')
        self.assertNotIn('EUW1_123', self.client.objective_sources)
        self.timeline_fail = False
        result = self.refresh()
        self.assertEqual(result['items'][0]['objectiveSource']['status'], 'ready')
        self.assertEqual(self.calls.count('/lol-match-history/v1/game-timelines/123'), 2)

    def test_one_failed_match_keeps_old_scores_and_other_rows_still_refresh(self):
        second = {**copy.deepcopy(self.old), 'matchId': 'EUW1_456'}
        self.app.ranking_state['items'].append(second)
        result = self.refresh()
        self.assertEqual({row['matchId'] for row in result['items']}, {'EUW1_123', 'EUW1_456'})
        failed = next(row for row in result['items'] if row['matchId'] == 'EUW1_456')
        self.assertEqual(failed['scores'], second['scores'])
        self.assertEqual(failed['statsSource']['status'], 'unavailable')
        self.assertEqual(failed['objectiveSource']['status'], 'unavailable')
        self.assertEqual(result['skipped'], 1)
        self.assertIn('Stats-API 1/2', result['notice'])

    def test_client_unavailable_preserves_list_but_does_not_leave_green_api_flags(self):
        with patch.object(self.client, 'current_version', side_effect=ReplayError('League öffnen und einloggen.')):
            result = self.app.refresh_rankings()
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['scores'], self.old['scores'])
        self.assertEqual(result['items'][0]['statsSource']['status'], 'unavailable')
        self.assertEqual(result['items'][0]['objectiveSource']['status'], 'unavailable')
        self.assertIn('einloggen', result['error'])
        self.assertFalse(result['running'])

    def test_empty_list_does_not_request_api_access_or_discover_matches(self):
        self.app.ranking_state['items'] = []
        with patch.object(self.client, 'request') as request, patch.object(self.client, 'discover') as discover:
            result = self.app.refresh_rankings()
        request.assert_not_called(); discover.assert_not_called()
        self.assertEqual(result['items'], [])
        self.assertIn('Keine Replays', result['notice'])


if __name__ == '__main__':
    unittest.main()
