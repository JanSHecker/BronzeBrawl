import 'reflect-metadata';
import { Game } from './entities/game.entity';
import { Player } from './entities/player.entity';
import { Team } from './entities/team.entity';
import { Champion } from './entities/champion.entity';
import { Event } from './entities/event.entity';
import { Takedown } from './entities/takedown.entity';
import { Reward } from './entities/reward.entity';
import { Punishment } from './entities/punishment.entity';

// A missing implementation is a behavioral failure, not a TypeScript import failure.
let Service: any;
try { Service = require('./gameflow.service').GameflowService; } catch { Service = class {}; }
const keys = new Map<any, string>([[Game,'gameId'],[Player,'playerId'],[Team,'teamId'],[Champion,'championId'],[Event,'eventId'],[Takedown,'takedownId'],[Reward,'rewardId'],[Punishment,'punishmentId']]);
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
const settings={punishmentAmount:7,rewardAmount:9,defaultCounter:2,rotationMode:'Kills'};
let db: MemoryDB, service: any, game: any, a: any, b: any, teams: any, champions: any;
async function setup() {
  game=await service.runGame(settings);
  await service.ingest({gameId:game.gameId,input:feed()},game.hostToken);
  a=await service.createPlayer({playerName:'Alex',game:game.gameId});
  b=await service.createPlayer({playerName:'Alex',game:game.gameId});
  teams=(await service.getTeams(game.gameId)).teams;
  champions=await service.getAllChampions(game.gameId);
  await service.joinTeam({player:a.playerId,team:teams[0].teamId},a.playerToken);
  await service.joinTeam({player:b.playerId,team:teams[1].teamId},b.playerToken);
  await service.chooseChampion({player:a.playerId,champion:champions[0].championId,counter:999},a.playerToken);
  await service.chooseChampion({player:b.playerId,champion:champions[2].championId},b.playerToken);
}
beforeEach(()=>{db=new MemoryDB(); service=new Service(db as any);});
describe('gameflow contract',()=>{
  test('start immediately persists exactly two semantic teams without a feed',async()=>{
    const g=await service.runGame(settings);
    expect(g).toMatchObject({gameId:1,state:'waiting_for_feed',settings:{punishmentAmount:7,rewardAmount:9,defaultCounter:2}});
    expect(g.hostToken).toMatch(/^[a-f0-9]{64}$/);
    expect(db.all(Team).map(t=>t.teamName)).toEqual([0,1]);
    expect(db.all(Game)[0].hostTokenHash).not.toBe(g.hostToken);
    expect(JSON.stringify(await service.getSettings(g.gameId))).not.toMatch(/Token|feedSnapshot/);
  });
  test.each([0,-1,101,'2.5','garbage',null])('rejects invalid amount %p',async(value)=>{
    await expect(service.runGame({...settings,rewardAmount:value})).rejects.toMatchObject({status:400});
    expect(db.all(Game)).toHaveLength(0);
  });
  test('rejects invalid mode',async()=>{await expect(service.runGame({...settings,rotationMode:'Cheat'})).rejects.toMatchObject({status:400});});
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
    expect(s).toMatchObject({kda:[2,0,0],counter:[0,2],gameState:'live',feedStale:false,enemyTeamId:teams[1].teamId,rotationMode:'Kills'});
    expect(s.rewards.map(r=>r.amount)).toEqual([9,9]);
    expect((await service.status(b.playerId,b.playerToken)).punishments.map(p=>p.amount)).toEqual([7,7]);
    expect(await service.kda(champions[1].championId)).toEqual([0,0,2]);
    expect(db.all(Event)).toHaveLength(2);
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
    expect((await service.status(b.playerId,b.playerToken))).toMatchObject({counter:[2,1],kda:[0,1,0]});
  });
  test('rolls back every consequence and retries the same event after write failure',async()=>{
    await setup(); db.failOn=Reward;
    await expect(service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken)).rejects.toThrow('injected');
    expect(db.all(Event)).toHaveLength(0); expect(db.all(Takedown)).toHaveLength(0); expect(db.all(Punishment)).toHaveLength(0);
    await service.ingest({gameId:game.gameId,input:feed([kill()])},game.hostToken);
    expect(db.all(Reward)).toHaveLength(1);
    expect((await service.status(a.playerId,a.playerToken)).counter).toEqual([1,2]);
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
  test('team changes with a champion and same-champion counter resets are conflicts',async()=>{
    await setup();
    await expect(service.joinTeam({player:a.playerId,team:teams[1].teamId},a.playerToken)).rejects.toMatchObject({status:409});
    await expect(service.chooseChampion({player:a.playerId,champion:champions[0].championId},a.playerToken)).rejects.toMatchObject({status:409});
    await expect(service.chooseChampion({player:a.playerId,champion:champions[1].championId},a.playerToken)).rejects.toMatchObject({status:409});
  });
  test('allows rotation only after configured counter is exhausted',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([kill(1),kill(2)])},game.hostToken);
    await service.chooseChampion({player:a.playerId,champion:champions[1].championId,killCounter:999},a.playerToken);
    const s=await service.status(a.playerId,a.playerToken); expect(s.counter).toEqual([2,2]); expect(s.champion.championId).toBe(champions[1].championId);
  });
  test('serializes concurrent feeds without lost counters or duplicate consequences',async()=>{
    await setup(); await Promise.all([service.ingest({gameId:game.gameId,input:feed([kill(1)])},game.hostToken),service.ingest({gameId:game.gameId,input:feed([kill(1),kill(2)])},game.hostToken)]);
    expect(db.all(Reward)).toHaveLength(2); expect((await service.status(a.playerId,a.playerToken)).counter).toEqual([0,2]);
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
    game=await service.runGame(settings); a=await service.createPlayer({playerName:'Alex',game:game.gameId});
    expect(await service.status(a.playerId,a.playerToken)).toMatchObject({champion:null,team:null,kda:[0,0,0],feedStale:true});
    await service.deletePlayer({id:a.playerId},a.playerToken);
    await expect(service.status(a.playerId,a.playerToken)).rejects.toMatchObject({status:404});
  });
  test('GameEnd persists ended state and disallows new gameplay mutations',async()=>{
    await setup(); await service.ingest({gameId:game.gameId,input:feed([{EventID:1,EventName:'GameEnd',EventTime:10,Result:'Win'}])},game.hostToken);
    expect((await service.status(a.playerId,a.playerToken)).gameState).toBe('ended');
    await expect(service.createPlayer({playerName:'Late',game:game.gameId})).rejects.toMatchObject({status:409});
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
    const lobby = await service.createPlayer({playerName:'Lobby',game:game.gameId});
    await service.ingest({gameId:game.gameId,input:feed([kill(1,'Minion_T100_L0')])},game.hostToken);
    expect(db.all(Reward)).toHaveLength(0);
    await service.deletePlayer({id:lobby.playerId},lobby.playerToken);
  });
});
