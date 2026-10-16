import 'reflect-metadata';
import { GameflowService } from './gameflow.service';
import { MemoryStore } from './testing/memory-store';
import { Player } from './entities/player.entity';
import { Reward } from './entities/reward.entity';
import { Event } from './entities/event.entity';
import { Takedown } from './entities/takedown.entity';
import { Punishment } from './entities/punishment.entity';
import { ActivityLog } from './entities/activity-log.entity';
import { rewardConfiguration, scaledChoice } from './rewards';
import { TIMELINE_EVENT_BASE } from './game-events';

const roster = [
  { championName: 'Viego', riotIdGameName: 'Owner', riotIdTagLine: 'TEST', team: 'ORDER' },
  { championName: 'Lux', riotIdGameName: 'Friend', riotIdTagLine: 'TEST', team: 'ORDER' },
  { championName: 'Galio', riotIdGameName: 'Enemy', riotIdTagLine: 'TEST', team: 'CHAOS' },
  { championName: 'Ashe', riotIdGameName: 'Other', riotIdTagLine: 'TEST', team: 'CHAOS' },
];
const feed = (events: any[] = [], time = 30, replayTimeline?: any) => ({ allPlayers: structuredClone(roster), events: { Events: events }, gameData: { gameTime: time, mapNumber: 11 }, ...(replayTimeline ? { replayTimeline } : {}) });
const kill = (id: number, time = 10 + id, killer = 'Owner#TEST', victim = 'Enemy#TEST') => ({ EventID: id, EventName: 'ChampionKill', EventTime: time, KillerName: killer, VictimName: victim, Assisters: [] });
const objective = (id: number, name = 'HordeKill', killer = 'Owner#TEST') => ({ EventID: id, EventName: name, EventTime: id + 10, KillerName: killer });
let db: MemoryStore, service: GameflowService, game: any, owner: any, friend: any, enemies: any[], champions: any;

async function setup(difficulty = 'baseline', timeline?: any) {
  db = new MemoryStore(); service = new GameflowService(db as any);
  game = await service.runGame({ rewardAmount: 2, punishmentAmount: 2, difficulty });
  await service.ingest({ gameId: game.gameId, input: feed([], 10, timeline) }, game.hostToken);
  const teams = (await service.getTeams(game.gameId)).teams;
  const players = [];
  for (const [index, entry] of roster.entries()) {
    const player = await service.createPlayer({ playerName: `Player ${index}`, gameCode: game.gameCode });
    await service.joinTeam({ player: player.playerId, team: teams[entry.team === 'ORDER' ? 0 : 1].teamId }, player.playerToken);
    players.push(player);
  }
  [owner, friend, ...enemies] = players;
  champions = await service.getAllChampions(game.gameId);
  await service.chooseChampion({ player: owner.playerId, champion: champions.blue[0].championId }, owner.playerToken);
  await service.chooseChampion({ player: enemies[0].playerId, champion: champions.red[0].championId }, enemies[0].playerToken);
}
const ingest = (input: any) => service.ingest({ gameId: game.gameId, input }, game.hostToken);
const owned = (player = owner) => db.all(Reward).filter(row => row.player.playerId === player.playerId);

test('kills 3–7 replace the normal chest with epic and 8+ with legendary; replay/restart does not duplicate', async () => {
  await setup();
  const input = feed(Array.from({ length: 9 }, (_, i) => kill(i + 1)));
  await ingest(input);
  expect(owned().map(row => row.chestType)).toEqual(['standard', 'standard', 'epic', 'epic', 'epic', 'epic', 'epic', 'legendary', 'legendary']);
  service = new GameflowService(db as any);
  await ingest(input);
  expect(owned()).toHaveLength(9);
  expect(db.all(ActivityLog).filter(row => row.type === 'champion_killed').map(row => row.data.killstreak)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('credited deaths reset sprees, executions do not, and unowned kills still count', async () => {
  await setup();
  await ingest(feed([kill(1), kill(2), kill(3, 13, 'Turret_TChaos_L0', 'Owner#TEST'), kill(4)]));
  expect(owned().map(row => row.chestType)).toEqual(['standard', 'standard', 'epic']);
  await ingest(feed([kill(1), kill(2), kill(3, 13, 'Turret_TChaos_L0', 'Owner#TEST'), kill(4), kill(5, 15, 'Enemy#TEST', 'Owner#TEST'), kill(6)]));
  expect(owned().at(-1).chestType).toBe('standard');
});

test('sprees follow the LoL participant across expiry and a new BronzeBrawl owner', async () => {
  await setup();
  const events = [kill(1), kill(2), kill(3)];
  await ingest(feed(events));
  await ingest(feed(events, 190));
  await service.chooseChampion({ player: friend.playerId, champion: champions.blue[0].championId }, friend.playerToken);
  await ingest(feed([...events, kill(4, 191)], 191));
  expect(owned(friend).map(row => row.chestType)).toEqual(['epic']);
});

test('each multikill tier grants its extra chest once, alongside streak replacements', async () => {
  await setup();
  let id = 0;
  const events: any[] = [];
  for (let count = 1; count <= 5; count++) {
    events.push(kill(++id, 10 + count));
    if (count > 1) events.push({ EventID: ++id, EventName: 'Multikill', EventTime: 10 + count, KillerName: 'Owner#TEST', KillStreak: count });
  }
  await ingest(feed(events));
  expect(owned().map(row => row.chestType)).toEqual(['standard', 'standard', 'standard', 'epic', 'epic', 'epic', 'legendary', 'epic', 'pentakill']);
  expect(db.all(Takedown).map(row => row.multiKill)).toEqual([1, 2, 3, 4, 5]);
  service = new GameflowService(db as any);
  const duplicated = { ...events.at(-1), EventID: ++id };
  await ingest(feed([...events, duplicated]));
  expect(owned()).toHaveLength(9);
  expect(db.all(ActivityLog).filter(row => row.type === 'multikill')).toHaveLength(4);
  await expect(ingest(feed([{ ...duplicated, EventID: ++id, KillStreak: 6 }]))).rejects.toMatchObject({ status: 400 });
});

test('grubs wait for all three and reward only the majority team, including championless teammates', async () => {
  await setup();
  const events = [objective(1), objective(2, 'VoidGrubKill', 'Enemy#TEST'), objective(3)];
  await ingest(feed(events.slice(0, 2)));
  expect(db.all(Reward)).toHaveLength(0);
  service = new GameflowService(db as any);
  await ingest(feed(events));
  expect(owned().map(row => row.chestType)).toEqual(['epic']);
  expect(owned(friend).map(row => row.chestType)).toEqual(['epic']);
  expect(owned(enemies[0])).toHaveLength(0);
  await ingest(feed(events));
  expect(db.all(Reward)).toHaveLength(2);
  expect(db.all(ActivityLog).find(row => row.type === 'objective_captured').data).toMatchObject({ objective: 'Grubs', winningTeam: 0, grubScore: [2, 1] });
});

test('timeline objectives merge chronologically, avoid raw duplicates, and precede GameEnd', async () => {
  const source = { matchId: 'EUW1_123', events: [] };
  await setup('baseline', source);
  const extra = { SourceEventIndex: 0, EventName: 'DragonKill', EventTime: 12, KillerName: 'Owner#TEST', KillerTeam: 100, DragonType: 'Earth' };
  const input = feed([{ ...objective(1, 'DragonKill'), DragonType: 'Earth' }, { EventID: 2, EventName: 'GameEnd', EventTime: 20 }], 20, { ...source, events: [extra] });
  await ingest(input);
  expect(owned().map(row => row.chestType)).toEqual(['epic']);
  expect(db.all(Event).filter(row => row.eventType === 'DragonKill')).toHaveLength(1);
  expect(db.all(Event).find(row => row.eventType === 'DragonKill').ingameId).toBe(TIMELINE_EVENT_BASE);
  await ingest(input);
  expect(owned()).toHaveLength(1);
});

test('future, reused, mismatched, and changed timeline sources are rejected atomically', async () => {
  const source = { matchId: 'EUW1_123', events: [] };
  await setup('baseline', source);
  const extra = { SourceEventIndex: 0, EventName: 'BaronKill', EventTime: 12, KillerName: 'Owner#TEST', KillerTeam: 100 };
  for (const changed of [{ ...extra, EventTime: 31 }, { ...extra, KillerTeam: 200 }, { ...extra, SourceEventIndex: -1 }]) {
    await expect(ingest(feed([], 30, { ...source, events: [changed] }))).rejects.toMatchObject({ status: 400 });
    expect(db.all(Reward)).toHaveLength(0);
  }
  await ingest(feed([], 30, { ...source, events: [extra] }));
  await expect(ingest(feed([], 30, { ...source, events: [{ ...extra, EventName: 'HeraldKill' }] }))).rejects.toMatchObject({ status: 409 });
  await expect(ingest(feed([], 30, { matchId: 'EUW1_456', events: [extra] }))).rejects.toMatchObject({ status: 409 });
  await expect(ingest(feed())).rejects.toMatchObject({ status: 409 });
});

test('Viego possession preserves his champion identity; real roster changes still conflict', async () => {
  await setup();
  const input = feed([kill(1)]);
  input.allPlayers[0] = { ...input.allPlayers[0], championName: 'Galio', rawSkinName: 'game_character_displayname_Viego' } as any;
  await ingest(input);
  expect((await service.status(owner.playerId, owner.playerToken)).champion.championName).toBe('Viego');
  delete (input.allPlayers[0] as any).rawSkinName;
  await expect(ingest(input)).rejects.toMatchObject({ status: 409 });
});

test.each(['Turret_TOrder_L0_P3_123_0', 'Turret_T100_L0_P3', 'Turret_T1_L_03_A'])('minion last-hit %s rewards the opposing team', async tower => {
  await setup();
  await ingest(feed([{ EventID: 1, EventName: 'TurretKilled', EventTime: 11, KillerName: 'Minion_T200', TurretKilled: tower }]));
  expect(owned()).toHaveLength(0);
  expect(owned(enemies[0])[0].chestType).toBe('standard');
});

test.each(['easy', 'baseline', 'hard', 'terror'])('Pentakill has one fixed offer, scaled at %s, breaks enemies only, and cannot replay', async difficulty => {
  await setup(difficulty);
  for (const player of db.all(Player)) player.shield = 100;
  const row = await db.save(Reward, { player: db.all(Player)[0], amount: 2, chestType: 'pentakill', distributed: false, choices: [] });
  const opened = await service.openChest({ id: row.rewardId }, owner.playerToken);
  const expected = scaledChoice(rewardConfiguration({}).pools.pentakill[0], difficulty as any, rewardConfiguration({}));
  expect(opened.choices).toHaveLength(1);
  expect(opened.choices[0]).toMatchObject(expected);
  const request = { id: row.rewardId, choiceId: 'pentakill' };
  await Promise.all([service.chooseReward(request, owner.playerToken), service.chooseReward(request, owner.playerToken)]);
  const shield = (id: number) => db.all(Player).find(player => player.playerId === id).shield;
  expect(shield(owner.playerId)).toBe(10);
  expect(shield(friend.playerId)).toBe(100);
  for (const enemy of enemies) {
    expect(shield(enemy.playerId)).toBe(0);
    for (const unit of ['sips', 'shots', 'chugs']) {
      expect(db.all(Punishment).filter(p => p.player.playerId === enemy.playerId && p.unit === unit).reduce((sum, p) => sum + p.amount, 0)).toBe(expected.amounts[unit]);
    }
  }
  expect(db.all(Punishment).some(p => [owner.playerId, friend.playerId].includes(p.player.playerId))).toBe(false);
});

test('Pentakill failure rolls back the grant and every enemy shield/punishment', async () => {
  await setup();
  for (const player of db.all(Player)) player.shield = 100;
  const row = await db.save(Reward, { player: db.all(Player)[0], amount: 2, chestType: 'pentakill', distributed: false, choices: [] });
  await service.openChest({ id: row.rewardId }, owner.playerToken);
  db.failOn = Punishment;
  await expect(service.chooseReward({ id: row.rewardId, choiceId: 'pentakill' }, owner.playerToken)).rejects.toThrow('injected');
  expect(db.all(Player).every(p => p.shield === 100)).toBe(true);
  expect(db.all(Punishment)).toHaveLength(0);
  expect(db.all(Reward)[0].distribution).toBeUndefined();
});
