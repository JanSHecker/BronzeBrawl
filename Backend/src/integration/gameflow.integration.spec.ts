import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceOptions } from '../../ormconfig';
import { GameflowService } from '../gameflow.service';
import { Reward } from '../entities/reward.entity';
import { Event } from '../entities/event.entity';
import { Takedown } from '../entities/takedown.entity';
import { Game } from '../entities/game.entity';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const settings = { punishmentAmount: 7, rewardAmount: 9, defaultCounter: 2, rotationMode: 'Kills' };
const roster = [
  { championName: 'Ahri', riotIdGameName: 'AuditAlice', riotIdTagLine: 'TEST', team: 'ORDER' },
  { championName: 'Lux', riotIdGameName: 'AuditAssist', riotIdTagLine: 'TEST', team: 'ORDER' },
  { championName: 'Garen', riotIdGameName: 'AuditBob', riotIdTagLine: 'TEST', team: 'CHAOS' },
  { championName: 'Jinx', riotIdGameName: 'AuditSpare', riotIdTagLine: 'TEST', team: 'ORDER' },
];
const kill = (id: number, killer = 'AuditAlice#TEST') => ({ EventID: id, EventTime: id, EventName: 'ChampionKill', KillerName: killer, VictimName: 'AuditBob#TEST', Assisters: ['AuditAssist#TEST'] });
const feed = (events: any[] = []) => ({ allPlayers: roster, events: { Events: events }, gameData: { gameTime: 20, mapNumber: 11 } });

(enabled ? describe : describe.skip)('PostgreSQL gameflow transactions (synthetic test fixtures)', () => {
  let database: DataSource;
  let service: GameflowService;
  beforeAll(async () => {
    database = new DataSource(getDataSourceOptions(new ConfigService({ NODE_ENV: 'test', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL })));
    await database.initialize();
    service = new GameflowService(database);
  });
  afterAll(async () => { if (database?.isInitialized) await database.destroy(); });

  async function setup() {
    const game = await service.runGame(settings);
    await service.ingest({ gameId: game.gameId, input: feed() }, game.hostToken);
    const a = await service.createPlayer({ playerName: 'audit-blue', game: game.gameId });
    const b = await service.createPlayer({ playerName: 'audit-red', game: game.gameId });
    const teams = (await service.getTeams(game.gameId)).teams;
    const champions = await service.getAllChampions(game.gameId);
    await service.joinTeam({ player: a.playerId, team: teams[0].teamId }, a.playerToken);
    await service.joinTeam({ player: b.playerId, team: teams[1].teamId }, b.playerToken);
    await service.chooseChampion({ player: a.playerId, champion: champions.blue.find(champion => champion.championName === 'Ahri').championId }, a.playerToken);
    await service.chooseChampion({ player: b.playerId, champion: champions.red.find(champion => champion.championName === 'Garen').championId }, b.playerToken);
    return { game, a, b, champions, teams };
  }

  test('JSONB replay survives a fresh service and retains assists and configured amounts', async () => {
    const { game, a, b, champions } = await setup();
    const input = feed([kill(1)]);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    const restarted = new GameflowService(database);
    await restarted.ingest({ gameId: game.gameId, input }, game.hostToken);
    expect((await restarted.status(a.playerId, a.playerToken))).toMatchObject({ kda: [1, 0, 0], counter: [1, 2], rewards: [{ amount: 9 }] });
    expect((await restarted.status(b.playerId, b.playerToken))).toMatchObject({ kda: [0, 1, 0], punishments: [{ amount: 7 }] });
    expect(await restarted.kda(champions.blue.find(champion => champion.championName === 'Lux').championId)).toEqual([0, 0, 1]);
    const event = await database.getRepository(Event).findOne({ where: { game: { gameId: game.gameId } }, relations: ['takedown', 'takedown.reward', 'takedown.punishment'] });
    expect(event.takedown.reward.amount).toBe(9);
    expect(event.takedown.punishment.amount).toBe(7);
  });

  test('companion connection persists across services, expires and revokes atomically', async () => {
    const game = await service.runGame(settings);
    const connection = await service.connectCompanion({ gameId: game.gameId }, game.hostToken);
    const restarted = new GameflowService(database);
    await restarted.companionHeartbeat({ gameId: game.gameId, availability: 'waiting' }, connection.token);
    expect(await service.companionStatus(game.gameId, game.hostToken)).toMatchObject({ connected: true, feedFresh: false });
    await restarted.ingestCompanion({ gameId: game.gameId, input: feed([kill(1)]) }, connection.token);
    await service.ingestCompanion({ gameId: game.gameId, input: feed([kill(1)]) }, connection.token);
    expect(await database.getRepository(Event).countBy({ game: { gameId: game.gameId } })).toBe(1);
    expect(await service.companionStatus(game.gameId, game.hostToken)).toMatchObject({ connected: true, feedFresh: true });
    await database.getRepository(Game).update(game.gameId, { lastCompanionAt: new Date(Date.now() - 16000) });
    expect(await restarted.companionStatus(game.gameId, game.hostToken)).toMatchObject({ connected: false, feedFresh: false });
    await service.disconnectCompanion({ gameId: game.gameId }, game.hostToken);
    await expect(restarted.ingestCompanion({ gameId: game.gameId, input: feed() }, connection.token)).rejects.toMatchObject({ status: 403 });
    expect(await restarted.companionStatus(game.gameId, game.hostToken)).toMatchObject({ paired: false, connected: false });
  });

  test('independent services serialize snapshots and consume each reward only once', async () => {
    const { game, a, b } = await setup();
    const other = new GameflowService(database);
    await Promise.all([service.ingest({ gameId: game.gameId, input: feed([kill(1)]) }, game.hostToken), other.ingest({ gameId: game.gameId, input: feed([kill(1), kill(2)]) }, game.hostToken)]);
    const status = await service.status(a.playerId, a.playerToken);
    expect(status.counter).toEqual([0, 2]);
    expect(status.rewards).toHaveLength(2);
    const request = { id: status.rewards[0].rewardId, punishment: { recipient: { playerId: b.playerId }, amount: -99 } };
    const results = await Promise.allSettled([service.confirmReward(request, a.playerToken), other.confirmReward(request, a.playerToken)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
    const penalties = (await service.status(b.playerId, b.playerToken)).punishments.filter(item => item.punishmentType === 0);
    expect(penalties).toHaveLength(1);
    expect(penalties[0].amount).toBe(9);
  });

  test('an actual transaction rolls back events, counters and consequences before retry', async () => {
    const { game, a } = await setup();
    const failing = new GameflowService({ options: database.options, manager: {
      transaction: (work: any) => database.transaction(manager => work({
        query: manager.query.bind(manager),
        getRepository: (type: any) => type === Reward ? { save: async () => { throw new Error('injected reward failure'); } } : manager.getRepository(type),
      })),
    } } as any);
    await expect(failing.ingest({ gameId: game.gameId, input: feed([kill(1)]) }, game.hostToken)).rejects.toThrow('injected reward failure');
    expect(await database.getRepository(Event).countBy({ game: { gameId: game.gameId } })).toBe(0);
    expect((await service.status(a.playerId, a.playerToken)).counter).toEqual([2, 2]);
    await service.ingest({ gameId: game.gameId, input: feed([kill(1)]) }, game.hostToken);
    expect((await service.status(a.playerId, a.playerToken)).rewards).toHaveLength(1);
  });

  test('environment death with an unselected lobby player creates no spurious reward', async () => {
    const { game, b } = await setup();
    const lobby = await service.createPlayer({ playerName: 'audit-unselected', game: game.gameId });
    await service.ingest({ gameId: game.gameId, input: feed([kill(1, 'Turret_T200_L0_P3')]) }, game.hostToken);
    expect((await service.status(lobby.playerId, lobby.playerToken)).rewards).toHaveLength(0);
    expect((await service.status(b.playerId, b.playerToken))).toMatchObject({ kda: [0, 1, 0], counter: [2, 1], punishments: [{ amount: 7 }] });
    await service.deletePlayer({ id: lobby.playerId }, lobby.playerToken);
  });

  test('rotation stays owned and atomic against concurrent champion selection', async () => {
    const { game, a, champions, teams } = await setup();
    await service.ingest({ gameId: game.gameId, input: feed([kill(1), kill(2)]) }, game.hostToken);
    const c = await service.createPlayer({ playerName: 'audit-competing', game: game.gameId });
    await service.joinTeam({ player: c.playerId, team: teams[0].teamId }, c.playerToken);
    const target = champions.blue.find(champion => champion.championName === 'Lux').championId;
    const results = await Promise.allSettled([
      service.chooseChampion({ player: a.playerId, champion: target }, a.playerToken),
      new GameflowService(database).chooseChampion({ player: c.playerId, champion: target }, c.playerToken),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
  });
});
