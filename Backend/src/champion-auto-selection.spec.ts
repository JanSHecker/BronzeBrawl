import 'reflect-metadata';
import { GameflowService } from './gameflow.service';
import { Player } from './entities/player.entity';
import { Champion } from './entities/champion.entity';
import { Reward } from './entities/reward.entity';
import { ActivityLog } from './entities/activity-log.entity';
import { MemoryStore } from './testing/memory-store';
import { rewardConfiguration, scaledChoice } from './rewards';

const roster = [
  ...['Ahri', 'Lux', 'Annie'].map(championName => ({ championName, riotIdGameName: championName, team: 'ORDER' })),
  { championName: 'Garen', riotIdGameName: 'Garen', team: 'CHAOS' },
];
const feed = (time: number, events = []) => ({ allPlayers: roster, events: { Events: events }, gameData: { gameTime: time } });
let db: MemoryStore, service: GameflowService, game: any, owner: any, teams: any[], blue: any[];
const ingest = (time: number, events = []) => service.ingest({ gameId: game.gameId, input: feed(time, events) }, game.hostToken);
const status = () => service.status(owner.playerId, owner.playerToken);
const storedPlayer = (player = owner) => db.all(Player).find(row => row.playerId === player.playerId);
async function teammate(index: number) {
  const player = await service.createPlayer({ playerName: `Teammate ${index}`, gameCode: game.gameCode });
  await service.joinTeam({ player: player.playerId, team: teams[0].teamId }, player.playerToken);
  await service.chooseChampion({ player: player.playerId, champion: blue[index].championId }, player.playerToken);
  return player;
}
async function rewardSwitch(id = 'champions-sacrifice') {
  const enemy = await service.createPlayer({ playerName: 'Enemy', gameCode: game.gameCode });
  await service.joinTeam({ player: enemy.playerId, team: teams[1].teamId }, enemy.playerToken);
  const config = rewardConfiguration({});
  const choice = scaledChoice(config.pools.standard.find(row => row.id === id), 'baseline', config);
  const reward = await db.save(Reward, { player: storedPlayer(), amount: 2, chestType: 'standard',
    openedAt: new Date(), choices: [choice], distributed: false });
  await service.chooseReward({ id: reward.rewardId, choiceId: id }, owner.playerToken);
}
beforeEach(async () => {
  db = new MemoryStore();
  service = new GameflowService(db as any);
  game = await service.runGame({ punishmentAmount: 2, rewardAmount: 2 });
  await ingest(10);
  teams = (await service.getTeams(game.gameId)).teams;
  blue = (await service.getAllChampions(game.gameId)).blue;
  owner = await service.createPlayer({ playerName: 'Owner', gameCode: game.gameCode });
  await service.joinTeam({ player: owner.playerId, team: teams[0].teamId }, owner.playerToken);
  await service.chooseChampion({ player: owner.playerId, champion: blue[0].championId }, owner.playerToken);
});
afterEach(() => jest.restoreAllMocks());

test('expiry starts a persisted thirty-second countdown and automatically selects a different teammate champion at the boundary', async () => {
  await ingest(190);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 30 });
  expect(storedPlayer().championSelectionEndsAtGameTime).toBe(220);
  await ingest(219.5);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 0.5 });
  jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(0);
  await ingest(220);
  expect(await status()).toMatchObject({ champion: { championId: blue[1].championId }, rotationRemainingSeconds: 180,
    rotationAvailable: false, championSelectionRemainingSeconds: null });
  expect(storedPlayer().championSelectionEndsAtGameTime).toBeNull();
  expect(db.all(ActivityLog).filter(row => row.data.automatic)).toMatchObject([
    { type: 'champion_rotated', gameTime: 220, data: { previousChampion: { championId: blue[0].championId } } },
  ]);
});

test('late snapshots use the real expiry rather than granting an extra thirty seconds', async () => {
  await ingest(219);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 1 });
  await ingest(225);
  expect((await status()).rotationRemainingSeconds).toBe(180);
  expect(storedPlayer().champion.rotationEndsAtGameTime).toBe(405);
});

test('a snapshot arriving after both deadlines releases and assigns atomically', async () => {
  await ingest(250);
  expect((await status()).champion.championId).not.toBe(blue[0].championId);
  expect(db.all(ActivityLog).filter(row => row.data.automatic)).toHaveLength(1);
});

test('restarts, duplicate feeds, pauses, and wall-clock time do not reset or advance the countdown', async () => {
  await ingest(190);
  service = new GameflowService(db as any);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 300_000);
  await ingest(190);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 30 });
  await ingest(220);
  const selected = (await status()).champion.championId;
  service = new GameflowService(db as any);
  await ingest(220);
  expect((await status()).champion.championId).toBe(selected);
  expect(db.all(ActivityLog).filter(row => row.data.automatic)).toHaveLength(1);
});

test('manual selection cancels the pending automatic assignment', async () => {
  await ingest(200);
  await service.chooseChampion({ player: owner.playerId, champion: blue[1].championId }, owner.playerToken);
  await ingest(220);
  expect(await status()).toMatchObject({ champion: { championId: blue[1].championId }, rotationRemainingSeconds: 160,
    championSelectionRemainingSeconds: null });
  expect(db.all(ActivityLog).some(row => row.data.automatic)).toBe(false);
});

test.each(['champions-sacrifice', 'burning-bright'])('%s starts the grace period when its switch takes effect', async id => {
  await ingest(150);
  await rewardSwitch(id);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 30 });
  await ingest(179);
  expect((await status()).championSelectionRemainingSeconds).toBe(1);
  await ingest(180);
  expect((await status()).champion).not.toBeNull();
});

test('a reward that only shortens an active timer does not start selection early', async () => {
  await rewardSwitch('burning-bright');
  expect(await status()).toMatchObject({ rotationRemainingSeconds: 120, championSelectionRemainingSeconds: null });
  await ingest(130);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 30 });
});

test('initial selection is never automatically assigned', async () => {
  const newcomer = await service.createPlayer({ playerName: 'Newcomer', gameCode: game.gameCode });
  await service.joinTeam({ player: newcomer.playerId, team: teams[0].teamId }, newcomer.playerToken);
  await ingest(300);
  expect(await service.status(newcomer.playerId, newcomer.playerToken)).toMatchObject({ champion: null,
    championSelectionRemainingSeconds: null });
});

test('occupied, previous, and opposing champions are excluded; expired waits retry when a slot opens', async () => {
  const first = await teammate(1);
  const second = await teammate(2);
  storedPlayer(first).champion.rotationEndsAtGameTime = 230;
  storedPlayer(second).champion.rotationEndsAtGameTime = 300;
  await ingest(220);
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 0 });
  await ingest(230);
  expect((await status()).champion.championId).toBe(blue[1].championId);
  expect(storedPlayer(first).champion).toBeNull();
  expect(storedPlayer(second).champion.championId).toBe(blue[2].championId);
});

test('simultaneous expirations release all slots first and assignments never overlap', async () => {
  await teammate(1);
  await teammate(2);
  jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(0);
  await ingest(220);
  const players = db.all(Player);
  expect(new Set(players.map(row => row.champion.championId)).size).toBe(3);
  for (const player of players) {
    expect(player.champion.championId).not.toBe(player.previousChampionId);
    expect(player.champion.rotationEndsAtGameTime).toBe(400);
  }
});

test.each([true, false])('manual and automatic selection races remain exclusive (feed first: %s)', async feedFirst => {
  await ingest(219);
  const manual = () => service.chooseChampion({ player: owner.playerId, champion: blue[1].championId }, owner.playerToken);
  const results = await Promise.allSettled(feedFirst ? [ingest(220), manual()] : [manual(), ingest(220)]);
  expect(results[feedFirst ? 0 : 1].status).toBe('fulfilled');
  expect(db.all(Champion).filter(row => row.player?.playerId === owner.playerId)).toHaveLength(1);
  expect((await status()).rotationRemainingSeconds).toBeGreaterThan(0);
});

test('an assignment failure rolls back ownership, activity and the pending deadline together', async () => {
  await ingest(219);
  db.failOn = ActivityLog;
  await expect(ingest(220)).rejects.toThrow('injected');
  expect(await status()).toMatchObject({ champion: null, championSelectionRemainingSeconds: 1 });
  expect(db.all(ActivityLog).some(row => row.data.automatic)).toBe(false);
  await ingest(220);
  expect((await status()).champion).not.toBeNull();
});

test('GameEnd suppresses pending assignments and hides the countdown', async () => {
  await ingest(190);
  await ingest(220, [{ EventID: 1, EventName: 'GameEnd', EventTime: 220 }]);
  expect(await status()).toMatchObject({ champion: null, gameState: 'ended', championSelectionRemainingSeconds: null });
  expect(db.all(ActivityLog).some(row => row.data.automatic)).toBe(false);
});
