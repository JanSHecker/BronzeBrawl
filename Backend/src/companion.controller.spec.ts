import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CompanionController } from './companion.controller';
import { GameflowService } from './gameflow.service';
import { configureHttpBodyParser, JSON_BODY_LIMIT } from './http.config';

describe('companion HTTP contract', () => {
  let app: NestExpressApplication;
  const gameflow = {
    connectCompanion: jest.fn().mockResolvedValue({ gameId: 8, token: 'a'.repeat(64) }),
    disconnectCompanion: jest.fn().mockResolvedValue({ ok: true }),
    companionHeartbeat: jest.fn().mockResolvedValue({ ok: true, gameId: 8 }),
    ingestCompanion: jest.fn().mockResolvedValue({ gameId: 8, state: 'live' }),
    companionStatus: jest.fn().mockResolvedValue({ gameId: 8, connected: true }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CompanionController],
      providers: [{ provide: GameflowService, useValue: gameflow }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttpBodyParser(app);
    await app.init();
  });
  beforeEach(() => { jest.clearAllMocks(); });
  afterAll(async () => { await app.close(); });

  test('host and companion capabilities are passed separately, responses cannot be cached', async () => {
    await request(app.getHttpServer()).post('/companion/connect').set('X-Game-Token', 'host')
      .send({ gameId: 8 }).expect(201).expect('Cache-Control', 'no-store');
    expect(gameflow.connectCompanion).toHaveBeenCalledWith({ gameId: 8 }, 'host');
    await request(app.getHttpServer()).post('/companion/heartbeat').set('X-Companion-Token', 'feed')
      .send({ gameId: 8, availability: 'waiting' }).expect(201).expect('Cache-Control', 'no-store');
    expect(gameflow.companionHeartbeat).toHaveBeenCalledWith({ gameId: 8, availability: 'waiting' }, 'feed');
    await request(app.getHttpServer()).post('/companion/input').set('X-Companion-Token', 'feed')
      .send({ gameId: 8, input: {} }).expect(201).expect('Cache-Control', 'no-store');
    expect(gameflow.ingestCompanion).toHaveBeenCalledWith({ gameId: 8, input: {} }, 'feed');
    await request(app.getHttpServer()).post('/companion/disconnect').set('X-Game-Token', 'host')
      .send({ gameId: 8 }).expect(201).expect('Cache-Control', 'no-store');
    await request(app.getHttpServer()).get('/companion/status?gameId=8').set('X-Game-Token', 'host')
      .expect(200).expect('Cache-Control', 'no-store');
    expect(gameflow.companionStatus).toHaveBeenCalledWith(8, 'host');
  });

  test.each(['', '0', '-1', '1.5', '9007199254740992', 'abc'])('status rejects invalid game ID %p', async value => {
    await request(app.getHttpServer()).get('/companion/status').query({ gameId: value }).expect(400);
  });

  function sizedBody(bytes: number): string {
    const body = {
      gameId: 8,
      input: {
        allPlayers: [{ championName: 'Ahri', riotIdGameName: 'Alice', team: 'ORDER' }],
        events: { Events: [] },
        gameData: { gameTime: 10, mapNumber: 11 },
        padding: '',
      },
    };
    body.input.padding = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(body)));
    return JSON.stringify(body);
  }

  test('accepts the full 4 MiB JSON request boundary, not just 100 KiB', async () => {
    const body = sizedBody(JSON_BODY_LIMIT);
    expect(Buffer.byteLength(body)).toBe(4 * 1024 * 1024);
    await request(app.getHttpServer()).post('/companion/input').set('X-Companion-Token', 'feed')
      .set('Content-Type', 'application/json').send(body).expect(201);
    expect(gameflow.ingestCompanion).toHaveBeenCalledWith(JSON.parse(body), 'feed');
  });

  test('rejects a request one byte above the limit before calling ingest', async () => {
    const body = sizedBody(JSON_BODY_LIMIT + 1);
    await request(app.getHttpServer()).post('/companion/input').set('X-Companion-Token', 'feed')
      .set('Content-Type', 'application/json').send(body).expect(413);
    expect(gameflow.ingestCompanion).not.toHaveBeenCalled();
    // The parser remains usable after a rejected request.
    await request(app.getHttpServer()).post('/companion/heartbeat').set('X-Companion-Token', 'feed')
      .send({ gameId: 8, availability: 'live' }).expect(201);
  });

  test('still rejects malformed JSON without invoking ingest', async () => {
    await request(app.getHttpServer()).post('/companion/input')
      .set('Content-Type', 'application/json').send('{').expect(400);
    expect(gameflow.ingestCompanion).not.toHaveBeenCalled();
  });
});
