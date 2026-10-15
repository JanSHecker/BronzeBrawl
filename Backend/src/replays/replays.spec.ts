import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough, Readable } from 'stream';
import { ReplayModule } from './replay.module';
import { ReplayService } from './replay.service';
import { RiotClient } from './riot.client';
import { scoreMatch } from './replay-scoring';

// Generated structural ROFL1 fixture; contains no actual playable replay data.
function rofl(id = 123, version = '16.20.1.2') {
  const metadata = Buffer.from(JSON.stringify({ gameVersion: version }));
  const b = Buffer.alloc(288 + metadata.length + 67);
  b.write('RIOT\0\0', 0, 'binary'); b.writeUInt16LE(288, 262); b.writeUInt32LE(b.length, 264);
  b.writeUInt32LE(288, 268); b.writeUInt32LE(metadata.length, 272);
  b.writeUInt32LE(288 + metadata.length, 276); b.writeUInt32LE(66, 280);
  b.writeUInt32LE(288 + metadata.length + 66, 284); metadata.copy(b, 288);
  b.writeBigUInt64LE(BigInt(id), 288 + metadata.length); return b;
}
const scores = { version: 1, balance: 80, carry: 40, momentum: 20, overall: 60, metrics: {} };
describe('protected durable replay pool (real HTTP + disk)', () => {
  let app: INestApplication, dir: string, service: ReplayService;
  let analyze: jest.Mock;
  const auth = { 'X-Replay-Token': 'operator-secret' };
  async function start() {
    const module = await Test.createTestingModule({ imports: [ReplayModule] })
      .overrideProvider(RiotClient).useValue({ analyze, configured: () => true }).compile();
    app = module.createNestApplication(); await app.init(); service = app.get(ReplayService);
  }
  const http = () => request(app.getHttpServer());
  const upload = (id = 'EUW1_123', bytes = rofl(), version = '16.20.1.2') => http().put(`/replays/${id}/file`)
    .set(auth).set('Content-Type', 'application/octet-stream').set('X-Replay-Version', version).send(bytes);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bronze-replay-test-'));
    process.env.REPLAY_STORAGE_DIR = dir; process.env.REPLAY_ADMIN_TOKEN = auth['X-Replay-Token'];
    analyze = jest.fn().mockResolvedValue(scores); await start();
  });
  afterEach(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); delete process.env.REPLAY_STORAGE_DIR; delete process.env.REPLAY_ADMIN_TOKEN; });
  it('fails closed on all routes, even when server token is unset', async () => {
    for (const [method, path] of [['get','/replays'], ['put','/replays/EUW1_123/file'], ['get','/replays/EUW1_123/file'],
      ['post','/replays/EUW1_123/analyze'], ['delete','/replays/EUW1_123'], ['post','/replays/reserve'], ['post','/replays/EUW1_123/release']]) {
      expect((await http()[method](path)).status).toBe(401);
    }
    await http().get('/replays').set('X-Replay-Token', 'bad').expect(401);
    delete process.env.REPLAY_ADMIN_TOKEN; await http().get('/replays').set(auth).expect(401);
  });
  it('streams upload/download, hashes bytes, persists exact fields across restart', async () => {
    const response = await upload(); expect(response.status).toBe(200);
    expect(response.body.analysisStatus).toBe('pending'); await service.waitForIdle();
    const { body } = await http().get('/replays?patch=16.20&sort=balance').set(auth).expect(200);
    expect(body.riotConfigured).toBe(true); expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0]).sort()).toEqual(['matchId','gameVersion','patch','sizeBytes','sha256','createdAt','analysisStatus','analysisError','scores','reservedGameId'].sort());
    expect(body.items[0].scores.balance).toBe(80);
    const dl = await http().get('/replays/EUW1_123/file').set(auth).expect(200);
    expect(dl.body).toEqual(rofl());
    await app.close(); await start();
    expect((await http().get('/replays').set(auth)).body.items[0]).toEqual(body.items[0]);
    await http().get('/replays?patch=16.19').set(auth).expect(200, { items: [], riotConfigured: true });
  });
  it('identical uploads are idempotent, differing content/identity/version/signature rejected', async () => {
    await upload(); await upload().expect(200);
    const other = rofl(); other[other.length - 1] = 1; await upload('EUW1_123', other).expect(409);
    await upload('EUW1_124').expect(400); await upload('EUW1_123', rofl(), '16.21.1.2').expect(400);
    await upload('EUW1_125', Buffer.from('RIOT')).expect(400);
    await upload('evil_123').expect(400);
    const b = rofl(); b.writeUInt32LE(b.length + 1, 264); await upload('EUW1_123', b).expect(400);
    await http().put('/replays/EUW1_123/file').set(auth).set('Content-Type','application/octet-stream').send(rofl()).expect(400);
    await http().put('/replays/EUW1_123/file').set(auth).set('Content-Type','text/plain').set('X-Replay-Version','16.20.1.2').send('no').expect(415);
  });
  it('bounds upload bytes and rejects advertised oversize without allocating 150 MiB', async () => {
    await http().put('/replays/EUW1_123/file').set(auth).set('Content-Type','application/octet-stream')
      .set('X-Replay-Version','16.20.1.2').set('Content-Length', String(150 * 1024 * 1024 + 1)).send(rofl()).expect(413);
  });
  it('rejects streamed oversize with 413 and cleans temporary files', async () => {
    const { createServer, request: nodeRequest } = await import('http');
    const server = createServer(app.getHttpAdapter().getInstance());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = nodeRequest({ host: '127.0.0.1', port: (server.address() as any).port, path: '/replays/EUW1_123/file', method: 'PUT',
          headers: { ...auth, 'Content-Type': 'application/octet-stream', 'X-Replay-Version': '16.20.1.2' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        Readable.from((function* () { const chunk = Buffer.alloc(1024 * 1024); for (let i = 0; i < 151; i++) yield chunk; })()).pipe(req);
      });
      expect(status).toBe(413);
      const fs = await import('fs/promises'); expect((await fs.readdir(dir)).filter(f => f.endsWith('.tmp'))).toEqual([]);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30000);
  it('bounds concurrent uploads and keeps opened downloads valid during deletion', async () => {
    const first = new PassThrough(), second = new PassThrough();
    const a = service.upload('EUW1_123', '16.20.1.2', first, 'application/octet-stream');
    const b = service.upload('EUW1_124', '16.20.1.2', second, 'application/octet-stream');
    await expect(service.upload('EUW1_125', '16.20.1.2', Readable.from(rofl(125)), 'application/octet-stream')).rejects.toMatchObject({ status: 503 });
    first.end(rofl()); second.end(rofl(124)); await Promise.all([a, b]); await service.waitForIdle();
    const download = await service.download('EUW1_123'); await service.remove('EUW1_123');
    const chunks = []; for await (const chunk of download.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(rofl());
  });
  it('sorts each independent axis, puts nulls last, and reserves by the requested axis', async () => {
    analyze.mockResolvedValueOnce({ ...scores, balance: 90, carry: 10, momentum: null })
      .mockResolvedValueOnce({ ...scores, balance: 20, carry: 95, momentum: 80 });
    await upload(); await service.waitForIdle(); await upload('EUW1_124', rofl(124)); await service.waitForIdle();
    expect((await http().get('/replays?sort=carry').set(auth)).body.items[0].matchId).toBe('EUW1_124');
    expect((await http().get('/replays?sort=balance').set(auth)).body.items[0].matchId).toBe('EUW1_123');
    expect((await http().get('/replays?sort=momentum').set(auth)).body.items[1].scores.momentum).toBeNull();
    expect((await http().post('/replays/reserve').set(auth).send({ gameId: 20, gameVersion: '16.20.1.2', sortBy: 'carry' })).body.item.matchId).toBe('EUW1_124');
    await http().get('/replays?sort=bogus').set(auth).expect(400);
    await http().get('/replays?patch=16').set(auth).expect(400);
    await http().get('/replays/%2E%2E%2Fpool.json/file').set(auth).expect(400);
  });
  it('records safe failed analysis with null scores while keeping the file', async () => {
    analyze.mockRejectedValue(new Error('secret Riot key https://bad.example/key'));
    await upload().expect(200); await service.waitForIdle();
    const item = (await http().get('/replays').set(auth)).body.items[0];
    expect(item.analysisStatus).toBe('failed'); expect(item.scores).toBeNull();
    expect(item.analysisError).not.toMatch(/secret|https/);
    await http().get('/replays/EUW1_123/file').set(auth).expect(200);
    analyze.mockResolvedValue(scores); await http().post('/replays/EUW1_123/analyze').set(auth).expect(201);
    await service.waitForIdle(); expect((await http().get('/replays').set(auth)).body.items[0].analysisStatus).toBe('ready');
  });
  it('serializes reservations, repeats game assignment, blocks delete, and enforces release ownership', async () => {
    await upload(); await service.waitForIdle();
    const reserve = (gameId: number, gameVersion = '16.20.7.8') => http().post('/replays/reserve').set(auth).send({ gameId, gameVersion });
    const attempts = await Promise.all([reserve(10), reserve(11)]);
    expect(attempts.map(x => x.status).sort()).toEqual([201, 409]);
    const winner = attempts[0].status === 201 ? 10 : 11;
    expect((await reserve(winner)).body.item.reservedGameId).toBe(winner);
    await http().delete('/replays/EUW1_123').set(auth).expect(409);
    await http().post('/replays/EUW1_123/release').set(auth).send({ gameId: 99 }).expect(409);
    await http().post('/replays/EUW1_123/release').set(auth).send({ gameId: winner }).expect(201);
    await reserve(12, '16.21.1.1').expect(409); await reserve(-1).expect(400);
    await http().delete('/replays/EUW1_123').set(auth).expect(200);
    await http().get('/replays/EUW1_123/file').set(auth).expect(404);
  });
  it('coalesces requests and processes at concurrency one', async () => {
    let release: () => void; analyze.mockImplementationOnce(() => new Promise(r => { release = () => r(scores); }));
    await upload();
    while (!release) await new Promise(r => setImmediate(r));
    await Promise.all(Array.from({ length: 5 }, () => http().post('/replays/EUW1_123/analyze').set(auth)));
    await upload('EUW1_124', rofl(124)); expect(analyze).toHaveBeenCalledTimes(1);
    release(); await service.waitForIdle(); expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('resumes persisted pending analysis after restart', async () => {
    await upload(); await service.waitForIdle(); await app.close();
    const fs = await import('fs/promises'); const state = JSON.parse(await readFile(join(dir, 'pool.json'), 'utf8'));
    state.items[0].analysisStatus = 'pending'; state.items[0].scores = null;
    await fs.writeFile(join(dir,'pool.json'), JSON.stringify(state)); await start(); await service.waitForIdle();
    expect((await http().get('/replays').set(auth)).body.items[0].analysisStatus).toBe('ready');
  });
});
