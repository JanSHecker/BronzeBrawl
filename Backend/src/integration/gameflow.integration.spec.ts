import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceOptions } from '../../ormconfig';
import { GameflowService } from '../gameflow.service';
import { Reward } from '../entities/reward.entity';
import { Event } from '../entities/event.entity';
import { Takedown } from '../entities/takedown.entity';
import { Game } from '../entities/game.entity';
import { Champion } from '../entities/champion.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { TimeOnlyRotation1792400000000 } from '../../migrations/1792400000000-TimeOnlyRotation';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const settings = { punishmentAmount: 7, rewardAmount: 9 };
const roster = [
  { championName: 'Ahri', riotIdGameName: 'AuditAlice', riotIdTagLine: 'TEST', team: 'ORDER' },
  { championName: 'Lux', riotIdGameName: 'AuditAssist', riotIdTagLine: 'TEST', team: 'ORDER' },
  { championName: 'Garen', riotIdGameName: 'AuditBob', riotIdTagLine: 'TEST', team: 'CHAOS' },
  { championName: 'Jinx', riotIdGameName: 'AuditSpare', riotIdTagLine: 'TEST', team: 'ORDER' },
];
const kill = (id: number, killer = 'AuditAlice#TEST') => ({ EventID: id, EventTime: id, EventName: 'ChampionKill', KillerName: killer, VictimName: 'AuditBob#TEST', Assisters: ['AuditAssist#TEST'] });
const feed = (events: any[] = [], time = 20) => ({ allPlayers: roster, events: { Events: events }, gameData: { gameTime: time, mapNumber: 11 } });

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
    const a = await service.createPlayer({ playerName: 'audit-blue', gameCode: game.gameCode });
    const b = await service.createPlayer({ playerName: 'audit-red', gameCode: game.gameCode });
    const teams = (await service.getTeams(game.gameId)).teams;
    const champions = await service.getAllChampions(game.gameId);
    await service.joinTeam({ player: a.playerId, team: teams[0].teamId }, a.playerToken);
    await service.joinTeam({ player: b.playerId, team: teams[1].teamId }, b.playerToken);
    await service.chooseChampion({ player: a.playerId, champion: champions.blue.find(champion => champion.championName === 'Ahri').championId }, a.playerToken);
    await service.chooseChampion({ player: b.playerId, champion: champions.red.find(champion => champion.championName === 'Garen').championId }, b.playerToken);
    return { game, a, b, champions, teams };
  }

  test('four-letter codes are unique across services and enforced by PostgreSQL', async () => {
    const other = new GameflowService(database);
    const [first, second] = await Promise.all([service.runGame(settings), other.runGame(settings)]);
    expect(first.gameCode).toMatch(/^[A-Z]{4}$/);
    expect(second.gameCode).toMatch(/^[A-Z]{4}$/);
    expect(first.gameCode).not.toBe(second.gameCode);
    await expect(database.getRepository(Game).update(second.gameId, { gameCode: first.gameCode }))
      .rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(database.getRepository(Game).update(second.gameId, { gameCode: '1234' }))
      .rejects.toMatchObject({ driverError: { code: '23514' } });

    const restarted = new GameflowService(database);
    expect(await restarted.getSettingsByCode(` ${first.gameCode.toLowerCase()} `)).toMatchObject({ gameId: first.gameId });
    const player = await restarted.createPlayer({ playerName: 'audit-code-join', gameCode: first.gameCode });
    expect(player.game).toBe(first.gameId);
    await database.getRepository(Game).update(first.gameId, { state: 'ended' });
    await expect(restarted.createPlayer({ playerName: 'audit-code-late', gameCode: first.gameCode }))
      .rejects.toMatchObject({ status: 409 });
    // Finished-game codes stay reserved, so an old link never targets a new round.
    expect((await database.getRepository(Game).findOneBy({ gameId: first.gameId })).gameCode).toBe(first.gameCode);
  });

  test('JSONB replay survives a fresh service and retains assists and configured amounts', async () => {
    const { game, a, b, champions } = await setup();
    const input = feed([kill(1)]);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    const restarted = new GameflowService(database);
    await restarted.ingest({ gameId: game.gameId, input }, game.hostToken);
    expect((await restarted.status(a.playerId, a.playerToken))).toMatchObject({ kda: [1, 0, 0], rotationRemainingSeconds: 180, rewards: [{ amount: 9 }] });
    expect((await restarted.status(b.playerId, b.playerToken))).toMatchObject({ kda: [0, 1, 0], punishments: [{ amount: 7 }] });
    expect(await restarted.kda(champions.blue.find(champion => champion.championName === 'Lux').championId)).toEqual([0, 0, 1]);
    const event = await database.getRepository(Event).findOne({ where: { game: { gameId: game.gameId } }, relations: ['takedown', 'takedown.reward', 'takedown.punishment'] });
    expect(event.takedown.reward.amount).toBe(9);
    expect(event.takedown.punishment.amount).toBe(7);
    const history = await restarted.getActivity({ gameId: game.gameId }, { hostToken: game.hostToken });
    expect(history.items.filter(item => item.type === 'champion_killed')).toHaveLength(1);
    expect(history.items.find(item => item.type === 'champion_killed')).toMatchObject({
      gameTime: 1, data: { killer: { championName: 'Ahri', player: { playerName: 'audit-blue' } } },
    });
    const first = await restarted.getActivity({ gameId: game.gameId, limit: 2 }, { hostToken: game.hostToken });
    const older = await restarted.getActivity({ gameId: game.gameId, before: first.nextCursor, limit: 2 }, { hostToken: game.hostToken });
    expect(older.items[0].activityId).toBeLessThan(first.items[1].activityId);
    const newer = await restarted.getActivity({ gameId: game.gameId, after: older.items[0].activityId }, { hostToken: game.hostToken });
    expect(newer.items.map(item => item.activityId)).toEqual(first.items.map(item => item.activityId).reverse());
  });

  test('champion timers persist in PostgreSQL, honor adjusted deadlines and reset on takeover', async () => {
    const { game, a, b, champions } = await setup();
    const ahri = champions.blue.find(champion => champion.championName === 'Ahri').championId;
    const lux = champions.blue.find(champion => champion.championName === 'Lux').championId;
    const restarted = new GameflowService(database);
    expect(await restarted.status(a.playerId, a.playerToken)).toMatchObject({
      rotationRemainingSeconds: 180, rotationAvailable: false, champion: { rotationEndsAtGameTime: 200 },
    });
    await database.getRepository(Champion).update(ahri, { rotationEndsAtGameTime: 220.5 });
    expect(await restarted.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 200.5 });
    expect(await restarted.status(b.playerId, b.playerToken)).toMatchObject({ rotationRemainingSeconds: 180 });
    await restarted.ingest({ gameId: game.gameId, input: { ...feed(), gameData: { gameTime: 220.5, mapNumber: 11 } } }, game.hostToken);
    expect(await restarted.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 0, rotationAvailable: true });
    await restarted.chooseChampion({ player: a.playerId, champion: lux }, a.playerToken);
    expect(await database.getRepository(Champion).findOneBy({ championId: ahri })).toMatchObject({ rotationEndsAtGameTime: null });
    expect(await new GameflowService(database).status(a.playerId, a.playerToken)).toMatchObject({
      rotationRemainingSeconds: 180, rotationAvailable: false, champion: { rotationEndsAtGameTime: 400.5 },
    });
  });

  test('time-only migration converts legacy owners and preserves already running timers', async () => {
    const { game, a, b, champions } = await setup();
    const ahri = champions.blue.find(champion => champion.championName === 'Ahri').championId;
    await database.getRepository(Champion).update(ahri, { rotationEndsAtGameTime: null });
    await database.query(`UPDATE "game" SET "rotationMode" = 'Kills' WHERE "gameId" = $1`, [game.gameId]);
    const runner = database.createQueryRunner();
    try {
      await new TimeOnlyRotation1792400000000().up(runner);
    } finally {
      await runner.release();
    }
    const restarted = new GameflowService(database);
    expect(await restarted.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 180, champion: { rotationEndsAtGameTime: 200 } });
    expect(await restarted.status(b.playerId, b.playerToken)).toMatchObject({ rotationRemainingSeconds: 180, champion: { rotationEndsAtGameTime: 200 } });
    expect(await restarted.getSettings(game.gameId)).not.toHaveProperty('rotationMode');
  });

  test('team objective chests and their offers survive reload and independent services', async () => {
    const { game, a, b, teams } = await setup();
    const teammate = await service.createPlayer({ playerName: 'audit-objective-teammate', gameCode: game.gameCode });
    await service.joinTeam({ player: teammate.playerId, team: teams[0].teamId }, teammate.playerToken);
    const input = feed([{ EventID: 1, EventName: 'DragonKill', KillerName: 'AuditAlice#TEST', DragonType: 'Elder' }]);
    const other = new GameflowService(database);
    await Promise.all([service.ingest({ gameId: game.gameId, input }, game.hostToken), other.ingest({ gameId: game.gameId, input }, game.hostToken)]);
    for (const player of [a, teammate]) {
      expect((await other.status(player.playerId, player.playerToken)).rewards).toMatchObject([{ chestType: 'legendary' }]);
    }
    expect((await other.status(b.playerId, b.playerToken)).rewards).toHaveLength(0);
    const chest = (await service.status(a.playerId, a.playerToken)).rewards[0];
    const offers = await Promise.all([service.openChest({ id: chest.rewardId }, a.playerToken), other.openChest({ id: chest.rewardId }, a.playerToken)]);
    expect(offers[0]).toEqual(offers[1]);
    await service.confirmReward({ id: chest.rewardId, choiceId: 'assign', punishment: { recipient: { playerId: b.playerId } } }, a.playerToken);
    const punishment = (await other.status(b.playerId, b.playerToken)).punishments[0];
    const tap = { id: punishment.punishmentId, expectedRemaining: punishment.remainingAmount };
    const results = await Promise.allSettled([service.consumePunishment(tap, b.playerToken), other.consumePunishment(tap, b.playerToken)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await other.status(b.playerId, b.playerToken)).punishmentTotals.sips).toBe(8);
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
    expect(status.rotationRemainingSeconds).toBe(180);
    expect(status.rewards).toHaveLength(2);
    const request = { id: status.rewards[0].rewardId, punishment: { recipient: { playerId: b.playerId }, amount: -99 } };
    const results = await Promise.allSettled([service.confirmReward(request, a.playerToken), other.confirmReward(request, a.playerToken)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
    const penalties = (await service.status(b.playerId, b.playerToken)).punishments.filter(item => item.punishmentType === 0);
    expect(penalties).toHaveLength(1);
    expect(penalties[0].amount).toBe(9);
  });

  test('an actual transaction rolls back events and consequences without changing timers before retry', async () => {
    const { game, a } = await setup();
    const activityCount = await database.getRepository(ActivityLog).countBy({ gameId: game.gameId });
    const failing = new GameflowService({ options: database.options, manager: {
      transaction: (work: any) => database.transaction(manager => work({
        query: manager.query.bind(manager),
        getRepository: (type: any) => type === Reward ? { save: async () => { throw new Error('injected reward failure'); } } : manager.getRepository(type),
      })),
    } } as any);
    await expect(failing.ingest({ gameId: game.gameId, input: feed([kill(1)]) }, game.hostToken)).rejects.toThrow('injected reward failure');
    expect(await database.getRepository(Event).countBy({ game: { gameId: game.gameId } })).toBe(0);
    expect(await database.getRepository(ActivityLog).countBy({ gameId: game.gameId })).toBe(activityCount);
    expect((await service.status(a.playerId, a.playerToken)).rotationRemainingSeconds).toBe(180);
    await service.ingest({ gameId: game.gameId, input: feed([kill(1)]) }, game.hostToken);
    expect((await service.status(a.playerId, a.playerToken)).rewards).toHaveLength(1);
  });

  test('environment death with an unselected lobby player creates no spurious reward', async () => {
    const { game, b } = await setup();
    const lobby = await service.createPlayer({ playerName: 'audit-unselected', gameCode: game.gameCode });
    await service.ingest({ gameId: game.gameId, input: feed([kill(1, 'Turret_T200_L0_P3')]) }, game.hostToken);
    expect((await service.status(lobby.playerId, lobby.playerToken)).rewards).toHaveLength(0);
    expect((await service.status(b.playerId, b.playerToken))).toMatchObject({ kda: [0, 1, 0], rotationRemainingSeconds: 180, punishments: [{ amount: 7 }] });
    await service.deletePlayer({ id: lobby.playerId }, lobby.playerToken);
  });

  test('rotation stays owned and atomic against concurrent champion selection', async () => {
    const { game, a, champions, teams } = await setup();
    await service.ingest({ gameId: game.gameId, input: feed([kill(1), kill(2)], 200) }, game.hostToken);
    const c = await service.createPlayer({ playerName: 'audit-competing', gameCode: game.gameCode });
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
