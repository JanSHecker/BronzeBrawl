import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlayerService } from './player.service';
import { ChampionService } from './champion.service';
import { GameService } from './game.service';
import { PunishmentService } from './punishment.service';
import { RewardService } from './reward.service';
import { DistributionService } from './distribution.service';
import { TeamService } from './team.service';
import { GameflowService } from './gameflow.service';
import { Game } from './entities/game.entity';
import { Player } from './entities/player.entity';
import { Team } from './entities/team.entity';
import { ActivityLog } from './entities/activity-log.entity';
import { GameCodes1792200000000 } from '../migrations/1792200000000-GameCodes';

class MemoryDB {
  rows = new Map<any, any[]>([[Game, []], [Player, []], [Team, []], [ActivityLog, []]]);
  async find(type: any) { return this.rows.get(type) || []; }
  async save(type: any, value: any) {
    const rows = this.rows.get(type)!;
    const key = type === Game ? 'gameId' : type === Player ? 'playerId' : type === ActivityLog ? 'activityId' : 'teamId';
    if (!value[key]) { value[key] = rows.length + 1; rows.push(value); }
    return value;
  }
}
const settings = { punishmentAmount: 7, rewardAmount: 9 };
let database: MemoryDB;
let service: GameflowService;
beforeEach(() => { database = new MemoryDB(); service = new GameflowService(database as any); });

test('allocates four-letter codes, retries collisions and preserves uniqueness across services', async () => {
  jest.spyOn(service as any, 'newGameCode').mockReturnValueOnce('KFRW').mockReturnValueOnce('KFRW').mockReturnValueOnce('ABCD');
  const first = await service.runGame(settings);
  const second = await service.runGame(settings);
  expect(first).toMatchObject({ gameId: 1, gameCode: 'KFRW' });
  expect(second).toMatchObject({ gameId: 2, gameCode: 'ABCD' });
  const other = new GameflowService(database as any);
  const games = await Promise.all([other.runGame(settings), service.runGame(settings)]);
  const codes = [first, second, ...games].map(game => game.gameCode);
  expect(codes.every(code => /^[A-Z]{4}$/.test(code))).toBe(true);
  expect(new Set(codes).size).toBe(4);
});

test('collision exhaustion is bounded and does not create a partial game', async () => {
  jest.spyOn(service as any, 'newGameCode').mockReturnValue('KFRW');
  await service.runGame(settings);
  await expect(service.runGame(settings)).rejects.toMatchObject({ status: 503 });
  expect(await database.find(Game)).toHaveLength(1);
  expect(await database.find(Team)).toHaveLength(2);
});

test('code lookup and join normalize case/whitespace and never confer host capabilities', async () => {
  const game = await service.runGame(settings);
  const input = ` ${game.gameCode.toLowerCase()} `;
  const result = await service.getSettingsByCode(input);
  expect(result).toMatchObject({ gameId: game.gameId, gameCode: game.gameCode });
  expect(JSON.stringify(result)).not.toMatch(/Token|Hash/);
  const player = await service.createPlayer({ playerName: ' Alice ', gameCode: input });
  expect(player).toMatchObject({ game: game.gameId, playerName: 'Alice' });
  expect(player.playerToken).toMatch(/^[a-f0-9]{64}$/);
  await expect(service.getInvitation(game.gameId, player.playerToken)).rejects.toMatchObject({ status: 403 });
  expect(await service.getInvitation(game.gameId, game.hostToken)).toEqual({ gameId: game.gameId, gameCode: game.gameCode });
});

test.each([undefined, null, 7, '7', '', 'ABC', 'ABCDE', 'AB1D', 'ÄBCD', ['KFRW']])('rejects malformed code %j before creating a player', async code => {
  await expect(service.getSettingsByCode(code)).rejects.toMatchObject({ status: 400 });
  await expect(service.createPlayer({ playerName: 'Alice', gameCode: code })).rejects.toMatchObject({ status: 400 });
  expect(await database.find(Player)).toHaveLength(0);
});

test('unknown codes and ended games reject both settings lookup and joins', async () => {
  await expect(service.getSettingsByCode('ZZZZ')).rejects.toMatchObject({ status: 404 });
  await expect(service.createPlayer({ playerName: 'Alice', gameCode: 'ZZZZ' })).rejects.toMatchObject({ status: 404 });
  const game = await service.runGame(settings);
  (await database.find(Game))[0].state = 'ended';
  await expect(service.getSettingsByCode(game.gameCode)).rejects.toMatchObject({ status: 409 });
  await expect(service.createPlayer({ playerName: 'Alice', gameCode: game.gameCode })).rejects.toMatchObject({ status: 409 });
  expect(await database.find(Player)).toHaveLength(0);
});

test('HTTP requires codes, keeps host recovery authenticated and rate-limits lookup/join together', async () => {
  const module = await Test.createTestingModule({
    controllers: [AppController],
    providers: [
      ...[AppService, PlayerService, ChampionService, GameService, PunishmentService, RewardService, DistributionService, TeamService]
        .map(provide => ({ provide, useValue: {} })),
      { provide: getDataSourceToken(), useValue: database },
      { provide: GameflowService, useValue: service },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  try {
    const game = await service.runGame(settings);
    const http = app.getHttpServer();
    await request(http).get('/runGame').query({ punishmentAmount: 7, rewardAmount: 9 })
      .expect(200).expect(response => {
        expect(response.body).toMatchObject({ rotationDurationSeconds: 180 });
        expect(response.body).not.toHaveProperty('rotationMode');
        expect(response.body).not.toHaveProperty('defaultRotationCounter');
      });
    await request(http).get('/runGame').query({ punishmentAmount: 7, rewardAmount: 9, rotationMode: 'Kills', defaultCounter: 1 })
      .expect(200).expect(response => expect(response.body.rotationDurationSeconds).toBe(180));
    await request(http).get('/getChangeCounters').query({ id: 1 }).expect(404);
    await request(http).get('/getSettings').query({ gameId: game.gameId }).expect(400);
    await request(http).post('/createPlayer').send({ playerName: 'Alice', game: game.gameId }).expect(400);
    await request(http).get('/getInvitation').query({ gameId: game.gameId }).expect(403);
    await request(http).get('/getInvitation').query({ gameId: game.gameId }).set('X-Game-Token', game.hostToken)
      .expect(200).expect(({ body }) => expect(body.gameCode).toBe(game.gameCode));
    await request(http).get('/gameActivity').query({ gameId: game.gameId }).expect(403);
    await request(http).get('/gameActivity').query({ gameId: game.gameId }).set('X-Game-Token', game.hostToken)
      .expect(200).expect(({ body }) => {
        expect(body.items).toEqual([expect.objectContaining({ type: 'game_created', gameId: game.gameId })]);
        expect(body.nextCursor).toBeNull();
      });
    for (const invalid of [{ gameId: 'bad' }, { gameId: game.gameId, before: '0' }, { gameId: game.gameId, limit: '101' }, { gameId: game.gameId, after: '1', before: '2' }]) {
      await request(http).get('/gameActivity').query(invalid).set('X-Game-Token', game.hostToken).expect(400);
    }
    await request(http).get('/getSettings').query({ gameCode: game.gameCode.toLowerCase() }).expect(200);
    await request(http).post('/createPlayer').send({ playerName: 'Alice', gameCode: game.gameCode })
      .expect(201).expect(({ body }) => expect(body.game).toBe(game.gameId));
    // Four code requests above have consumed the shared budget of sixty.
    for (let count = 0; count < 56; count++) {
      await request(http).get('/getSettings').query({ gameCode: 'BAD' }).expect(400);
    }
    await request(http).post('/createPlayer').send({ playerName: 'Blocked', gameCode: game.gameCode })
      .expect(429).expect('Retry-After', /^\d+$/);
    expect(await database.find(Player)).toHaveLength(1);
  } finally { await app.close(); }
});

test('migration adds unique/validated codes and backfills only unfinished games', async () => {
  const query = jest.fn().mockImplementation(async (sql: string) => sql.startsWith('SELECT') ? [{ gameId: 7 }, { gameId: 8 }] : []);
  const migration = new GameCodes1792200000000();
  await migration.up({ query } as any);
  expect(query.mock.calls[0][0]).toContain('UNIQUE ("gameCode")');
  expect(query.mock.calls[0][0]).toContain("CHECK (\"gameCode\" ~ '^[A-Z]{4}$')");
  expect(query.mock.calls[1][0]).toContain("IS DISTINCT FROM 'ended'");
  const assignments = query.mock.calls.slice(2).map(call => call[1]);
  expect(assignments.map(([, id]) => id)).toEqual([7, 8]);
  expect(assignments.every(([code]) => /^[A-Z]{4}$/.test(code))).toBe(true);
  expect(new Set(assignments.map(([code]) => code)).size).toBe(2);
  await migration.down({ query } as any);
  expect(query).toHaveBeenLastCalledWith('ALTER TABLE "game" DROP COLUMN "gameCode"');
});
