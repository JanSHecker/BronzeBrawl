"""Synthetic LCU timelines and Live API snapshots; no production credentials/network."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion import App
from network import RemoteError
from replay import LCU, ReplayError
from timeline import base_champion, build_source, enrich_snapshot, matches_source, valid_source
from test_companion import DirectNetwork, connection_code


def fixture():
    game = {'gameId': 123, 'platformId': 'EUW1', 'mapId': 11, 'gameDuration': 90,
            'participants': [{'participantId': i, 'teamId': 100 if i <= 5 else 200} for i in range(1, 11)],
            'participantIdentities': [{'participantId': i, 'player': {'gameName': f'Player{i}', 'tagLine': 'TEST', 'puuid': 'private-not-cached'}} for i in range(1, 11)],
            'teams': [{'teamId': 100, 'dragonKills': 1, 'baronKills': 1, 'riftHeraldKills': 1}, {'teamId': 200, 'dragonKills': 0, 'baronKills': 0, 'riftHeraldKills': 0}]}
    events = [{'type': 'CHAMPION_KILL', 'timestamp': 10123, 'killerId': 1, 'victimId': 7}]
    for at, monster, killer in ((20000, 'HORDE', 1), (21000, 'HORDE', 7), (23000, 'HORDE', 1),
                                (30000, 'DRAGON', 1), (50000, 'RIFTHERALD', 1), (70000, 'BARON_NASHOR', 1)):
        events.append({'type': 'ELITE_MONSTER_KILL', 'timestamp': at, 'killerId': killer, 'monsterType': monster,
                       'monsterSubType': 'ELDER_DRAGON' if monster == 'DRAGON' else ''})
    timeline = {'frames': [{'timestamp': 0, 'events': []}, {'timestamp': 60000, 'events': events[:-1]}, {'timestamp': 90000, 'events': events[-1:]}]}
    data = {'allPlayers': [{'riotId': f'Player{i}#TEST', 'riotIdGameName': f'Player{i}', 'riotIdTagLine': 'TEST',
                           'championName': 'Viego' if i == 1 else f'Champion{i}', 'team': 'ORDER' if i <= 5 else 'CHAOS'} for i in range(1, 11)],
            'gameData': {'gameTime': 33, 'mapNumber': 11, 'gameMode': 'CLASSIC'},
            'events': {'Events': [{'EventID': 1, 'EventName': 'ChampionKill', 'EventTime': 10.2, 'KillerName': 'Player1#TEST', 'VictimName': 'Player7#TEST'}]}}
    return game, timeline, data


class TimelineTests(unittest.TestCase):
    def setUp(self):
        self.game, self.timeline, self.data = fixture()
        self.source = build_source('EUW1_123', self.game, self.timeline)

    def test_complete_source_has_exact_times_teams_and_types_without_credentials(self):
        self.assertTrue(valid_source(self.source))
        self.assertEqual([e['EventName'] for e in self.source['events']], ['HordeKill'] * 3 + ['DragonKill', 'HeraldKill', 'BaronKill'])
        self.assertEqual(self.source['events'][1]['KillerTeam'], 200)
        self.assertEqual(self.source['events'][3]['DragonType'], 'Elder')
        self.assertEqual(self.source['events'][3]['EventTime'], 30)
        self.assertNotIn('puuid', json.dumps(self.source))
        self.assertNotIn('private-not-cached', json.dumps(self.source))

    def test_enrichment_is_due_only_repeatable_and_does_not_mutate_raw_data(self):
        before = copy.deepcopy(self.data)
        result = enrich_snapshot(self.source, self.data)
        self.assertEqual(len(result['replayTimeline']['events']), 4)
        self.assertEqual(result['replayTimeline']['matchId'], 'EUW1_123')
        self.assertEqual(result, enrich_snapshot(self.source, self.data))
        self.assertEqual(self.data, before)
        self.data['gameData']['gameTime'] = 19
        self.assertEqual(enrich_snapshot(self.source, self.data)['replayTimeline']['events'], [])
        self.data['gameData']['gameTime'] = 90
        self.assertEqual(len(enrich_snapshot(self.source, self.data)['replayTimeline']['events']), 6)

    def test_roster_team_and_kill_anchors_prevent_cross_match_injection(self):
        self.assertTrue(matches_source(self.source, self.data))
        for change in ('identity', 'team', 'time', 'killer', 'victim'):
            data = copy.deepcopy(self.data)
            if change == 'identity': data['allPlayers'][0]['riotId'] = 'Wrong#TEST'
            if change == 'team': data['allPlayers'][0]['team'] = 'CHAOS'
            if change == 'time': data['events']['Events'][0]['EventTime'] = 9
            if change == 'killer': data['events']['Events'][0]['KillerName'] = 'Player2#TEST'
            if change == 'victim': data['events']['Events'][0]['VictimName'] = 'Player8#TEST'
            with self.subTest(change=change):
                self.assertFalse(matches_source(self.source, data))
                with self.assertRaises(ValueError): enrich_snapshot(self.source, data)

    def test_incomplete_wrong_or_summary_inconsistent_timelines_are_not_available(self):
        for change in ('match', 'empty', 'frames', 'events', 'killer', 'counter', 'duplicate'):
            game, timeline, _ = fixture()
            if change == 'match': game['gameId'] = 456
            if change == 'empty': timeline = None
            if change == 'frames': timeline['frames'] = []
            if change == 'events': del timeline['frames'][1]['events']
            if change == 'killer': timeline['frames'][1]['events'][1]['killerId'] = 0
            if change == 'counter': game['teams'][0]['dragonKills'] = 2
            if change == 'duplicate': game['participantIdentities'][1] = game['participantIdentities'][0]
            with self.subTest(change=change), self.assertRaises((ValueError, TypeError)):
                build_source('EUW1_123', game, timeline)

    def test_cached_source_validation_rejects_corruption_and_invalid_event_ids(self):
        for value in (None, {}, {'version': 1}, {**self.source, 'events': [{'SourceEventIndex': -1}]}):
            self.assertFalse(valid_source(value))

    def test_viego_skin_identity_survives_possession_including_skinned_forms(self):
        for skin in ('game_character_displayname_Viego', 'game_character_skin_displayname_Viego_Skin01'):
            self.assertEqual(base_champion({'championName': 'Galio', 'rawSkinName': skin}), 'Viego')
        self.assertEqual(base_champion({'championName': 'Galio'}), 'Galio')


class CompanionObjectiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.net = DirectNetwork()
        self.app = App(self.tmp.name, self.net)
        self.game, self.timeline, self.data = fixture()
        self.source = build_source('EUW1_123', self.game, self.timeline)

    def tearDown(self):
        self.app.close(); self.tmp.cleanup()

    def test_list_check_caches_a_real_source_and_reports_missing_independently(self):
        self.app.ranking_state['items'] = [{'matchId': 'EUW1_123'}]
        self.app.lcu = LCU(None)
        with patch.object(self.app.lcu, 'request', side_effect=[self.game, self.timeline]) as request:
            self.assertEqual(self.app.check_replay_source('EUW1_123'), {'status': 'ready', 'count': 6})
            self.assertEqual(request.call_count, 2)
        self.assertEqual(self.app.ranking_state['items'][0]['objectiveSource']['status'], 'ready')
        self.assertTrue((Path(self.tmp.name) / 'timeline-sources' / 'EUW1_123.json').exists())
        with patch.object(self.app.lcu, 'request') as request:
            self.app.check_replay_source('EUW1_123')
            request.assert_not_called()
        with patch.object(self.app.lcu, 'request', side_effect=RemoteError(404)):
            self.assertEqual(self.app.check_replay_source('EUW1_456')['status'], 'unavailable')
        self.assertFalse(self.net.calls)

    def test_actual_feed_enriches_only_outbound_data_and_restores_selected_source(self):
        self.app.objective_sources['EUW1_123'] = self.source
        self.net.data = self.data
        self.app.connect_code(connection_code())
        self.app.feed_tick(); self.app.feed_tick()
        posts = [call for call in self.net.calls if call[1].endswith('/companion/input')]
        self.assertEqual(len(posts), 2)
        self.assertEqual(len(posts[0][3]['input']['replayTimeline']['events']), 4)
        captures = sorted(self.app.recording.directory.glob('snapshot-*.json'))
        self.assertEqual(len(captures), 2)
        self.assertEqual(json.loads(captures[0].read_text()), self.data)
        self.assertNotIn('replayTimeline', self.data)
        directory = Path(self.tmp.name) / 'timeline-sources'; directory.mkdir()
        (directory / 'EUW1_123.json').write_text(json.dumps(self.source))
        (Path(self.tmp.name) / 'active-replay.json').write_text(json.dumps({'matchId': 'EUW1_123'}))
        restored = App(self.tmp.name, self.net)
        try:
            restored.feed_tick()
            self.assertEqual(restored.active_replay, 'EUW1_123')
            self.assertEqual(self.net.calls[-1][3]['input']['replayTimeline']['matchId'], 'EUW1_123')
        finally: restored.close()

    def test_explicit_replay_does_not_use_another_matches_source_and_ambiguous_auto_match_is_blocked(self):
        self.app.objective_sources['EUW1_123'] = self.source
        self.app.active_replay = 'EUW1_456'
        self.assertNotIn('replayTimeline', self.app.game_input(self.data))
        self.app.active_replay = None
        self.app.objective_sources['EUW1_456'] = {**self.source, 'matchId': 'EUW1_456'}
        with self.assertRaises(ReplayError): self.app.game_input(self.data)

    def test_viego_possession_does_not_stop_direct_feed(self):
        self.net.data = self.data
        self.app.connect_code(connection_code())
        self.app.feed_tick()
        self.net.data = copy.deepcopy(self.data)
        self.net.data['allPlayers'][0].update(championName='Galio', rawSkinName='game_character_displayname_Viego')
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 2)
        self.assertEqual(self.app.feed['availability'], 'live')

    def test_wrong_selected_source_reports_a_retryable_error_without_killing_sender(self):
        self.app.active_replay = 'EUW1_123'
        self.app.objective_sources['EUW1_123'] = self.source
        self.app.connect_code(connection_code())
        self.assertGreater(self.app.feed_tick(), 3)
        self.assertTrue(self.app.feed['enabled'])
        self.assertIn('ausgewählten Replay', self.app.feed['error'])
        self.assertFalse(any(call[1].endswith('/companion/input') for call in self.net.calls))
        self.net.data = self.data
        self.app.feed_tick()
        self.assertEqual(self.app.feed['sent'], 1)
        self.assertIsNone(self.app.feed['error'])

    def test_connecting_a_new_game_clears_a_stale_replay_selection_but_keeps_sources(self):
        self.app.connect_code(connection_code())
        self.app.active_replay = 'EUW1_123'
        self.app.objective_sources['EUW1_123'] = self.source
        self.app.connect_code(connection_code(game_id=9))
        self.assertIsNone(self.app.active_replay)
        self.assertIn('EUW1_123', self.app.objective_sources)


if __name__ == '__main__':
    unittest.main()
