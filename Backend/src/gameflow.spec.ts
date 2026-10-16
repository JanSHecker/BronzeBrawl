import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CompanionController } from './companion.controller';
import { GameflowService } from './gameflow.service';
import { configureHttpBodyParser } from './http.config';
import { Game } from './entities/game.entity';
import { Player } from './entities/player.entity';
import { Team } from './entities/team.entity';
import { Champion } from './entities/champion.entity';
import { Event } from './entities/event.entity';
import { Takedown } from './entities/takedown.entity';
import { Reward } from './entities/reward.entity';
import { Punishment } from './entities/punishment.entity';
import { ActivityLog } from './entities/activity-log.entity';

// A missing implementation is a behavioral failure, not a TypeScript import failure.
let Service: any;
try { Service = require('./gameflow.service').GameflowService; } catch { Service = class {}; }
const keys = new Map<any, string>([[Game,'gameId'],[Player,'playerId'],[Team,'teamId'],[Champion,'championId'],[Event,'eventId'],[Takedown,'takedownId'],[Reward,'rewardId'],[Punishment,'punishmentId'],[ActivityLog,'activityId']]);
function matches(row: any, where: any): boolean {
  if (Array.isArray(where)) return where.some(w => matches(row,w));
  return Object.entries(where || {}).every(([k,v]) => v && typeof v === 'object' ? matches(row[k] || {},v) : row[k] === v);
}
class MemoryDB {
  rows = new Map<any, any[]>([...keys.keys()].map(k=>[k,[]]));
  failOn: any;
  tail: Promise<any> = Promise.resolve();
  isInitialized = true;
  all(type: any) { return this.rows.get(type)!; }
  async find(type: any, options: any = {}) { return this.all(type).filter(r=>matches(r,options.where)); }
  async findOne(type: any, options: any) { return (await this.find(type,options))[0] || null; }
  async count(type: any, options: any) { return (await this.find(type,options)).length; }
  async save(type: any, obj: any): Promise<any> {
    if (this.failOn === type) { this.failOn = null; throw Error('injected write failure'); }
    if (Array.isArray(obj)) return Promise.all(obj.map(o=>this.save(type,o)));
    const key = keys.get(type)!;
    if (!obj[key]) obj[key] = Math.max(0,...this.all(type).map(r=>r[key]))+1;
    const index=this.all(type).findIndex(r=>r[key]===obj[key]);
    if(index<0) this.all(type).push(obj); else this.all(type)[index]=obj;
    return obj;
  }
  async remove(type: any,obj: any) { this.rows.set(type,this.all(type).filter(r=>r[keys.get(type)!]!==obj[keys.get(type)!])); }
  async transaction(fn: any) {
    const task=this.tail.then(async()=>{
      const snapshot=structuredClone(this.rows);
      try { return await fn(this); } catch(e) { this.rows=snapshot; throw e; }
    });
    this.tail=task.catch(()=>{}); return task;
  }
}
const roster = [
  {championName:'Ahri',riotIdGameName:'Alice',riotIdTagLine:'EUW',summonerName:'Old Alice',team:'ORDER'},
  {championName:'Lux',riotIdGameName:'Assist',riotIdTagLine:'EUW',team:'ORDER'},
  {championName:'Garen',riotIdGameName:'Bob',riotIdTagLine:'EUW',team:'CHAOS'},
  {championName:'Jinx',riotIdGameName:'Spare',riotIdTagLine:'EUW',team:'CHAOS'},
];
const kill=(id=1,killer='Alice#EUW',victim='Bob#EUW')=>({EventID:id,EventName:'ChampionKill',EventTime:id,KillerName:killer,VictimName:victim,Assisters:['Assist#EUW']});
const feed=(events: any[]=[],time=10)=>({allPlayers:structuredClone(roster),events:{Events:events},gameData:{gameTime:time,gameMode:'CLASSIC',mapNumber:11}});
const settings={punishmentAmount:7,rewardAmount:9};
let db: MemoryDB, service: any, game: any, a: any, b: any, teams: any, champions: any;
async function setup() {
  game=await service.runGame(settings);
  await service.ingest({gameId:game.gameId,input:feed()},game.hostToken);
  a=await service.createPlayer({playerName:'Alex',gameCode:game.gameCode});
  b=await service.createPlayer({playerName:'Alex',gameCode:game.gameCode});
  teams=(await service.getTeams(game.gameId)).teams;
  champions=await service.getAllChampions(game.gameId);
  await service.joinTeam({player:a.playerId,team:teams[0].teamId},a.playerToken);
  await service.joinTeam({player:b.playerId,team:teams[1].teamId},b.playerToken);
  await service.chooseChampion({player:a.playerId,champion:champions[0].championId,counter:999},a.playerToken);
  await service.chooseChampion({player:b.playerId,champion:champions[2].championId},b.playerToken);
}
beforeEach(()=>{db=new MemoryDB(); service=new Service(db as any);});
describe('mystery chest foundation', () => {
  async function supporter() {
    const player = await service.createPlayer({ playerName: 'Support', gameCode: game.gameCode });
    await service.joinTeam({ player: player.playerId, team: teams[0].teamId }, player.playerToken);
    await service.chooseChampion({ player: player.playerId, champion: champions[1].championId }, player.playerToken);
    return player;
  }

  test('one kill, two unique assists, and three deaths earn separate player-owned chests', async () => {
    await setup();
    const support = await supporter();
    const events = [1, 2, 3].map(id => ({ ...kill(id), Assisters: ['Assist#EUW', 'Assist#EUW', 'Alice#EUW', 'Bob#EUW'] }));
    await service.ingest({ gameId: game.gameId, input: feed(events) }, game.hostToken);
    expect(db.all(Reward).filter(row => row.player.playerId === a.playerId).map(row => row.chestType)).toEqual(['standard', 'standard', 'standard']);
    expect(db.all(Reward).filter(row => row.player.playerId === b.playerId).map(row => row.chestType)).toEqual(['revenge']);
    const status = await service.status(support.playerId, support.playerToken);
    expect(status.rewards.map(row => row.chestType)).toEqual(['support']);
    expect(status.chestProgress.find(row => row.key === 'assists')).toMatchObject({ current: 1, target: 2 });
    expect(status.chestProgress.find(row => row.key === 'kills')).toMatchObject({ current: 0, target: 1 });
    service = new Service(db as any);
    await service.ingest({ gameId: game.gameId, input: feed(events) }, game.hostToken);
    expect(db.all(Reward)).toHaveLength(5);
  });

  test('all six objective events reward every joined teammate, including players without champions', async () => {
    await setup();
    const teammate = await service.createPlayer({ playerName: 'Waiting teammate', gameCode: game.gameCode });
    await service.joinTeam({ player: teammate.playerId, team: teams[0].teamId }, teammate.playerToken);
    const events = ['TurretKilled', 'HordeKill', 'HeraldKill', 'DragonKill', 'DragonKill', 'BaronKill'].map((EventName, i) => ({
      EventID: i + 1, EventTime: i + 1, EventName, KillerName: 'Alice#EUW',
      ...(EventName === 'DragonKill' ? { DragonType: i === 4 ? 'Elder' : 'Fire' } : {}),
    }));
    const input = feed(events);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    service = new Service(db as any);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    for (const player of [a, teammate]) {
      const rewards = (await service.status(player.playerId, player.playerToken)).rewards;
      expect(rewards.map(row => row.chestType)).toEqual(['turret', 'epic', 'epic', 'epic', 'legendary', 'legendary']);
      expect(rewards.every(row => Number.isInteger(row.sourceEventId))).toBe(true);
    }
    expect((await service.status(b.playerId, b.playerToken)).rewards).toHaveLength(0);
    expect(db.all(Reward)).toHaveLength(12);
    const history = await service.getActivity({ gameId: game.gameId, limit: 100 }, { hostToken: game.hostToken });
    expect(history.items.filter(row => row.type === 'reward_earned')).toHaveLength(12);
    const late = await service.createPlayer({ playerName: 'Late join', gameCode: game.gameCode });
    await service.joinTeam({ player: late.playerId, team: teams[0].teamId }, late.playerToken);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    expect((await service.status(late.playerId, late.playerToken)).rewards).toHaveLength(0);
  });

  test('minion last-hit turret rewards the attacking team, not the destroyed tower team', async () => {
    await setup();
    await service.ingest({ gameId: game.gameId, input: feed([{
      EventID: 1, EventName: 'TurretKilled', KillerName: 'Minion_T100', TurretKilled: 'Turret_T2_L_03_A',
    }]) }, game.hostToken);
    expect((await service.status(a.playerId, a.playerToken)).rewards[0].chestType).toBe('turret');
    expect((await service.status(b.playerId, b.playerToken)).rewards).toHaveLength(0);
  });

  test('unknown objective ownership and injected reward failures roll back the entire event', async () => {
    await setup();
    const event = { EventID: 1, EventName: 'DragonKill', KillerName: 'Unknown', DragonType: 'Fire' };
    await expect(service.ingest({ gameId: game.gameId, input: feed([event]) }, game.hostToken)).rejects.toMatchObject({ status: 400 });
    expect(db.all(Event)).toHaveLength(0);
    event.KillerName = 'Alice#EUW';
    db.failOn = Reward;
    await expect(service.ingest({ gameId: game.gameId, input: feed([event]) }, game.hostToken)).rejects.toThrow('injected');
    expect(db.all(Event)).toHaveLength(0);
    expect(db.all(Reward)).toHaveLength(0);
    await service.ingest({ gameId: game.gameId, input: feed([event]) }, game.hostToken);
    expect(db.all(Reward)).toHaveLength(1);
  });

  test('opening is authorized, durable and repeatable without consuming or changing the offer', async () => {
    await setup();
    await service.ingest({ gameId: game.gameId, input: feed([kill()]) }, game.hostToken);
    const id = db.all(Reward)[0].rewardId;
    await expect(service.openChest({ id }, b.playerToken)).rejects.toMatchObject({ status: 403 });
    const first = await service.openChest({ id }, a.playerToken);
    service = new Service(db as any);
    expect(await service.openChest({ id }, a.playerToken)).toEqual(first);
    expect(first).toMatchObject({ distributed: false, choices: [{ id: 'assign', effect: 'assign', amount: 9, unit: 'sips' }] });
    expect(first.openedAt).toBeTruthy();
    const request = { id, choiceId: 'assign', punishment: { recipient: { playerId: b.playerId }, amount: 99 } };
    const attempts = await Promise.allSettled([service.confirmReward(request, a.playerToken), service.confirmReward(request, a.playerToken)]);
    expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(db.all(Punishment).filter(row => row.punishmentType === 0)).toHaveLength(1);
    expect(db.all(Punishment).find(row => row.punishmentType === 0)).toMatchObject({ amount: 9, remainingAmount: 9, unit: 'sips' });
    await expect(service.openChest({ id }, a.playerToken)).rejects.toMatchObject({ status: 409 });
  });

  test('unopened or invented choices cannot be submitted', async () => {
    await setup();
    await service.ingest({ gameId: game.gameId, input: feed([kill()]) }, game.hostToken);
    const id = db.all(Reward)[0].rewardId;
    const request = { id, choiceId: 'assign', punishment: { recipient: { playerId: b.playerId } } };
    await expect(service.confirmReward(request, a.playerToken)).rejects.toMatchObject({ status: 400 });
    await service.openChest({ id }, a.playerToken);
    await expect(service.confirmReward({ ...request, choiceId: 'invented' }, a.playerToken)).rejects.toMatchObject({ status: 400 });
  });

  test('punishment counters decrement one unit, preserve amounts, reject replayed taps, and stop at zero', async () => {
    await setup();
    const player = db.all(Player).find(row => row.playerId === a.playerId);
    for (const unit of ['sips', 'shots', 'chugs']) {
      const item = await db.save(Punishment, { amount: 2, unit, player, recieved: false });
      await expect(service.consumePunishment({ id: item.punishmentId, expectedRemaining: 2 }, b.playerToken)).rejects.toMatchObject({ status: 403 });
      const tap = { id: item.punishmentId, expectedRemaining: 2 };
      const attempts = await Promise.allSettled([service.consumePunishment(tap, a.playerToken), service.consumePunishment(tap, a.playerToken)]);
      expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(1);
      const current = db.all(Punishment).find(row => row.punishmentId === item.punishmentId);
      expect(current).toMatchObject({ amount: 2, remainingAmount: 1, recieved: false });
      expect((await service.status(a.playerId, a.playerToken)).punishmentTotals[unit]).toBe(1);
      await service.consumePunishment({ id: item.punishmentId, expectedRemaining: 1 }, a.playerToken);
      await expect(service.consumePunishment({ id: item.punishmentId, expectedRemaining: 1 }, a.playerToken)).rejects.toMatchObject({ status: 409 });
      expect((await service.status(a.playerId, a.playerToken)).punishmentTotals[unit]).toBe(0);
    }
    const history = await service.getActivity({ gameId: game.gameId, limit: 100 }, { hostToken: game.hostToken });
    const confirmations = history.items.filter(row => row.type === 'punishment_confirmed');
    expect(confirmations).toHaveLength(6);
    expect(confirmations.every(row => row.data.amount === 1 && ['sips', 'shots', 'chugs'].includes(row.data.unit))).toBe(true);
  });

});
describe('gameflow contract',()=>{
  test('activity history captures gameplay, consequences, confirmations and end exactly once', async () => {
    await setup();
    const input = feed([kill()], 12);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    const reward = (await service.status(a.playerId, a.playerToken)).rewards[0];
    const assigned = await service.confirmReward({ id: reward.rewardId, punishment: { recipient: { playerId: b.playerId } } }, a.playerToken);
    await service.confirmPunishment({ id: assigned.punishmentId }, b.playerToken);
    await service.confirmPunishment({ id: assigned.punishmentId }, b.playerToken);
    service = new Service(db as any);
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    await service.ingest({ gameId: game.gameId, input: feed([kill(), { EventID: 2, EventName: 'GameEnd', EventTime: 13 }], 13) }, game.hostToken);
    const history = await service.getActivity({ gameId: game.gameId, limit: 100 }, { hostToken: game.hostToken });
    const types = history.items.map(item => item.type);
    for (const type of ['game_created', 'game_started', 'champion_killed', 'reward_earned', 'reward_distributed', 'punishment_confirmed', 'game_ended']) {
      expect(types.filter(value => value === type)).toHaveLength(1);
    }
    expect(types.filter(value => value === 'punishment_assigned')).toHaveLength(2);
    expect(history.items.find(item => item.type === 'champion_killed')).toMatchObject({
      gameTime: 1, data: { killer: { championName: 'Ahri' }, victim: { championName: 'Garen' }, assisters: [{ championName: 'Lux' }] },
    });
    expect(JSON.stringify(history)).not.toMatch(/Token|Hash|feedSnapshot/);
  });

  test('activity has scoped authorization and stable bidirectional cursor pagination after restart', async () => {
    await setup();
    const other = await service.runGame(settings);
    await expect(service.getActivity({ gameId: game.gameId }, {})).rejects.toMatchObject({ status: 403 });
    await expect(service.getActivity({ gameId: other.gameId, playerId: a.playerId }, { playerToken: a.playerToken })).rejects.toMatchObject({ status: 403 });
    await expect(service.getActivity({ gameId: game.gameId }, { hostToken: other.hostToken })).rejects.toMatchObject({ status: 403 });
    const auth = { playerToken: a.playerToken };
    const query = { gameId: game.gameId, playerId: a.playerId, limit: 2 };
    const first = await service.getActivity(query, auth);
    const older = await service.getActivity({ ...query, before: first.nextCursor }, auth);
    expect(first.items[1].activityId).toBeGreaterThan(older.items[0].activityId);
    const newest = first.items[0].activityId;
    await service.ingest({ gameId: game.gameId, input: feed([kill()], 12) }, game.hostToken);
    service = new Service(db as any);
    const newer = await service.getActivity({ ...query, after: newest }, auth);
    expect(newer.items[0].activityId).toBeGreaterThan(newest);
    expect(newer.nextCursor).not.toBeNull();
    for (const invalid of [{ limit: 101 }, { before: -1 }, { after: 0 }, { before: 1, after: 2 }]) {
      await expect(service.getActivity({ ...query, ...invalid }, auth)).rejects.toMatchObject({ status: 400 });
    }
  });

  test('activity writes roll back with game changes, and activity failure rolls back the action', async () => {
    await setup();
    const count = db.all(ActivityLog).length;
    db.failOn = Reward;
    await expect(service.ingest({ gameId: game.gameId, input: feed([kill()]) }, game.hostToken)).rejects.toThrow('injected');
    expect(db.all(ActivityLog)).toHaveLength(count);
    db.failOn = ActivityLog;
    await expect(service.ingest({ gameId: game.gameId, input: feed([kill()]) }, game.hostToken)).rejects.toThrow('injected');
    expect(db.all(Event)).toHaveLength(0);
    expect(db.all(ActivityLog)).toHaveLength(count);
  });

  test('no-op team joins do not log twice, and departed player snapshots survive deletion', async () => {
    game = await service.runGame(settings);
    a = await service.createPlayer({ playerName: 'Original name', gameCode: game.gameCode });
    teams = (await service.getTeams(game.gameId)).teams;
    await service.joinTeam({ player: a.playerId, team: teams[0].teamId }, a.playerToken);
    await service.joinTeam({ player: a.playerId, team: teams[0].teamId }, a.playerToken);
    db.all(Player)[0].playerName = 'Changed name';
    await service.deletePlayer({ id: a.playerId }, a.playerToken);
    const { items } = await service.getActivity({ gameId: game.gameId }, { hostToken: game.hostToken });
    expect(items.filter(item => item.type === 'team_changed')).toHaveLength(1);
    expect(items.find(item => item.type === 'player_joined').data.player.playerName).toBe('Original name');
    expect(items.find(item => item.type === 'player_left').data.player.playerName).toBe('Changed name');
  });

  test('activity distinguishes initial champion selection, rotation and environment deaths', async () => {
    await setup();
    await service.ingest({ gameId: game.gameId, input: feed([kill(1, 'Turret_T200_L0_P3')], 190) }, game.hostToken);
    await service.chooseChampion({ player: a.playerId, champion: champions[1].championId }, a.playerToken);
    const { items } = await service.getActivity({ gameId: game.gameId }, { hostToken: game.hostToken });
    expect(items.find(item => item.type === 'champion_rotated')).toMatchObject({
      gameTime: 190, data: { previousChampion: { championName: 'Ahri' }, champion: { championName: 'Lux' } },
    });
    expect(items.find(item => item.type === 'champion_killed')).toMatchObject({
      data: { killer: null, environment: 'Turret_T200_L0_P3', victim: { championName: 'Garen' } },
    });
    expect(items.filter(item => item.type === 'champion_selected')).toHaveLength(2);
    expect(items.filter(item => item.type === 'reward_earned')).toHaveLength(0);
  });

  test('HTTP accepts and ingests a valid event history above 100 KiB with authorization and idempotency intact', async () => {
    const module = await Test.createTestingModule({
      controllers: [CompanionController],
      providers: [{ provide: GameflowService, useValue: service }],
    }).compile();
    const app = module.createNestApplication<NestExpressApplication>();
    configureHttpBodyParser(app);
    await app.init();
    try {
      const g = await service.runGame(settings);
      const connection = await service.connectCompanion({ gameId: g.gameId }, g.hostToken);
      const body = { gameId: g.gameId, input: feed(Array.from({ length: 1200 }, (_, index) => kill(index + 1)), 1200) };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(100 * 1024);
      await request(app.getHttpServer()).post('/companion/input').set('X-Companion-Token', 'wrong')
        .send(body).expect(403);
      expect(db.all(Event)).toHaveLength(0);
      for (let attempt = 0; attempt < 2; attempt++) {
        await request(app.getHttpServer()).post('/companion/input').set('X-Companion-Token', connection.token)
          .send(body).expect(201).expect(response => {
            expect(response.body).toMatchObject({ gameId: g.gameId, state: 'live' });
          });
        expect(db.all(Event)).toHaveLength(1200);
        expect(db.all(Game)[0].feedSnapshot).toEqual(body.input);
      }
    } finally {
      await app.close();
    }
  });

  test('companion uses a scoped durable capability, heartbeat, expiry and revocation', async () => {
    const g = await service.runGame(settings);
    await expect(service.connectCompanion({ gameId: g.gameId }, 'wrong')).rejects.toMatchObject({ status: 403 });
    const connection = await service.connectCompanion({ gameId: g.gameId }, g.hostToken);
    expect(connection.token).toMatch(/^[a-f0-9]{64}$/);
    expect(connection.token).not.toBe(g.hostToken);
    expect(db.all(Game)[0].companionTokenHash).not.toBe(connection.token);
    await expect(service.companionHeartbeat({ gameId: g.gameId, availability: 'waiting' }, g.hostToken)).rejects.toMatchObject({ status: 403 });
    await expect(service.ingest({ gameId: g.gameId, input: feed() }, connection.token)).rejects.toMatchObject({ status: 403 });
    await service.companionHeartbeat({ gameId: g.gameId, availability: 'waiting' }, connection.token);
    expect(await service.companionStatus(g.gameId, g.hostToken)).toMatchObject({ paired: true, connected: true, feedFresh: false, availability: 'waiting' });
    service = new Service(db as any);
    await service.ingestCompanion({ gameId: g.gameId, input: feed([kill()]) }, connection.token);
    await service.ingestCompanion({ gameId: g.gameId, input: feed([kill()]) }, connection.token);
    expect(db.all(Event)).toHaveLength(1);
    expect(await service.companionStatus(g.gameId, g.hostToken)).toMatchObject({ connected: true, feedFresh: true });
    db.all(Game)[0].lastCompanionAt = new Date(Date.now() - 16000);
    expect(await service.companionStatus(g.gameId, g.hostToken)).toMatchObject({ paired: true, connected: false, feedFresh: false });
    const next = await service.connectCompanion({ gameId: g.gameId }, g.hostToken);
    await expect(service.companionHeartbeat({ gameId: g.gameId, availability: 'live' }, connection.token)).rejects.toMatchObject({ status: 403 });
    await service.disconnectCompanion({ gameId: g.gameId }, g.hostToken);
    await expect(service.ingestCompanion({ gameId: g.gameId, input: feed() }, next.token)).rejects.toMatchObject({ status: 403 });
    expect(await service.companionStatus(g.gameId, g.hostToken)).toMatchObject({ paired: false, connected: false });
    expect(JSON.stringify(await service.getSettings(g.gameId))).not.toMatch(/companionToken|lastCompanion/);
  });
  test('companion status and credentials are game scoped and invalid heartbeats do not change state', async () => {
    const first = await service.runGame(settings);
    const second = await service.runGame(settings);
    const connection = await service.connectCompanion({ gameId: first.gameId }, first.hostToken);
    await expect(service.companionStatus(first.gameId, second.hostToken)).rejects.toMatchObject({ status: 403 });
    await expect(service.companionHeartbeat({ gameId: second.gameId, availability: 'live' }, connection.token)).rejects.toMatchObject({ status: 403 });
    await expect(service.companionHeartbeat({ gameId: first.gameId, availability: 'garbage' }, connection.token)).rejects.toMatchObject({ status: 400 });
    expect(await service.companionStatus(first.gameId, first.hostToken)).toMatchObject({ connected: false });
  });
  test('start immediately persists exactly two semantic teams without a feed',async()=>{
    const g=await service.runGame(settings);
    expect(g).toMatchObject({gameId:1,state:'waiting_for_feed',settings:{punishmentAmount:7,rewardAmount:9,rotationDurationSeconds:180}});
    expect(g.hostToken).toMatch(/^[a-f0-9]{64}$/);
    expect(db.all(Team).map(t=>t.teamName)).toEqual([0,1]);
    expect(db.all(Game)[0].hostTokenHash).not.toBe(g.hostToken);
    expect(JSON.stringify(await service.getSettings(g.gameId))).not.toMatch(/Token|feedSnapshot/);
  });
  test.each([0,-1,101,'2.5','garbage',null])('rejects invalid amount %p',async(value)=>{
    await expect(service.runGame({...settings,rewardAmount:value})).rejects.toMatchObject({status:400});
    expect(db.all(Game)).toHaveLength(0);
  });
  test.each(['Kills', 'Deaths', 'Cheat'])('obsolete mode %s cannot enable a different rotation rule', async rotationMode => {
    const created = await service.runGame({ ...settings, rotationMode, defaultCounter: 1 });
    expect(created.rotationDurationSeconds).toBe(180);
    expect(created).not.toHaveProperty('rotationMode');
    expect(created).not.toHaveProperty('defaultRotationCounter');
    expect(created.settings).not.toHaveProperty('defaultCounter');
  });
  test('requires host capability and valid complete input',async()=>{
    const g=await service.runGame(settings);
    await expect(service.ingest({gameId:g.gameId,input:feed()},'wrong')).rejects.toMatchObject({status:403});
    await expect(service.ingest({gameId:g.gameId,input:{}},g.hostToken)).rejects.toMatchObject({status:400});
    expect(db.all(Champion)).toHaveLength(0);
  });
  test('ingests initial events, settings, assists and idempotent replay after service restart',async()=>{
    await setup(); const input=feed([kill(1),kill(2)],12);
    await service.ingest({gameId:game.gameId,input},game.hostToken);
    service=new Service(db as any);
    await service.ingest({gameId:game.gameId,input},game.hostToken);
    const s=await service.status(a.playerId,a.playerToken);
    expect(s).toMatchObject({kda:[2,0,0],rotationRemainingSeconds:178,rotationAvailable:false,gameState:'live',feedStale:false,enemyTeamId:teams[1].teamId});
    expect(s.rewards.map(r=>r.amount)).toEqual([9,9]);
    expect((await service.status(b.playerId,b.playerToken)).punishments.map(p=>p.amount)).toEqual([7,7]);
    expect(await service.kda(champions[1].championId)).toEqual([0,0,2]);
    expect(db.all(Event)).toHaveLength(2);
  });
  test('replayed snapshots with harmless identity whitespace reuse existing champions',async()=>{
    const g=await service.runGame(settings);
    const initial:any=feed(); initial.allPlayers[0].riotId=' Alice#EUW ';
    const replay:any=structuredClone(initial); replay.allPlayers[0].riotId='Alice#EUW';
    await service.ingest({gameId:g.gameId,input:initial},g.hostToken);
    await service.ingest({gameId:g.gameId,input:replay},g.hostToken);
    expect(db.all(Champion)).toHaveLength(4);
  });
  test('initial snapshot processes historical kills even before owners join',async()=>{
    const g=await service.runGame(settings);
    await service.ingest({gameId:g.gameId,input:feed([kill()])},g.hostToken);
    expect(db.all(Takedown)).toHaveLength(1);
    expect(await service.kda(db.all(Champion)[0].championId)).toEqual([1,0,0]);
  });
  test('environment killers punish victim without a champion reward',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill(1,'Turret_T200_L0_P3')])},game.hostToken);
    expect(db.all(Reward)).toHaveLength(0);
    expect(db.all(Takedown)[0].killer).toBeNull();
    expect((await service.status(b.playerId,b.playerToken))).toMatchObject({rotationRemainingSeconds:180,kda:[0,1,0]});
  });
  test('rolls back every consequence and retries the same event after write failure',async()=>{
    await setup(); db.failOn=Reward;
    await expect(service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken)).rejects.toThrow('injected');
    expect(db.all(Event)).toHaveLength(0); expect(db.all(Takedown)).toHaveLength(0); expect(db.all(Punishment)).toHaveLength(0);
    await service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken);
    expect(db.all(Reward)).toHaveLength(1);
    expect((await service.status(a.playerId,a.playerToken)).rotationRemainingSeconds).toBe(180);
  });
  test('rejects invalid victim with no partial writes',async()=>{
    await setup(); await expect(service.ingest({gameId:game.gameId,input:feed([kill(1,'Alice','Unknown')])},game.hostToken)).rejects.toMatchObject({status:400});
    expect(db.all(Event)).toHaveLength(0);
  });
  test('rejects changed roster, reset clock and reused event identity',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill()],12)},game.hostToken);
    const changed=feed([kill()],13); changed.allPlayers[0].championName='Zed';
    await expect(service.ingest({gameId:game.gameId,input:changed},game.hostToken)).rejects.toMatchObject({status:409});
    await expect(service.ingest({gameId:game.gameId,input:feed([],0)},game.hostToken)).rejects.toMatchObject({status:409});
    await expect(service.ingest({gameId:game.gameId,input:feed([kill(1,'Bob','Alice')],13)},game.hostToken)).rejects.toMatchObject({status:409});
  });
  test('all mutations and status require the owner token',async()=>{
    await setup();
    for(const fn of [()=>service.status(a.playerId,b.playerToken),()=>service.joinTeam({player:a.playerId,team:teams[1].teamId},b.playerToken),()=>service.chooseChampion({player:a.playerId,champion:champions[1].championId},b.playerToken),()=>service.deletePlayer({id:a.playerId},b.playerToken)]) await expect(fn()).rejects.toMatchObject({status:403});
    expect(JSON.stringify(await service.getTeams(game.gameId))).not.toMatch(/Token|feedSnapshot/);
  });
  test('team changes with a champion and same-champion timer resets are conflicts',async()=>{
    await setup();
    await expect(service.joinTeam({player:a.playerId,team:teams[1].teamId},a.playerToken)).rejects.toMatchObject({status:409});
    await expect(service.chooseChampion({player:a.playerId,champion:champions[0].championId},a.playerToken)).rejects.toMatchObject({status:409});
    await expect(service.chooseChampion({player:a.playerId,champion:champions[1].championId},a.playerToken)).rejects.toMatchObject({status:409});
  });
  test('kills and deaths never unlock rotation or reset either champion timer',async()=>{
    await setup();
    await service.ingest({gameId:game.gameId,input:feed([kill(1),kill(2),kill(3,'Bob#EUW','Alice#EUW')],30)},game.hostToken);
    for (const player of [a,b]) {
      expect(await service.status(player.playerId,player.playerToken)).toMatchObject({rotationRemainingSeconds:160,rotationAvailable:false});
    }
    await expect(service.chooseChampion({player:a.playerId,champion:champions[1].championId,killCounter:0},a.playerToken)).rejects.toMatchObject({status:409});
  });
  test('time rotation fixes the duration server-side without requiring a kill/death counter', async () => {
    await setup();
    expect(await service.getSettings(game.gameId)).toMatchObject({
      rotationDurationSeconds: 180,
      settings: { rotationDurationSeconds: 180 },
    });
    const status = await service.status(a.playerId, a.playerToken);
    expect(status).not.toHaveProperty('counter');
    expect(status).not.toHaveProperty('rotationMode');
    expect(status).toMatchObject({
      rotationAvailable: false, rotationRemainingSeconds: 180,
      champion: { rotationEndsAtGameTime: 190 },
    });
    await expect(service.chooseChampion({ player: a.playerId, champion: champions[1].championId, counter: 0 }, a.playerToken))
      .rejects.toMatchObject({ status: 409 });
  });
  test('time rotation expires at exactly three game minutes, resets on takeover and clears the old timer', async () => {
    await setup();
    await service.ingest({ gameId: game.gameId, input: feed([], 189.5) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 0.5, rotationAvailable: false });
    await expect(service.chooseChampion({ player: a.playerId, champion: champions[1].championId }, a.playerToken))
      .rejects.toMatchObject({ status: 409 });
    await service.ingest({ gameId: game.gameId, input: feed([], 190) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 0, rotationAvailable: true });
    await expect(service.chooseChampion({ player: a.playerId, champion: champions[0].championId }, a.playerToken))
      .rejects.toMatchObject({ status: 409 });
    const selected = await service.chooseChampion({ player: a.playerId, champion: champions[1].championId, rotationEndsAtGameTime: 99999 }, a.playerToken);
    expect(selected.rotationEndsAtGameTime).toBe(370);
    const all = await service.getAllChampions(game.gameId);
    expect(all.blue[0]).toMatchObject({ player: null, rotationEndsAtGameTime: null });
    const third = await service.createPlayer({ playerName: 'Third', gameCode: game.gameCode });
    await service.joinTeam({ player: third.playerId, team: teams[0].teamId }, third.playerToken);
    await service.ingest({ gameId: game.gameId, input: feed([], 200) }, game.hostToken);
    await service.chooseChampion({ player: third.playerId, champion: champions[0].championId }, third.playerToken);
    expect(await service.status(third.playerId, third.playerToken)).toMatchObject({ rotationRemainingSeconds: 180, champion: { rotationEndsAtGameTime: 380 } });
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 170, champion: { rotationEndsAtGameTime: 370 } });
  });
  test('time rotation survives restart and unchanged clocks without using wall time or combat counters', async () => {
    await setup();
    await service.ingest({ gameId: game.gameId, input: feed([kill(1), kill(2)], 30) }, game.hostToken);
    service = new Service(db as any);
    // Even an old/stale feed never advances the game clock by itself.
    db.all(Game)[0].lastFeedAt = new Date(0);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ feedStale: true, rotationRemainingSeconds: 160, rotationAvailable: false });
    await service.ingest({ gameId: game.gameId, input: feed([kill(1), kill(2)], 30) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 160, rotationAvailable: false });
  });
  test('future deadline adjustments extend or shorten only the affected champion', async () => {
    await setup();
    const champion = db.all(Champion).find(row => row.championId === champions[0].championId);
    champion.rotationEndsAtGameTime += 60;
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 240, rotationAvailable: false });
    expect(await service.status(b.playerId, b.playerToken)).toMatchObject({ rotationRemainingSeconds: 180 });
    await service.ingest({ gameId: game.gameId, input: feed([], 190) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 60, rotationAvailable: false });
    // A shortening effect can expire a timer immediately; status and selection agree.
    db.all(Champion).find(row => row.championId === champions[0].championId).rotationEndsAtGameTime -= 90;
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 0, rotationAvailable: true });
    await service.chooseChampion({ player: a.playerId, champion: champions[1].championId }, a.playerToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 180 });
  });
  test('time mode waits for a real game clock and never allows a switch after GameEnd', async () => {
    game = await service.runGame(settings);
    const input = feed(); delete input.gameData.gameTime;
    await service.ingest({ gameId: game.gameId, input }, game.hostToken);
    a = await service.createPlayer({ playerName: 'Timed', gameCode: game.gameCode });
    teams = (await service.getTeams(game.gameId)).teams;
    champions = await service.getAllChampions(game.gameId);
    await service.joinTeam({ player: a.playerId, team: teams[0].teamId }, a.playerToken);
    await expect(service.chooseChampion({ player: a.playerId, champion: champions[0].championId }, a.playerToken))
      .rejects.toMatchObject({ status: 409 });
    await service.ingest({ gameId: game.gameId, input: feed([], 0) }, game.hostToken);
    await service.chooseChampion({ player: a.playerId, champion: champions[0].championId }, a.playerToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 180 });
    await service.ingest({ gameId: game.gameId, input: feed([{ EventID: 1, EventName: 'GameEnd', EventTime: 200 }], 200) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 0, rotationAvailable: false });
    await expect(service.chooseChampion({ player: a.playerId, champion: champions[1].championId }, a.playerToken))
      .rejects.toMatchObject({ status: 409 });
  });
  test('legacy owners without a clock get a timer once game time arrives', async () => {
    await setup();
    db.all(Game)[0].lastGameTime = null;
    const champion = db.all(Champion).find(row => row.championId === champions[0].championId);
    champion.rotationEndsAtGameTime = null;
    await service.ingest({ gameId: game.gameId, input: feed([], 50) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 180, champion: { rotationEndsAtGameTime: 230 } });
    await service.ingest({ gameId: game.gameId, input: feed([], 60) }, game.hostToken);
    expect(await service.status(a.playerId, a.playerToken)).toMatchObject({ rotationRemainingSeconds: 170, champion: { rotationEndsAtGameTime: 230 } });
  });
  test('serializes concurrent rotation and cannot clear a newer champion owner',async()=>{
    await setup();
    await service.ingest({gameId:game.gameId,input:feed([kill(1),kill(2)],190)},game.hostToken);
    const third=await service.createPlayer({playerName:'Third',gameCode:game.gameCode});
    await service.joinTeam({player:third.playerId,team:teams[0].teamId},third.playerToken);
    const attempts=await Promise.allSettled([
      service.chooseChampion({player:a.playerId,champion:champions[1].championId},a.playerToken),
      service.chooseChampion({player:third.playerId,champion:champions[1].championId},third.playerToken),
    ]);
    expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(attempts.filter(result=>result.status==='rejected').map(result=>(result as any).reason.status)).toEqual([409]);
    const selected=await service.getAllChampions(game.gameId);
    const winnerId=(attempts.find(result=>result.status==='fulfilled') as any).value.player.playerId;
    expect(selected.blue.find((champion:any)=>champion.championId===champions[1].championId).player).toMatchObject({playerId:winnerId});
  });
  test('serializes concurrent feeds without timer changes or duplicate consequences',async()=>{
    await setup(); await Promise.all([service.ingest({gameId:game.gameId,input:feed([kill(1)])},game.hostToken),service.ingest({gameId:game.gameId,input:feed([kill(1),kill(2)])},game.hostToken)]);
    expect(db.all(Reward)).toHaveLength(2); expect((await service.status(a.playerId,a.playerToken)).rotationRemainingSeconds).toBe(180);
  });
  test('one reward atomically produces one server-authoritative enemy penalty',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken);
    const request={id:db.all(Reward)[0].rewardId,punishment:{recipient:{playerId:b.playerId},amount:-99,punishmentType:88,distributor:{playerId:999}}};
    const results=await Promise.allSettled([service.confirmReward(request,a.playerToken),service.confirmReward(request,a.playerToken)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((results.find(r=>r.status==='rejected') as any).reason.status).toBe(409);
    expect(db.all(Punishment).filter(p=>p.punishmentType===0)).toHaveLength(1);
    expect(db.all(Punishment).find(p=>p.punishmentType===0)).toMatchObject({amount:9,distributor:{playerId:a.playerId},player:{playerId:b.playerId}});
  });
  test('two distinct rewards can each be consumed exactly once',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill(1),kill(2)])},game.hostToken);
    for(const r of db.all(Reward)) await service.confirmReward({id:r.rewardId,punishment:{recipient:{playerId:b.playerId}}},a.playerToken);
    expect(db.all(Punishment).filter(p=>p.punishmentType===0)).toHaveLength(2);
  });
  test('reward auth, recipient validation and failure do not consume rewards',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken); const id=db.all(Reward)[0].rewardId;
    await expect(service.confirmReward({id,punishment:{recipient:{playerId:b.playerId}}},b.playerToken)).rejects.toMatchObject({status:403});
    await expect(service.confirmReward({id,punishment:{recipient:{playerId:a.playerId}}},a.playerToken)).rejects.toMatchObject({status:400});
    db.failOn=Punishment; await expect(service.confirmReward({id,punishment:{recipient:{playerId:b.playerId}}},a.playerToken)).rejects.toThrow('injected');
    expect(db.all(Reward)[0].distributed).toBe(false);
  });
  test('punishment confirmation is owned and awaited; deletion rejects combat history',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken); const id=db.all(Punishment)[0].punishmentId;
    await expect(service.confirmPunishment({id},a.playerToken)).rejects.toMatchObject({status:403});
    await service.confirmPunishment({id},b.playerToken); expect(db.all(Punishment)[0].recieved).toBe(true);
    await expect(service.deletePlayer({id:b.playerId},b.playerToken)).rejects.toMatchObject({status:409});
  });
  test('missing/deleted player is a controlled 404 and unselected champion is null',async()=>{
    game=await service.runGame(settings); a=await service.createPlayer({playerName:'Alex',gameCode:game.gameCode});
    expect(await service.status(a.playerId,a.playerToken)).toMatchObject({champion:null,team:null,kda:[0,0,0],feedStale:true});
    await service.deletePlayer({id:a.playerId},a.playerToken);
    await expect(service.status(a.playerId,a.playerToken)).rejects.toMatchObject({status:404});
  });
  test('rejects malformed snapshots before creating roster state',async()=>{
    const g=await service.runGame(settings);
    const malformed=feed(); malformed.allPlayers.push({...malformed.allPlayers[0],championName:'Zed'});
    await expect(service.ingest({gameId:g.gameId,input:malformed},g.hostToken)).rejects.toMatchObject({status:400});
    const badEvent=feed([{EventID:1,EventName:'ChampionKill',KillerName:'Alice',VictimName:'Bob',Assisters:[null]}]);
    await expect(service.ingest({gameId:g.gameId,input:badEvent},g.hostToken)).rejects.toMatchObject({status:400});
    expect(db.all(Champion)).toHaveLength(0);
  });
  test('persists event consequence links and allows an exact ended-feed replay only',async()=>{
    await setup();
    const ended=feed([{EventID:1,EventName:'GameEnd',EventTime:10,Result:'Win'}],10);
    await service.ingest({gameId:game.gameId,input:ended},game.hostToken);
    await service.ingest({gameId:game.gameId,input:ended},game.hostToken);
    expect((await service.status(a.playerId,a.playerToken)).gameState).toBe('ended');
    expect(db.all(Event)[0].takedown).toBeUndefined();
    await expect(service.createPlayer({playerName:'Late',gameCode:game.gameCode})).rejects.toMatchObject({status:409});
    await expect(service.ingest({gameId:game.gameId,input:feed([{EventID:2,EventName:'GameEnd',EventTime:11}],11)},game.hostToken)).rejects.toMatchObject({status:409});
    await expect(service.joinTeam({player:a.playerId,team:teams[0].teamId},a.playerToken)).rejects.toMatchObject({status:409});
    await expect(service.chooseChampion({player:a.playerId,champion:champions[1].championId},a.playerToken)).rejects.toMatchObject({status:409});
  });
  test('accepts real event zero and exact final-snapshot replay after restart', async () => {
    await setup();
    const input = feed([{EventID:0,EventName:'GameStart',EventTime:0}, kill(1), {EventID:2,EventName:'GameEnd',EventTime:10}], 10);
    await service.ingest({gameId:game.gameId,input},game.hostToken);
    service = new Service(db as any);
    await service.ingest({gameId:game.gameId,input},game.hostToken);
    expect(db.all(Event)).toHaveLength(3);
    expect(db.all(Reward)).toHaveLength(1);
  });
  test('tagless roster replay never duplicates champions', async () => {
    const g = await service.runGame(settings);
    const input = feed();
    input.allPlayers.forEach(p => delete p.riotIdTagLine);
    await service.ingest({gameId:g.gameId,input},g.hostToken);
    await service.ingest({gameId:g.gameId,input},g.hostToken);
    expect(db.all(Champion)).toHaveLength(4);
  });
  test('rejects malformed assist lists with controlled rollback', async () => {
    await setup();
    await expect(service.ingest({gameId:game.gameId,input:feed([{...kill(),Assisters:{bad:true}}])},game.hostToken)).rejects.toMatchObject({status:400});
    expect(db.all(Event)).toHaveLength(0);
  });
  test('ambiguous participant names never silently credit the first champion', async () => {
    const g = await service.runGame(settings);
    const input = feed();
    input.allPlayers[1].riotIdGameName = 'Alice';
    input.allPlayers[1].riotIdTagLine = 'OTHER';
    await service.ingest({gameId:g.gameId,input},g.hostToken);
    input.events.Events = [{...kill(1,'Alice'), Assisters: []}];
    await expect(service.ingest({gameId:g.gameId,input},g.hostToken)).rejects.toMatchObject({status:400});
    expect(db.all(Takedown)).toHaveLength(0);
  });
  test('participant aliases resolve before environment-name prefixes', async () => {
    const g = await service.runGame(settings);
    const input = feed();
    input.allPlayers[0].riotIdGameName = 'Baroness';
    await service.ingest({gameId:g.gameId,input},g.hostToken);
    input.events.Events = [{...kill(1,'Baroness#EUW'),Assisters:[]}];
    await service.ingest({gameId:g.gameId,input},g.hostToken);
    expect(db.all(Takedown)[0].killer.championName).toBe('Ahri');
  });
  test('source changes and malformed events are controlled without advancing feed progress', async () => {
    await setup();
    const changed = feed(); changed.gameData.mapNumber = 12;
    await expect(service.ingest({gameId:game.gameId,input:changed},game.hostToken)).rejects.toMatchObject({status:409});
    await expect(service.ingest({gameId:game.gameId,input:feed([null,kill()])},game.hostToken)).rejects.toMatchObject({status:400});
    expect(db.all(Event)).toHaveLength(0);
  });
  test('environment kills neither reward nor prevent deletion of unselected lobby players', async () => {
    await setup();
    const lobby = await service.createPlayer({playerName:'Lobby',gameCode:game.gameCode});
    await service.ingest({gameId:game.gameId,input:feed([kill(1,'Minion_T100_L0')])},game.hostToken);
    expect(db.all(Reward)).toHaveLength(0);
    await service.deletePlayer({id:lobby.playerId},lobby.playerToken);
  });
  test('stores durable takedown, reward and punishment relations for a champion kill',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken);
    const event=db.all(Event)[0]; const takedown=db.all(Takedown)[0];
    expect(event.takedown).toBe(takedown);
    expect(takedown.reward).toBe(db.all(Reward)[0]);
    expect(takedown.punishment).toBe(db.all(Punishment)[0]);
  });
});
