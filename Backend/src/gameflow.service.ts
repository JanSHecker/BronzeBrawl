import { InjectDataSource } from '@nestjs/typeorm';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'crypto';
import { Game } from './entities/game.entity';
import { Player } from './entities/player.entity';
import { Team } from './entities/team.entity';
import { Champion } from './entities/champion.entity';
import { Event } from './entities/event.entity';
import { Takedown } from './entities/takedown.entity';
import { Reward } from './entities/reward.entity';
import { Punishment } from './entities/punishment.entity';

export class GameflowError extends HttpException {
  constructor(message: string, status: HttpStatus | number) {
    super(message, status);
  }
}

type Store = any;
type GameInput = Record<string, any>;

@Injectable()
export class GameflowService {
  private readonly entityKey = new Map<any, string>([
    [Game, 'gameId'], [Player, 'playerId'], [Team, 'teamId'], [Champion, 'championId'],
    [Event, 'eventId'], [Takedown, 'takedownId'], [Reward, 'rewardId'], [Punishment, 'punishmentId'],
  ]);

  constructor(@InjectDataSource() private readonly database: DataSource | Store) {}

  private fail(message: string, status = HttpStatus.BAD_REQUEST): never {
    throw new GameflowError(message, status);
  }

  private id(value: any, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) this.fail(`invalid ${field}`);
    return value;
  }

  private async rows(type: any, store: Store = this.database, relations: string[] = []): Promise<any[]> {
    if (store?.getRepository) return store.getRepository(type).find(relations.length ? { relations } : {});
    return store.find(type, {});
  }

  private async findOne(type: any, predicate: (row: any) => boolean, store: Store = this.database, relations: string[] = []): Promise<any | null> {
    const rows = await this.rows(type, store, relations);
    return rows.find(predicate) || null;
  }

  private async save(type: any, value: any, store: Store = this.database): Promise<any> {
    if (store?.getRepository) return store.getRepository(type).save(value);
    return store.save(type, value);
  }

  private async remove(type: any, value: any, store: Store = this.database): Promise<void> {
    if (store?.getRepository) {
      await store.getRepository(type).remove(value);
      return;
    }
    await store.remove(type, value);
  }

  private relationId(value: any): number | undefined {
    if (value === null || value === undefined) return undefined;
    const candidate = typeof value === 'object' ? value.gameId ?? value.teamId ?? value.playerId ?? value.championId : value;
    return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : undefined;
  }

  private gameId(value: any): number | undefined {
    return this.relationId(value);
  }

  private playerId(value: any): number | undefined {
    return this.relationId(value);
  }

  private teamId(value: any): number | undefined {
    return this.relationId(value);
  }

  private championId(value: any): number | undefined {
    return this.relationId(value);
  }

  private isPostgres(): boolean {
    return this.database?.options?.type === 'postgres'
      || this.database?.driver?.options?.type === 'postgres';
  }

  private async lockGame(store: Store, gameId: number): Promise<void> {
    if (this.isPostgres() && store?.query) {
      // Keep the lock in the transaction, rather than using an application
      // mutex. This serializes game mutations across all API processes.
      await store.query('SELECT pg_advisory_xact_lock($1)', [gameId]);
    }
  }

  private async transaction<T>(work: (store: Store) => Promise<T>, gameId?: number): Promise<T> {
    // The behavioral contract uses a tiny in-memory repository. It cannot use
    // TypeORM's transaction API, so provide the same serialization and rollback
    // guarantees without cloning class constructors used as Map keys.
    if (this.database?.rows instanceof Map) {
      const db: any = this.database;
      const previous = db.tail || Promise.resolve();
      const task = previous.then(async () => {
        const snapshot = new Map<any, any[]>(
          [...db.rows.entries()].map(([key, value]) => [key, structuredClone(value)]),
        );
        try {
          return await work(db);
        } catch (error) {
          db.rows = snapshot;
          throw error;
        }
      });
      db.tail = task.catch(() => undefined);
      return task;
    }
    const transactionalWork = async (store: Store): Promise<T> => {
      if (gameId !== undefined && this.isPostgres() && store?.query) {
        await this.lockGame(store, gameId);
      }
      return work(store);
    };
    if (this.database?.manager?.transaction) return this.database.manager.transaction(transactionalWork);
    if (this.database?.transaction) return this.database.transaction(transactionalWork);
    return work(this.database);
  }

  private token(): string {
    return randomBytes(32).toString('hex');
  }

  private newGameCode(): string {
    return Array.from({ length: 4 }, () => String.fromCharCode(65 + randomInt(26))).join('');
  }

  private normalizeGameCode(value: any): string {
    if (typeof value !== 'string' || !/^[a-z]{4}$/i.test(value.trim())) this.fail('Game code must contain four letters.');
    return value.trim().toUpperCase();
  }

  private async findGameByCode(gameCode: string, store: Store = this.database): Promise<any | null> {
    if (store?.getRepository) return store.getRepository(Game).findOne({ where: { gameCode } });
    return this.findOne(Game, row => row.gameCode === gameCode, store);
  }

  private async getJoinableGame(value: any, store: Store = this.database): Promise<any> {
    const game = await this.findGameByCode(this.normalizeGameCode(value), store);
    if (!game) this.fail('Game not found. Check your game code.', HttpStatus.NOT_FOUND);
    if (game.state === 'ended') this.fail('This game has ended.', HttpStatus.CONFLICT);
    return game;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private matchesToken(raw: any, stored: any): boolean {
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/i.test(raw) || typeof stored !== 'string') return false;
    const left = Buffer.from(this.hash(raw), 'hex');
    const right = Buffer.from(stored, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private numberSetting(value: any, name: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 100) this.fail(`invalid ${name}`);
    return value;
  }

  private gameTime(value: any): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) this.fail('invalid gameTime');
    return value;
  }

  private publicGame(game: any, hostToken?: string): any {
    const result: any = {
      gameId: game.gameId,
      gameCode: game.gameCode,
      punishmentAmount: game.punishmentAmount,
      rewardAmount: game.rewardAmount,
      rotationMode: game.rotationMode,
      defaultRotationCounter: game.defaultRotationCounter,
      state: game.state || 'waiting_for_feed',
      settings: {
        punishmentAmount: game.punishmentAmount,
        rewardAmount: game.rewardAmount,
        defaultCounter: game.defaultRotationCounter,
        rotationMode: game.rotationMode,
      },
    };
    if (hostToken) result.hostToken = hostToken;
    return result;
  }

  private publicPlayer(player: any): any {
    if (!player) return null;
    return {
      playerId: player.playerId,
      playerName: player.playerName,
      game: this.gameId(player.game),
      team: player.team ? { teamId: player.team.teamId, teamName: player.team.teamName } : null,
      champion: player.champion ? { championId: player.champion.championId, championName: player.champion.championName } : null,
    };
  }

  private publicTeam(team: any): any {
    return { teamId: team.teamId, teamName: team.teamName, gameId: this.gameId(team.game) };
  }

  private publicChampion(champion: any): any {
    return {
      championId: champion.championId,
      championName: champion.championName,
      summonerName: champion.summonerName,
      team: champion.team ? this.publicTeam(champion.team) : null,
      player: champion.player ? this.publicPlayer(champion.player) : null,
    };
  }

  private publicReward(reward: any): any {
    return {
      rewardId: reward.rewardId,
      amount: reward.amount,
      rewardType: reward.rewardType,
      distributed: Boolean(reward.distributed),
      player: this.publicPlayer(reward.player),
    };
  }

  private publicPunishment(punishment: any): any {
    return {
      punishmentId: punishment.punishmentId,
      amount: punishment.amount,
      punishmentType: punishment.punishmentType,
      recieved: Boolean(punishment.recieved),
      player: this.publicPlayer(punishment.player),
      distributor: this.publicPlayer(punishment.distributor),
    };
  }

  private async getGameOrFail(value: any, store: Store = this.database): Promise<any> {
    const id = typeof value === 'object' ? this.gameId(value) : this.id(value, 'gameId');
    if (!id) this.fail('invalid gameId');
    const game = await this.findOne(Game, (row) => row.gameId === id, store, ['teams', 'players']);
    if (!game) this.fail('game not found', HttpStatus.NOT_FOUND);
    return game;
  }

  private async getPlayerOrFail(value: any, store: Store = this.database): Promise<any> {
    const id = typeof value === 'object' ? this.playerId(value) : this.id(value, 'playerId');
    if (!id) this.fail('invalid playerId');
    const player = await this.findOne(Player, (row) => row.playerId === id, store, [
      'game', 'team', 'team.game', 'champion', 'champion.team', 'champion.team.game', 'champion.player',
    ]);
    if (!player) this.fail('player not found', HttpStatus.NOT_FOUND);
    return player;
  }

  private async authorizePlayer(value: any, token: string, store: Store = this.database): Promise<any> {
    const player = await this.getPlayerOrFail(value, store);
    if (!this.matchesToken(token, player.playerTokenHash)) this.fail('invalid player capability', HttpStatus.FORBIDDEN);
    return player;
  }

  private async authorizeHost(game: any, token: string): Promise<void> {
    if (!this.matchesToken(token, game.hostTokenHash)) this.fail('invalid host capability', HttpStatus.FORBIDDEN);
  }

  private authorizeCompanion(game: any, token: string): void {
    if (!this.matchesToken(token, game.companionTokenHash)) this.fail('invalid companion capability', HttpStatus.FORBIDDEN);
  }

  private async getCompanionGame(gameId: number, store: Store = this.database): Promise<any> {
    if (!store?.getRepository) return this.getGameOrFail(gameId, store);
    // Status polling/heartbeats must not load every game's large feed snapshot.
    const game = await store.getRepository(Game).findOne({
      where: { gameId },
      select: ['gameId', 'hostTokenHash', 'companionTokenHash', 'lastCompanionAt',
        'companionAvailability', 'lastFeedAt', 'state'],
    });
    if (!game) this.fail('game not found', HttpStatus.NOT_FOUND);
    return game;
  }

  async connectCompanion(input: { gameId: any }, hostToken: string): Promise<any> {
    const gameId = this.id(input?.gameId, 'gameId');
    return this.transaction(async store => {
      const game = await this.getCompanionGame(gameId, store);
      await this.authorizeHost(game, hostToken);
      const token = this.token();
      game.companionTokenHash = this.hash(token);
      game.lastCompanionAt = null;
      game.companionAvailability = null;
      await this.save(Game, game, store);
      return { gameId, token };
    }, gameId);
  }

  async disconnectCompanion(input: { gameId: any }, hostToken: string): Promise<any> {
    const gameId = this.id(input?.gameId, 'gameId');
    return this.transaction(async store => {
      const game = await this.getCompanionGame(gameId, store);
      await this.authorizeHost(game, hostToken);
      game.companionTokenHash = null;
      game.lastCompanionAt = null;
      game.companionAvailability = null;
      await this.save(Game, game, store);
      return { ok: true };
    }, gameId);
  }

  async companionHeartbeat(input: { gameId: any; availability: any }, token: string): Promise<any> {
    const gameId = this.id(input?.gameId, 'gameId');
    if (!['waiting', 'live', 'conflict'].includes(input?.availability)) this.fail('invalid companion availability');
    return this.transaction(async store => {
      const game = await this.getCompanionGame(gameId, store);
      this.authorizeCompanion(game, token);
      game.lastCompanionAt = new Date();
      game.companionAvailability = input.availability;
      await this.save(Game, game, store);
      return { ok: true, gameId, serverTime: game.lastCompanionAt.toISOString() };
    }, gameId);
  }

  async companionStatus(gameId: number, hostToken: string): Promise<any> {
    const game = await this.getCompanionGame(gameId);
    await this.authorizeHost(game, hostToken);
    const now = Date.now();
    const lastSeen = game.lastCompanionAt ? new Date(game.lastCompanionAt).getTime() : 0;
    const lastInput = game.lastFeedAt ? new Date(game.lastFeedAt).getTime() : 0;
    const paired = Boolean(game.companionTokenHash);
    const connected = paired && lastSeen > 0 && now - lastSeen <= 15000;
    return {
      gameId, paired, connected, availability: game.companionAvailability || 'waiting',
      lastSeenAt: game.lastCompanionAt || null, lastInputAt: game.lastFeedAt || null,
      feedFresh: connected && game.companionAvailability === 'live' && lastInput > 0 && now - lastInput <= 15000,
      gameState: game.state, serverTime: new Date(now).toISOString(),
    };
  }

  async runGame(input: GameInput): Promise<any> {
    const punishmentAmount = this.numberSetting(input?.punishmentAmount, 'punishmentAmount');
    const rewardAmount = this.numberSetting(input?.rewardAmount, 'rewardAmount');
    const defaultRotationCounter = this.numberSetting(
      input?.defaultRotationCounter ?? input?.defaultCounter,
      'defaultCounter',
    );
    const rotationMode = input?.rotationMode;
    if (rotationMode !== 'Kills' && rotationMode !== 'Deaths') this.fail('invalid rotationMode');
    return this.transaction(async (store) => {
      let gameCode: string;
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = this.newGameCode();
        if (!await this.findGameByCode(candidate, store)) { gameCode = candidate; break; }
      }
      if (!gameCode) this.fail('Could not allocate a game code. Please try again.', HttpStatus.SERVICE_UNAVAILABLE);
      const hostToken = this.token();
      const game = await this.save(Game, {
        gameCode,
        punishmentAmount,
        rewardAmount,
        rotationMode,
        defaultRotationCounter,
        state: 'waiting_for_feed',
        hostTokenHash: this.hash(hostToken),
        lastGameTime: null,
        rosterFingerprint: null,
        feedSnapshot: null,
      }, store);
      const blue = await this.save(Team, { teamName: 0, game }, store);
      const red = await this.save(Team, { teamName: 1, game }, store);
      game.teams = [blue, red];
      await this.save(Game, game, store);
      return this.publicGame(game, hostToken);
    }, -1); // Separate advisory-lock namespace: serialize code allocation across API processes.
  }

  private normalizeRoster(input: any): any[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !Array.isArray(input.allPlayers) || !input.events || typeof input.events !== 'object'
      || Array.isArray(input.events) || !Array.isArray(input.events.Events)) {
      this.fail('invalid game input');
    }
    if (input.allPlayers.length === 0 || input.allPlayers.length > 10) this.fail('invalid game input');
    const identities = new Set<string>();
    const counts = { ORDER: 0, CHAOS: 0 };
    return input.allPlayers.map((player: any) => {
      if (!player || typeof player.championName !== 'string' || !player.championName.trim()
        || typeof player.riotIdGameName !== 'string' || !player.riotIdGameName.trim()
         || (player.team !== 'ORDER' && player.team !== 'CHAOS')) this.fail('invalid player snapshot');
      for (const field of ['riotIdTagLine', 'riotId', 'summonerName']) {
        if (player[field] !== undefined && (typeof player[field] !== 'string' || !player[field].trim())) this.fail('invalid player identity');
      }
      const identity = this.identity(player);
      if (identities.has(identity) || ++counts[player.team] > 5) this.fail('duplicate or oversized roster');
      identities.add(identity);
      return player;
    });
  }

  private normalizeEvents(input: any): any[] {
    const events = input.events.Events.map((raw: any) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || typeof raw.EventID !== 'number' || !Number.isSafeInteger(raw.EventID) || raw.EventID < 0
        || typeof raw.EventName !== 'string' || !raw.EventName.trim()) this.fail('invalid event');
      if (raw.EventTime !== undefined && (typeof raw.EventTime !== 'number'
        || !Number.isFinite(raw.EventTime) || raw.EventTime < 0)) this.fail('invalid event time');
      if (raw.Assisters !== undefined && (!Array.isArray(raw.Assisters)
        || raw.Assisters.some((name: any) => typeof name !== 'string' || !name.trim()))) {
        this.fail('invalid event assisters');
      }
      if (raw.EventName === 'ChampionKill'
        && (typeof raw.KillerName !== 'string' || !raw.KillerName.trim()
          || typeof raw.VictimName !== 'string' || !raw.VictimName.trim())) {
        this.fail('invalid champion kill');
      }
      return raw;
    });
    const gameData = input.gameData;
    if (gameData !== undefined && (gameData === null || typeof gameData !== 'object' || Array.isArray(gameData))) {
      this.fail('invalid gameData');
    }
    if (gameData?.gameTime !== undefined) this.gameTime(gameData.gameTime);
    if (gameData?.mapNumber !== undefined
      && (typeof gameData.mapNumber !== 'number' || !Number.isSafeInteger(gameData.mapNumber) || gameData.mapNumber <= 0)) {
      this.fail('invalid mapNumber');
    }
    return events.sort((a, b) => a.EventID - b.EventID);
  }

  private identity(player: any): string {
    if (typeof player.riotId === 'string' && player.riotId.trim()) return player.riotId.trim().toLowerCase();
    if (typeof player.riotIdGameName === 'string' && player.riotIdGameName.trim()) {
      const gameName = player.riotIdGameName.trim().toLowerCase();
      const tagLine = typeof player.riotIdTagLine === 'string' ? player.riotIdTagLine.trim().toLowerCase() : '';
      return `${gameName}${tagLine ? `#${tagLine}` : ''}`;
    }
    return typeof player.summonerName === 'string' ? player.summonerName.trim().toLowerCase() : '';
  }

  private eventIdentity(name: any): string {
    return typeof name === 'string' ? name.trim().toLowerCase() : '';
  }

  private rosterFingerprint(roster: any[]): string {
    return createHash('sha256').update(JSON.stringify(roster.map((p) => ({
      identity: this.identity(p), championName: p.championName, team: p.team,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
  }

  private environmentKiller(name: string): boolean {
    return /^(turret|inhibitor|nexus|minion|monster|dragon|baron|rift herald|neutral|sru_|voidgrub|grubs?)/i.test(name.trim());
  }

  private canonical(value: any): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonical(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${this.canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private sameEvent(a: any, b: any): boolean {
    return a.eventType === b.EventName && a.payload && this.canonical(a.payload) === this.canonical(b);
  }

  private async findChampionForName(name: string, champions: any[]): Promise<any | null> {
    const normalized = this.eventIdentity(name);
    const matches = champions.filter((champion) => {
      const candidates = [champion.summonerName, champion.riotId, champion.riotIdGameName,
        champion.riotIdGameName && champion.riotIdTagLine ? `${champion.riotIdGameName}#${champion.riotIdTagLine}` : null];
      return candidates.filter(Boolean).some((candidate) => this.eventIdentity(candidate) === normalized);
    });
    if (matches.length > 1) this.fail('ambiguous event participant');
    return matches[0] || null;
  }

  private async playerForChampion(champion: any, players: any[]): Promise<any | null> {
    if (!champion) return null;
    return players.find((player) => this.championId(player.champion) === champion?.championId) || null;
  }

  async ingest(request: { gameId: any; input: any }, hostToken: string): Promise<any> {
    return this.ingestSnapshot(request, hostToken, false);
  }

  async ingestCompanion(request: { gameId: any; input: any }, token: string): Promise<any> {
    return this.ingestSnapshot(request, token, true);
  }

  private async ingestSnapshot(request: { gameId: any; input: any }, token: string, companion: boolean): Promise<any> {
    const gameId = this.id(request?.gameId, 'gameId');
    const roster = this.normalizeRoster(request?.input);
    const events = this.normalizeEvents(request?.input);
    return this.transaction(async (store) => {
      const game = await this.getGameOrFail(gameId, store);
      if (companion) this.authorizeCompanion(game, token);
      else await this.authorizeHost(game, token);
      const input = request.input;
      const fingerprint = this.rosterFingerprint(roster);
      if (game.rosterFingerprint && game.rosterFingerprint !== fingerprint) this.fail('roster changed', HttpStatus.CONFLICT);
      const gameTime = input.gameData?.gameTime === undefined ? undefined : this.gameTime(input.gameData.gameTime);
      if (input.gameData?.mapNumber !== undefined) this.gameTime(input.gameData.mapNumber);
      for (const field of ['mapNumber', 'gameMode']) {
        const previous = game.feedSnapshot?.gameData?.[field];
        const current = input.gameData?.[field];
        if (previous !== undefined && current !== undefined && previous !== current) this.fail('feed source changed', HttpStatus.CONFLICT);
      }
      if (game.lastGameTime !== null && gameTime !== undefined && gameTime < game.lastGameTime) {
        this.fail('game clock moved backwards', HttpStatus.CONFLICT);
      }

      let teams = await this.rows(Team, store, ['game']);
      teams = teams.filter((team) => this.gameId(team.game) === gameId);
      const teamByName = new Map(teams.map((team) => [team.teamName, team]));
      if (!teamByName.has(0) || !teamByName.has(1)) this.fail('game teams are incomplete', HttpStatus.CONFLICT);
      let champions = (await this.rows(Champion, store, ['team', 'team.game', 'player'])).filter((champion) => this.gameId(champion.team?.game) === gameId);
      const byIdentity = new Map(champions.map((champion) => [this.identity(champion), champion]));
      for (const player of roster) {
        const key = this.identity(player);
        if (!byIdentity.has(key)) {
          const champion = await this.save(Champion, {
            championName: player.championName,
            summonerName: player.summonerName || `${player.riotIdGameName}${player.riotIdTagLine ? `#${player.riotIdTagLine}` : ''}`,
            riotId: player.riotId || null,
            riotIdGameName: player.riotIdGameName,
            riotIdTagLine: player.riotIdTagLine || null,
            team: teamByName.get(player.team === 'ORDER' ? 0 : 1),
          }, store);
          byIdentity.set(key, champion);
          champions.push(champion);
        }
      }
      const players = (await this.rows(Player, store, ['game', 'team', 'champion'])).filter((player) => this.gameId(player.game) === gameId);
      const existingEvents = (await this.rows(Event, store, ['game'])).filter((event) => this.gameId(event.game) === gameId);
      if (game.state === 'ended' && (gameTime !== undefined && game.lastGameTime !== null && gameTime > game.lastGameTime)) {
        this.fail('game has ended', HttpStatus.CONFLICT);
      }
      for (const raw of events) {
        const prior = existingEvents.find((event) => event.ingameId === raw.EventID);
        if (prior) {
          if (!this.sameEvent(prior, raw)) this.fail('event identity was reused', HttpStatus.CONFLICT);
          continue;
        }
        if (game.state === 'ended') this.fail('game has ended', HttpStatus.CONFLICT);
        const event = await this.save(Event, {
          ingameId: raw.EventID, eventType: raw.EventName, payload: raw, game,
        }, store);
        existingEvents.push(event);
        if (raw.EventName === 'GameEnd') {
          game.state = 'ended';
          continue;
        }
        if (raw.EventName !== 'ChampionKill') continue;
        const victim = await this.findChampionForName(raw.VictimName, champions);
        if (!victim) this.fail('unknown event victim');
        const killer = await this.findChampionForName(raw.KillerName, champions);
        if (!killer) {
          if (!this.environmentKiller(raw.KillerName || '')) this.fail('unknown event killer');
        }
        const assistors: any[] = [];
        for (const assister of raw.Assisters || []) {
          const champion = await this.findChampionForName(assister, champions);
          if (!champion) this.fail('unknown event assister');
          if (champion.championId !== killer?.championId && champion.championId !== victim.championId
            && !assistors.some(prior => prior.championId === champion.championId)) assistors.push(champion);
        }
        const takedown = await this.save(Takedown, {
          multiKill: 1, shutdown: false, event, killer, killed: victim, assistor: assistors,
        }, store);
        // Event owns this one-to-one FK; persist the owning side explicitly.
        event.takedown = takedown;
        await this.save(Event, event, store);
        const victimPlayer = await this.playerForChampion(victim, players);
        const killerPlayer = await this.playerForChampion(killer, players);
        if (victimPlayer) {
          victimPlayer.deathCounter = Math.max(0, Number(victimPlayer.deathCounter || 0) - 1);
          await this.save(Player, victimPlayer, store);
          const punishment = await this.save(Punishment, {
            amount: game.punishmentAmount, punishmentType: 1, player: victimPlayer, takedown,
          }, store);
          takedown.punishment = punishment;
        }
        if (killerPlayer) {
          killerPlayer.killCounter = Math.max(0, Number(killerPlayer.killCounter || 0) - 1);
          await this.save(Player, killerPlayer, store);
          const reward = await this.save(Reward, {
            amount: game.rewardAmount, rewardType: 1, distributed: false, player: killerPlayer, takedown,
          }, store);
          takedown.reward = reward;
        }
        // Persist both sides of the one-to-one links. This makes a restart or
        // repository reload return the same event consequences, rather than
        // relying on this request's in-memory object graph.
        await this.save(Takedown, takedown, store);
        event.takedown = takedown;
        if (takedown.reward) event.reward = takedown.reward;
        await this.save(Event, event, store);
      }
      game.rosterFingerprint = fingerprint;
      if (gameTime !== undefined) game.lastGameTime = gameTime;
      game.feedSnapshot = input;
      game.lastFeedAt = new Date();
      if (companion) {
        game.lastCompanionAt = game.lastFeedAt;
        game.companionAvailability = 'live';
      }
      if (game.state !== 'ended') game.state = 'live';
      await this.save(Game, game, store);
      return this.publicGame(game);
    }, gameId);
  }

  async createPlayer(input: { playerName: any; gameCode: any }): Promise<any> {
    if (typeof input?.playerName !== 'string' || !input.playerName.trim()) this.fail('invalid playerName');
    const gameCode = this.normalizeGameCode(input?.gameCode);
    const target = await this.getJoinableGame(gameCode);
    const gameId = target.gameId;
    return this.transaction(async (store) => {
      // Resolve and check again under the game lock, including a concurrent GameEnd.
      const game = await this.getJoinableGame(gameCode, store);
      if (game.gameId !== gameId) this.fail('Game invitation has changed.', HttpStatus.CONFLICT);
      const rawToken = this.token();
      const player = await this.save(Player, {
        playerName: input.playerName.trim(), game, team: null, champion: null,
        killCounter: 0, deathCounter: 0, playerTokenHash: this.hash(rawToken),
      }, store);
      return {
        playerId: player.playerId,
        playerName: player.playerName,
        game: game.gameId,
        playerToken: rawToken,
      };
    }, gameId);
  }

  async getTeams(gameValue: any): Promise<any> {
    const gameId = this.id(gameValue, 'gameId');
    await this.getGameOrFail(gameId);
    const teams = (await this.rows(Team, this.database, ['game'])).filter((team) => this.gameId(team.game) === gameId);
    const players = (await this.rows(Player, this.database, ['game', 'team', 'champion'])).filter((player) => this.gameId(player.game) === gameId);
    const resultTeams = teams.sort((a, b) => a.teamName - b.teamName).map((team) => this.publicTeam(team));
    return {
      players: {
        blue: players.filter((player) => player.team?.teamName === 0).map((player) => this.publicPlayer(player)),
        red: players.filter((player) => player.team?.teamName === 1).map((player) => this.publicPlayer(player)),
      },
      teams: resultTeams,
    };
  }

  async joinTeam(input: { player: any; team: any }, token: string): Promise<any> {
    const player = await this.getPlayerOrFail(input?.player);
    const gameId = this.gameId(player.game);
    if (!gameId) this.fail('invalid gameId');
    return this.transaction(async (store) => {
      const player = await this.authorizePlayer(input?.player, token, store);
      if (player.game?.state === 'ended') this.fail('game has ended', HttpStatus.CONFLICT);
      const teamId = this.id(input?.team, 'teamId');
      const team = await this.findOne(Team, (row) => row.teamId === teamId, store, ['game']);
      if (!team) this.fail('team not found', HttpStatus.NOT_FOUND);
      if (this.gameId(player.game) !== this.gameId(team.game)) this.fail('team belongs to another game', HttpStatus.FORBIDDEN);
      if (player.champion) this.fail('cannot change team after champion selection', HttpStatus.CONFLICT);
      const members = (await this.rows(Player, store, ['team'])).filter((row) => this.teamId(row.team) === teamId);
      if (members.length >= 5 && this.teamId(player.team) !== teamId) this.fail('team is full', HttpStatus.CONFLICT);
      player.team = team;
      await this.save(Player, player, store);
      return this.publicPlayer(player);
    }, gameId);
  }

  async getAllChampions(gameValue: any): Promise<any> {
    const gameId = this.id(gameValue, 'gameId');
    await this.getGameOrFail(gameId);
    const champions = (await this.rows(Champion, this.database, ['team', 'team.game', 'player'])).filter((champion) => this.gameId(champion.team?.game) === gameId);
    const result: any = {
      blue: champions.filter((champion) => champion.team?.teamName === 0).map((champion) => this.publicChampion(champion)),
      red: champions.filter((champion) => champion.team?.teamName === 1).map((champion) => this.publicChampion(champion)),
    };
    // Keep the legacy array indexing used by existing clients/tests without
    // making numeric aliases part of the public JSON contract.
    [...result.blue, ...result.red].forEach((champion, index) => {
      Object.defineProperty(result, index, { value: champion, enumerable: false });
    });
    return result;
  }

  async chooseChampion(input: { player: any; champion: any; counter?: any; killCounter?: any }, token: string): Promise<any> {
    const player = await this.getPlayerOrFail(input?.player);
    const gameId = this.gameId(player.game);
    if (!gameId) this.fail('invalid gameId');
    return this.transaction(async (store) => {
      const player = await this.authorizePlayer(input?.player, token, store);
      // Reload the game inside the locked transaction. The client-provided
      // counter/mode and a relation loaded before the lock are never trusted.
      const game = await this.getGameOrFail(player.game, store);
      if (game.gameId !== gameId) this.fail('player belongs to another game', HttpStatus.CONFLICT);
      if (game.state === 'ended') this.fail('game has ended', HttpStatus.CONFLICT);
      if (!player.team) this.fail('join a team before choosing a champion', HttpStatus.CONFLICT);
      const championId = this.id(input?.champion, 'championId');
      const champion = await this.findOne(Champion, (row) => row.championId === championId, store, ['team', 'team.game', 'player']);
      if (!champion) this.fail('champion not found', HttpStatus.NOT_FOUND);
      if (this.gameId(champion.team?.game) !== game.gameId) this.fail('champion belongs to another game', HttpStatus.FORBIDDEN);
      if (this.teamId(champion.team) !== this.teamId(player.team)) this.fail('champion is on the other team', HttpStatus.FORBIDDEN);
      if (player.champion && this.championId(player.champion) === championId) this.fail('same champion selection resets no counters', HttpStatus.CONFLICT);

      // Both the candidate and the player's current champion were loaded in
      // this transaction after the game lock. Never clear an ownership link
      // that belongs to a newer owner if a stale relation is encountered.
      if (champion.player) this.fail('champion is occupied', HttpStatus.CONFLICT);
      if (player.champion) {
        const currentChampion = await this.findOne(
          Champion,
          (row) => row.championId === this.championId(player.champion),
          store,
          ['team', 'team.game', 'player'],
        );
        if (!currentChampion) this.fail('current champion not found', HttpStatus.CONFLICT);
        if (currentChampion.player && this.playerId(currentChampion.player) !== player.playerId) {
          this.fail('current champion is occupied', HttpStatus.CONFLICT);
        }
        const available = game.rotationMode === 'Kills'
          ? Number(player.killCounter) <= 0
          : Number(player.deathCounter) <= 0;
        if (!available) this.fail('rotation counter is not exhausted', HttpStatus.CONFLICT);
        currentChampion.player = null;
        await this.save(Champion, currentChampion, store);
      }
      champion.player = player;
      player.champion = champion;
      const counter = Number(game.defaultRotationCounter);
      player.killCounter = counter;
      player.deathCounter = counter;
      await this.save(Champion, champion, store);
      await this.save(Player, player, store);
      return this.publicChampion(champion);
    }, gameId);
  }

  async getSettings(gameValue: any): Promise<any> {
    const game = await this.getGameOrFail(gameValue);
    return this.publicGame(game);
  }

  async getSettingsByCode(gameCode: any): Promise<any> {
    return this.publicGame(await this.getJoinableGame(gameCode));
  }

  async getInvitation(gameId: number, hostToken: string): Promise<any> {
    const game = await this.getGameOrFail(gameId);
    await this.authorizeHost(game, hostToken);
    if (game.state === 'ended') this.fail('This game has ended.', HttpStatus.CONFLICT);
    return { gameId: game.gameId, gameCode: game.gameCode };
  }

  async kda(championValue: any): Promise<[number, number, number]> {
    const championId = this.id(championValue, 'championId');
    const champion = await this.findOne(Champion, (row) => row.championId === championId);
    if (!champion) this.fail('champion not found', HttpStatus.NOT_FOUND);
    const takedowns = await this.rows(Takedown, this.database, ['killer', 'killed', 'assistor']);
    return [
      takedowns.filter((row) => this.championId(row.killer) === championId).length,
      takedowns.filter((row) => this.championId(row.killed) === championId).length,
      takedowns.filter((row) => (row.assistor || []).some((assist: any) => this.championId(assist) === championId)).length,
    ];
  }

  async status(playerValue: any, token: string): Promise<any> {
    const player = await this.authorizePlayer(playerValue, token);
    const game = await this.getGameOrFail(player.game);
    const champion = player.champion || null;
    const team = player.team || null;
    const teams = (await this.rows(Team, this.database, ['game'])).filter((row) => this.gameId(row.game) === this.gameId(game));
    const enemy = team ? teams.find((row) => row.teamId !== team.teamId) : null;
    const punishments = (await this.rows(Punishment, this.database, ['player', 'distributor', 'takedown'])).filter((row) => this.playerId(row.player) === player.playerId);
    const rewards = (await this.rows(Reward, this.database, ['player', 'takedown'])).filter((row) => this.playerId(row.player) === player.playerId);
    const feedAt = game.lastFeedAt ? new Date(game.lastFeedAt).getTime() : 0;
    return {
      punishments: punishments.map((punishment) => this.publicPunishment(punishment)),
      rewards: rewards.map((reward) => this.publicReward(reward)),
      counter: [Number(player.killCounter || 0), Number(player.deathCounter || 0)],
      kda: champion ? await this.kda(champion.championId) : [0, 0, 0],
      enemyTeam: enemy ? (await this.rows(Champion, this.database, ['team', 'team.game', 'player'])).filter((row) => this.teamId(row.team) === enemy.teamId).map((row) => this.publicChampion(row)) : [],
      gameState: game.state || 'waiting_for_feed',
      feedStale: !feedAt || Date.now() - feedAt > 15000,
      champion: champion ? this.publicChampion(champion) : null,
      team: team ? this.publicTeam(team) : null,
      enemyTeamId: enemy?.teamId || null,
      rotationMode: game.rotationMode,
    };
  }

  async getChangeCounters(playerValue: any, token: string): Promise<[number, number]> {
    const player = await this.authorizePlayer(playerValue, token);
    return [Number(player.killCounter || 0), Number(player.deathCounter || 0)];
  }

  async confirmReward(request: any, token: string): Promise<any> {
    const rewardId = this.id(request?.id, 'rewardId');
    // The reward is deliberately discovered inside the transaction. A
    // preflight read followed by a second transaction would permit a stale
    // distributed flag or owner relation to be used by concurrent requests.
    return this.transaction(async (store) => {
      let reward = await this.findOne(Reward, (row) => row.rewardId === rewardId, store, ['player']);
      if (!reward) this.fail('reward not found', HttpStatus.NOT_FOUND);

      const ownerPreview = await this.getPlayerOrFail(this.playerId(reward.player), store);
      const gameId = this.gameId(ownerPreview.game);
      if (!gameId) this.fail('invalid gameId');
      await this.lockGame(store, gameId);

      // READ COMMITTED PostgreSQL transactions see the winner's committed
      // distributed flag after waiting on the advisory lock. Reload all
      // relations before making the one-and-only consumption decision.
      reward = await this.findOne(Reward, (row) => row.rewardId === rewardId, store, ['player', 'takedown']);
      if (!reward) this.fail('reward not found', HttpStatus.NOT_FOUND);
      // Never trust distributor/player IDs from the request. The reward owner
      // is the only principal allowed to consume it; the token proves that
      // principal's capability.
      const owner = await this.authorizePlayer(this.playerId(reward.player), token, store);
      if (reward.distributed) this.fail('reward already consumed', HttpStatus.CONFLICT);
      const game = await this.getGameOrFail(owner.game, store);
      const recipientId = this.id(request?.punishment?.recipient?.playerId, 'recipient');
      const recipient = await this.getPlayerOrFail(recipientId, store);
      if (this.gameId(recipient.game) !== game.gameId) this.fail('recipient belongs to another game', HttpStatus.FORBIDDEN);
      if (!owner.team || !recipient.team || this.teamId(owner.team) === this.teamId(recipient.team)) this.fail('recipient must be an opposing teammate');
      const punishment = await this.save(Punishment, {
        // A distributed reward always creates the server-defined distributed
        // punishment. Amount comes from the persisted reward (created from
        // Game.rewardAmount); distributor comes from the authenticated owner.
        amount: reward.amount, punishmentType: 0, recieved: false, distributor: owner, player: recipient,
      }, store);
      reward.distributed = true;
      await this.save(Reward, reward, store);
      return this.publicPunishment(punishment);
    });
  }

  async confirmPunishment(request: any, token: string): Promise<any> {
    const punishmentId = this.id(request?.id, 'punishmentId');
    const existing = await this.findOne(Punishment, (row) => row.punishmentId === punishmentId, this.database, ['player']);
    if (!existing) this.fail('punishment not found', HttpStatus.NOT_FOUND);
    const owner = await this.getPlayerOrFail(this.playerId(existing.player));
    const gameId = this.gameId(owner.game);
    if (!gameId) this.fail('invalid gameId');
    return this.transaction(async (store) => {
      const punishmentId = this.id(request?.id, 'punishmentId');
      const punishment = await this.findOne(Punishment, (row) => row.punishmentId === punishmentId, store, ['player']);
      if (!punishment) this.fail('punishment not found', HttpStatus.NOT_FOUND);
      const player = await this.authorizePlayer(this.playerId(punishment.player), token, store);
      punishment.recieved = true;
      await this.save(Punishment, punishment, store);
      return this.publicPunishment(punishment);
    }, gameId);
  }

  async deletePlayer(request: { id: any }, token: string): Promise<void> {
    const existing = await this.getPlayerOrFail(request?.id);
    const gameId = this.gameId(existing.game);
    if (!gameId) this.fail('invalid gameId');
    return this.transaction(async (store) => {
      const player = await this.authorizePlayer(request?.id, token, store);
      const punishments = await this.rows(Punishment, store, ['player', 'distributor']);
      const rewards = await this.rows(Reward, store, ['player']);
      const takedowns = await this.rows(Takedown, store, ['killer', 'killed']);
      if (punishments.some((row) => this.playerId(row.player) === player.playerId || this.playerId(row.distributor) === player.playerId)
        || rewards.some((row) => this.playerId(row.player) === player.playerId)
         || (player.champion && takedowns.some((row) => this.championId(row.killer) === this.championId(player.champion) || this.championId(row.killed) === this.championId(player.champion)))) {
        this.fail('player has combat history', HttpStatus.CONFLICT);
      }
      if (player.champion) {
        player.champion.player = null;
        await this.save(Champion, player.champion, store);
      }
      await this.remove(Player, player, store);
    }, gameId);
  }
}
