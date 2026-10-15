import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, PayloadTooLargeException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'fs/promises';
import { resolve, join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ReplayAnalysisError, RiotClient } from './riot.client';
import { gameId, MAX_REPLAY_BYTES, patchOf, ReplayItem, SortKey, sortKey, validId } from './replay.types';
import { validateRofl } from './rofl';

const MAX_ITEMS = 1000, MAX_STATE_BYTES = 32 * 1024 * 1024;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
@Injectable()
export class ReplayService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReplayService.name);
  private dir: string;
  private items: ReplayItem[] = [];
  private tail: Promise<any> = Promise.resolve();
  private queued = 0;
  private uploads = 0;
  private worker: Promise<void> | null = null;
  private stopping = false;
  private lock: Awaited<ReturnType<typeof open>>;
  constructor(private readonly riot: RiotClient) {}

  async onModuleInit() {
    this.dir = resolve(process.env.REPLAY_STORAGE_DIR || './replay-storage');
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // One pool writer process. Fail closed instead of silently losing cross-process reservations.
    try { this.lock = await open(join(this.dir, '.pool.lock'), 'wx', 0o600); }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(await readFile(join(this.dir, '.pool.lock'), 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Replay storage lock requires operator recovery');
      let alive = true;
      try { process.kill(pid, 0); } catch (e: any) { if (e.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('Replay storage already has an active writer');
      await unlink(join(this.dir, '.pool.lock'));
      this.lock = await open(join(this.dir, '.pool.lock'), 'wx', 0o600);
    }
    await this.lock.writeFile(String(process.pid)); await this.lock.sync();
    try {
      try {
        const statePath = join(this.dir, 'pool.json');
        if ((await stat(statePath)).size > MAX_STATE_BYTES) throw new Error('Replay state exceeds limit');
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        if (state.version !== 1 || !Array.isArray(state.items) || state.items.length > MAX_ITEMS) throw new Error('Invalid replay state');
        const ids = new Set(), reservations = new Set();
        for (const item of state.items) {
          validId(item.matchId); if (patchOf(item.gameVersion) !== item.patch || ids.has(item.matchId) ||
            !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes <= 0 || item.sizeBytes > MAX_REPLAY_BYTES || !/^[a-f0-9]{64}$/.test(item.sha256) ||
            !['pending', 'ready', 'failed'].includes(item.analysisStatus) ||
            (item.analysisStatus === 'ready' ? !item.scores || item.scores.version !== 1 : item.scores !== null)) throw new Error('Invalid replay state');
          if (item.reservedGameId !== null) { gameId(item.reservedGameId); if (reservations.has(item.reservedGameId)) throw new Error('Duplicate reservation'); reservations.add(item.reservedGameId); }
          const fileStat = await stat(this.path(item.matchId)).catch(() => { throw new Error('Replay file missing'); });
          if (fileStat.size !== item.sizeBytes) throw new Error('Replay file truncated');
          ids.add(item.matchId);
        }
        this.items = state.items;
      } catch (e: any) { if (e.code !== 'ENOENT') throw e; if (this.items.length) throw e; }
      // Crash leftovers are unpublished, never exposed as valid pool entries.
      for (const name of await readdir(this.dir)) {
        if (name.endsWith('.tmp') || (name.endsWith('.rofl') && !this.items.some(i => `${i.matchId}.rofl` === name))) await unlink(join(this.dir, name));
      }
      this.kick();
    } catch (e) { await this.unlock(); throw e; }
  }
  private async unlock() {
    if (this.lock) { await this.lock.close(); this.lock = null; await unlink(join(this.dir, '.pool.lock')).catch(() => {}); }
  }
  async onModuleDestroy() { this.stopping = true; this.riot.cancel?.(); await this.waitForIdle(); await this.tail; await this.unlock(); }
  private path(id: string) { return join(this.dir, `${validId(id)}.rofl`); }
  private async persist() {
    const data = JSON.stringify({ version: 1, items: this.items });
    if (Buffer.byteLength(data) > MAX_STATE_BYTES) throw new ServiceUnavailableException('Replay metadata capacity reached');
    const temp = join(this.dir, `.pool-${randomUUID()}.tmp`);
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
    try {
      await rename(temp, join(this.dir, 'pool.json'));
      // Windows cannot open/fsync directory handles through Node's fs API.
      // File contents are still flushed before the atomic rename on all OSes.
      if (process.platform !== 'win32') {
        const directory = await open(this.dir, 'r'); try { await directory.sync(); } finally { await directory.close(); }
      }
    } finally { await unlink(temp).catch(() => {}); }
  }
  private serial<T>(fn: () => Promise<T> | T, write = false, afterCommit?: () => Promise<void>): Promise<T> {
    if (this.stopping) return Promise.reject(new ServiceUnavailableException('Replay pool is stopping'));
    if (this.queued >= 256) return Promise.reject(new ServiceUnavailableException('Replay pool is busy'));
    this.queued++;
    const task = this.tail.then(async () => {
      const before = write ? copy(this.items) : null;
      try { const result = await fn(); if (write) await this.persist(); if (afterCommit) await afterCommit(); return copy(result); }
      catch (e) { if (write) this.items = before; throw e; }
    }).finally(() => { this.queued--; });
    this.tail = task.catch(() => {}); return task;
  }
  private find(id: string) { validId(id); const item = this.items.find(i => i.matchId === id); if (!item) throw new NotFoundException('Replay not found'); return item; }
  private sorted(items: ReplayItem[], key: SortKey) {
    return [...items].sort((a, b) => (b.scores?.[key] ?? -1) - (a.scores?.[key] ?? -1) || a.createdAt.localeCompare(b.createdAt) || a.matchId.localeCompare(b.matchId));
  }
  list(patch?: string, sort?: string) {
    const key = sortKey(sort);
    if (patch !== undefined && (typeof patch !== 'string' || !/^[1-9][0-9]{0,2}\.[0-9]{1,3}$/.test(patch))) throw new BadRequestException('Invalid patch filter');
    return this.serial(() => ({ items: this.sorted(this.items.filter(i => !patch || i.patch === patch), key), riotConfigured: this.riot.configured() }));
  }
  async upload(id: string, version: string, stream: Readable, contentType: string, length?: string): Promise<ReplayItem> {
    validId(id); const patch = patchOf(version);
    if (contentType?.split(';')[0].trim().toLowerCase() !== 'application/octet-stream') throw new UnsupportedMediaTypeException('Use application/octet-stream');
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_REPLAY_BYTES)) throw new PayloadTooLargeException('Replay maximum is 150 MiB');
    if (this.uploads >= 2 || this.stopping) throw new ServiceUnavailableException('Replay upload capacity reached');
    this.uploads++;
    const temp = join(this.dir, `.upload-${randomUUID()}.tmp`);
    let published = false, size = 0;
    const hash = createHash('sha256');
    const meter = new Transform({ transform(chunk, _encoding, cb) {
      size += chunk.length;
      if (size > MAX_REPLAY_BYTES) return cb(new PayloadTooLargeException('Replay maximum is 150 MiB'));
      hash.update(chunk); cb(null, chunk);
    } });
    const timer = setTimeout(() => meter.destroy(new BadRequestException('Replay upload timed out')), 120000); timer.unref();
    try {
      await pipeline(stream, meter, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
      if (length !== undefined && Number(length) !== size) throw new BadRequestException('Replay content length mismatch');
      await validateRofl(temp, size, id, version);
      const sha256 = hash.digest('hex');
      const handle = await open(temp, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
      const item = await this.serial(async () => {
        const existing = this.items.find(i => i.matchId === id);
        if (existing) {
          if (existing.sha256 !== sha256 || existing.gameVersion !== version) throw new ConflictException('Replay already exists with different bytes or version');
          return existing;
        }
        if (this.items.length >= MAX_ITEMS) throw new ServiceUnavailableException('Replay pool capacity reached');
        await rename(temp, this.path(id)); published = true;
        const item: ReplayItem = { matchId: id, gameVersion: version, patch, sizeBytes: size, sha256, createdAt: new Date().toISOString(),
          analysisStatus: 'pending', analysisError: null, scores: null, reservedGameId: null };
        this.items.push(item); return item;
      }, true);
      this.kick(); return item;
    } catch (e) { if (published) await unlink(this.path(id)).catch(() => {}); throw e; }
    finally { clearTimeout(timer); this.uploads--; await unlink(temp).catch(() => {}); }
  }
  async download(id: string) {
    let stream: Readable;
    const item = await this.serial(async () => {
      const item = this.find(id);
      // Open while serialized so a concurrent delete cannot race the download.
      const file = await open(this.path(id), 'r');
      stream = file.createReadStream();
      return item;
    });
    return { item, stream };
  }
  async remove(id: string) {
    await this.serial(() => { const item = this.find(id); if (item.reservedGameId !== null) throw new ConflictException('Replay is reserved'); this.items = this.items.filter(i => i !== item); return { deleted: true }; }, true,
      async () => { await unlink(this.path(id)).catch(() => {}); });
    return { deleted: true };
  }
  async analyze(id: string) {
    const item = await this.serial(() => { const item = this.find(id);
      if (item.reservedGameId !== null) throw new ConflictException('Replay is reserved');
      if (item.analysisStatus !== 'pending') { item.analysisStatus = 'pending'; item.analysisError = null; item.scores = null; }
      return item;
    }, true); this.kick(); return item;
  }
  reserve(body: any) {
    const gid = gameId(body?.gameId), patch = patchOf(body?.gameVersion), key = sortKey(body?.sortBy);
    return this.serial(() => {
      const previous = this.items.find(i => i.reservedGameId === gid);
      if (previous) { if (previous.patch !== patch) throw new ConflictException('Game already reserved a different patch'); return { item: previous }; }
      const item = this.sorted(this.items.filter(i => i.patch === patch && i.analysisStatus === 'ready' && i.reservedGameId === null), key)[0];
      if (!item) throw new ConflictException('No ready replay available for this patch');
      item.reservedGameId = gid; return { item };
    }, true);
  }
  release(id: string, body: any) {
    const gid = gameId(body?.gameId);
    return this.serial(() => { const item = this.find(id); if (item.reservedGameId !== gid) throw new ConflictException('Reservation does not match gameId'); item.reservedGameId = null; return item; }, true);
  }
  private kick() {
    if (this.worker || this.stopping) return;
    let storageFailed = false;
    this.worker = new Promise<void>(r => setImmediate(r)).then(async () => {
      while (!this.stopping) {
        const item = await this.serial(() => this.items.find(i => i.analysisStatus === 'pending') || null);
        if (!item) break;
        let scores = null, error: string = null;
        try { scores = await this.riot.analyze(item.matchId, item.gameVersion); }
        catch (e) { error = e instanceof ReplayAnalysisError ? e.message : 'Replay analysis failed'; }
        if (this.stopping) break; // Keep pending on shutdown, restart safely resumes.
        await this.serial(() => {
          const current = this.items.find(i => i.matchId === item.matchId && i.sha256 === item.sha256 && i.createdAt === item.createdAt);
          if (current) { current.analysisStatus = error ? 'failed' : 'ready'; current.analysisError = error; current.scores = error ? null : scores; }
          return null;
        }, true);
      }
    }).catch(() => { storageFailed = true; this.log.error('Replay worker paused after storage failure; pending analysis will resume on restart or retry'); })
      .finally(() => { this.worker = null; if (!storageFailed && this.items.some(i => i.analysisStatus === 'pending')) this.kick(); });
  }
  async waitForIdle() { while (this.worker) await this.worker; }
}
