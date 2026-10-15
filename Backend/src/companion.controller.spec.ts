import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CompanionController } from './companion.controller';
import { GameflowService } from './gameflow.service';

describe('companion HTTP contract', () => {
  let app: INestApplication;
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
    app = module.createNestApplication();
    await app.init();
  });
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
});
