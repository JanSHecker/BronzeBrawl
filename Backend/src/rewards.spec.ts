import 'reflect-metadata';
import { GameflowService } from './gameflow.service';
import { Game } from './entities/game.entity';
import { Player } from './entities/player.entity';
import { Champion } from './entities/champion.entity';
import { Reward } from './entities/reward.entity';
import { Punishment } from './entities/punishment.entity';
import { MemoryStore } from './testing/memory-store';
import { Difficulty, nextRewardUnit, rewardConfiguration, scaledChoice, scaleAmounts, targetAllowed, unitCount } from './rewards';

const config = rewardConfiguration({});
const roster = [
  { championName: 'Ahri', riotIdGameName: 'Owner', team: 'ORDER' },
  { championName: 'Lux', riotIdGameName: 'Spare', team: 'ORDER' },
  ...['Garen', 'Jinx', 'Ashe'].map(championName => ({ championName, riotIdGameName: championName, team: 'CHAOS' })),
];
const feed = (time = 10, events = []) => ({ allPlayers: roster, events: { Events: events }, gameData: { gameTime: time } });
let db: MemoryStore, service: GameflowService, game: any, owner: any, opponents: any[], champions: any;
async function setup(difficulty: Difficulty = 'baseline') {
  db = new MemoryStore(); service = new GameflowService(db as any);
  game = await service.runGame({ rewardAmount: 2, punishmentAmount: 2, difficulty });
  await service.ingest({ gameId: game.gameId, input: feed() }, game.hostToken);
  const teams = (await service.getTeams(game.gameId)).teams;
  owner = await service.createPlayer({ playerName: 'Owner', gameCode: game.gameCode });
  await service.joinTeam({ player: owner.playerId, team: teams[0].teamId }, owner.playerToken);
  champions = await service.getAllChampions(game.gameId);
  await service.chooseChampion({ player: owner.playerId, champion: champions.blue[0].championId }, owner.playerToken);
  opponents = [];
  for (const champion of champions.red) {
    const player = await service.createPlayer({ playerName: champion.championName, gameCode: game.gameCode });
    await service.joinTeam({ player: player.playerId, team: teams[1].teamId }, player.playerToken);
    await service.chooseChampion({ player: player.playerId, champion: champion.championId }, player.playerToken);
    opponents.push(player);
  }
}
async function offer(pool: string, id: string, difficulty: Difficulty = 'baseline') {
  const choice = scaledChoice(config.pools[pool].find(row => row.id === id), difficulty, config);
  const reward = await db.save(Reward, { player: db.all(Player)[0], amount: 2, chestType: pool, distributed: false,
    openedAt: new Date(), choices: [choice], distribution: null });
  return { choice, reward };
}
afterEach(() => jest.restoreAllMocks());

describe('configurable native-unit reward catalogue', () => {
  test('pool sizes, shared support pool, five small/five risky, and shield-breaking invariants', () => {
    expect(['standard', 'revenge', 'turret', 'epic', 'legendary'].map(key => config.pools[key].length)).toEqual([8, 10, 8, 7, 8]);
    expect(config.pools.pentakill).toHaveLength(1);
    expect(config.pools.revenge.filter(row => row.tier === 'small')).toHaveLength(5);
    expect(config.pools.revenge.filter(row => row.tier === 'risky')).toHaveLength(5);
    expect(config.pools.epic.filter(row => row.breaksShields)).toHaveLength(1);
    expect(config.pools.legendary.every(row => row.breaksShields)).toBe(true);
    expect(JSON.stringify(config.pools)).not.toMatch(/delegate|remove|transfer|cleanse/);
  });
  test.each([
    [{ sips: 5 }, 1, { sips: 5, shots: 0, chugs: 0 }],
    [{ sips: 3 }, 0.5, { sips: 2, shots: 0, chugs: 0 }],
    [{ shots: 1 }, 0.5, { sips: 3, shots: 0, chugs: 0 }],
    [{ shots: 1 }, 1.5, { sips: 3, shots: 1, chugs: 0 }],
    [{ chugs: 1 }, 0.5, { sips: 8, shots: 0, chugs: 0 }],
    [{ chugs: 1 }, 1.5, { sips: 8, shots: 0, chugs: 1 }],
    [{ shots: 1, chugs: 1 }, 0.5, { sips: 10, shots: 0, chugs: 0 }],
  ])('scales %j by %s without promoting sips', (amounts, multiplier, expected) => {
    expect(scaleAmounts(amounts, multiplier)).toEqual(expected);
  });
  test('operator overrides configure amounts, odds, time and conversions', () => {
    const custom = rewardConfiguration({ SIPS_PER_SHOT: '7', SIPS_PER_CHUG: '21', REWARD_CATALOG_OVERRIDES: '{"marked":{"amounts":{"sips":4},"timeSeconds":45}}' });
    expect(scaledChoice(custom.pools.standard[0], 'hard', custom)).toMatchObject({ amounts: { sips: 6 }, timeSeconds: 45 });
    expect(scaleAmounts({ shots: 1 }, 0.5, custom.conversions).sips).toBe(4);
    expect(() => rewardConfiguration({ SIPS_PER_SHOT: '0' })).toThrow();
    expect(() => rewardConfiguration({ REWARD_CATALOG_OVERRIDES: '{"final-boss":{"breaksShields":false}}' })).toThrow();
    expect(() => rewardConfiguration({ REWARD_CATALOG_OVERRIDES: '{"burning-bright":{"perRemainingMinute":1}}' })).toThrow();
  });
  test('Normal reward balance and replacements match the catalogue', () => {
    expect(config.pools.standard).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'marked', amounts: { sips: 3 } }),
      expect.objectContaining({ id: 'crossfire', amounts: { sips: 4 }, minTargets: 2, maxTargets: 2 }),
      expect.objectContaining({ id: 'stray-bullet', mode: 'random', amounts: { sips: 5 } }),
      expect.objectContaining({ id: 'volley', mode: 'enemy_team', amounts: { sips: 1 } }),
      expect.objectContaining({ id: 'close-combat', amounts: { shots: 2 }, selfAmounts: { shots: 1 } }),
      expect.objectContaining({ id: 'burning-bright', amounts: { shots: 1 }, perRemainingMinute: true, forceSwitch: true }),
    ]));
    expect(config.pools.standard.map(row => row.id)).not.toEqual(expect.arrayContaining(['bank-shot']));
    expect(config.pools.standard.map(row => row.id)).not.toEqual(expect.arrayContaining(['champions-sacrifice']));
  });
  test('Epic reward balance and targeting match the catalogue', () => {
    expect(config.pools.epic).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'divide-and-conquer', amounts: { sips: 5 }, perTarget: true, minTargets: 2, maxTargets: 2 }),
      expect.objectContaining({ id: 'monsters-mark', mode: 'random', amounts: { sips: 7 } }),
      expect.objectContaining({ id: 'shockwave', mode: 'enemy_team', amounts: { sips: 3 } }),
      expect.objectContaining({ id: 'monster-hide', mode: 'free', amounts: { sips: 3 }, shield: { shots: 1 } }),
      expect.objectContaining({ id: 'long-hunt', amounts: { sips: 7 }, timeSeconds: 120 }),
      expect.objectContaining({ id: 'monster-trade', amounts: { shots: 1 }, perTarget: true, minTargets: 2, maxTargets: 2, timeSeconds: -60 }),
    ]));
    expect(config.pools.epic.map(row => row.id)).not.toContain('pincer-attack');
  });
  test('Legendary reward balance preserves shield-breaking, timers and personal costs', () => {
    expect(config.pools.legendary).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'last-stand', mode: 'split', amounts: { chugs: 1 }, perTarget: true, minTargets: 2, maxTargets: 2, forceSwitch: true, breaksShields: true }),
      expect.objectContaining({ id: 'royal-tribute', mode: 'split', amounts: { shots: 1 }, perTarget: true, minTargets: 3, maxTargets: 3, timeSeconds: -120, breaksShields: true }),
      expect.objectContaining({ id: 'royal-volley', mode: 'enemy_team', amounts: { shots: 1 }, breaksShields: true }),
      expect.objectContaining({ id: 'chaos-crown', mode: 'split', amounts: { chugs: 1 }, selfAmounts: { chugs: 1 }, perTarget: true, minTargets: 3, maxTargets: 3, breaksShields: true }),
    ]));
  });
  test.each(['easy', 'baseline', 'hard', 'terror'] as Difficulty[])('shield grants never exceed ten at %s, including overrides', difficulty => {
    const custom = rewardConfiguration({ REWARD_CATALOG_OVERRIDES: '{"pocket-shield":{"shield":{"sips":100}}}' });
    expect(scaledChoice(custom.pools.standard.find(row => row.id === 'pocket-shield'), difficulty, custom).shieldPoints).toBe(10);
    expect(scaledChoice(config.pools.pentakill[0], difficulty, config).shieldPoints).toBe(Math.min(10, Math.ceil(10 * config.multipliers[difficulty])));
  });

  for (const difficulty of ['easy', 'baseline', 'hard', 'terror'] as Difficulty[]) {
    for (const [pool, entries] of Object.entries(config.pools)) {
      test.each(entries.map(choice => [choice.id]))(`${difficulty} ${pool}: %s resolves with conserved budgets and ordered native units`, async id => {
        await setup(difficulty);
        const { reward, choice } = await offer(pool, id, difficulty);
        if (choice.minTargets && !choice.perTarget && unitCount(choice.amounts) < choice.minTargets) {
          // A fixed-total split too small for its target count is excluded, not rounded up per recipient.
          await expect(service.chooseReward({ id: reward.rewardId, choiceId: id }, owner.playerToken)).rejects.toMatchObject({ status: 409 });
          return;
        }
        jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(0);
        let result = await service.chooseReward({ id: reward.rewardId, choiceId: id }, owner.playerToken);
        let iterations = 0;
        while (!result.distributed) {
          const state = result.distribution;
          const player = opponents.find(row => targetAllowed(choice, state, row.playerId));
          expect(player).toBeDefined();
          result = await service.distributeReward({ id: reward.rewardId, recipientId: player.playerId, unit: nextRewardUnit(state.remaining), expectedVersion: state.version }, owner.playerToken);
          expect(++iterations).toBeLessThan(200);
        }
        expect(unitCount(result.distribution.remaining)).toBe(0);
        expect(db.all(Punishment).every(row => Number.isInteger(row.amount) && row.amount > 0)).toBe(true);
        if (choice.perTarget) {
          expect(Object.keys(result.distribution.targets)).toHaveLength(choice.minTargets);
          for (const amounts of Object.values(result.distribution.targets)) expect(amounts).toEqual(choice.amounts);
        }
        expect(() => JSON.stringify(result)).not.toThrow();
      });
    }
  }
});

describe('durable choices, shields, forced rotation and tap security', () => {
  beforeEach(() => setup());
  test.each([0, 9, 10])('stacked shield grants cap at ten from %s and retries do not reapply', async initial => {
    const player = db.all(Player).find(row => row.playerId === owner.playerId);
    player.shield = initial;
    const { reward } = await offer('standard', 'pocket-shield');
    const request = { id: reward.rewardId, choiceId: 'pocket-shield' };
    await service.chooseReward(request, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).player.shield).toBe(Math.min(10, initial + 2));
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).player.shield).toBe(Math.min(10, initial + 2));
  });
  test('previously saved oversized offers cannot bypass the total shield cap', async () => {
    const { reward } = await offer('standard', 'pocket-shield');
    reward.choices[0].shieldPoints = 20;
    await db.save(Reward, reward);
    await service.chooseReward({ id: reward.rewardId, choiceId: 'pocket-shield' }, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).player.shield).toBe(10);
  });
  test('two distinct offers persist across restart; revenge always offers small versus risky', async () => {
    for (const pool of ['standard', 'support', 'revenge', 'turret', 'epic', 'legendary']) {
      const row = await db.save(Reward, { player: db.all(Player)[0], chestType: pool, amount: 2, distributed: false, choices: [] });
      const first = await service.openChest({ id: row.rewardId }, owner.playerToken);
      expect(first.choices).toHaveLength(2);
      expect(first.choices[0].id).not.toBe(first.choices[1].id);
      expect(await new GameflowService(db as any).openChest({ id: row.rewardId }, owner.playerToken)).toEqual(first);
      if (pool === 'revenge') expect(first.choices.map(row => row.tier)).toEqual(['small', 'risky']);
      if (['support', 'turret'].includes(pool)) expect(first.choices.every(row => config.pools.standard.some(choice => choice.id === row.id))).toBe(true);
    }
  });
  test('duplicate selection and duplicate taps are idempotent, including the final tap', async () => {
    const { reward } = await offer('standard', 'marked');
    const choose = { id: reward.rewardId, choiceId: 'marked' };
    await Promise.all([service.chooseReward(choose, owner.playerToken), service.chooseReward(choose, owner.playerToken)]);
    for (const expectedVersion of [0, 1, 2]) {
      const tap = { id: reward.rewardId, recipientId: opponents[0].playerId, unit: 'sips', expectedVersion };
      const both = await Promise.all([service.distributeReward(tap, owner.playerToken), service.distributeReward(tap, owner.playerToken)]);
      expect(both[0].distribution.version).toBe(expectedVersion + 1);
      expect(both[1].distribution.version).toBe(expectedVersion + 1);
    }
    expect(db.all(Punishment)).toHaveLength(3);
  });
  test('choice and target tampering, teammate targets, wrong units and legacy bypass are rejected', async () => {
    const { reward } = await offer('standard', 'marked');
    await expect(service.chooseReward({ id: reward.rewardId, choiceId: 'invented' }, owner.playerToken)).rejects.toMatchObject({ status: 400 });
    await expect(service.chooseReward({ id: reward.rewardId, choiceId: 'marked' }, opponents[0].playerToken)).rejects.toMatchObject({ status: 403 });
    await expect(service.confirmReward({ id: reward.rewardId, punishment: { recipient: { playerId: opponents[0].playerId } } }, owner.playerToken)).rejects.toMatchObject({ status: 400 });
    await service.chooseReward({ id: reward.rewardId, choiceId: 'marked' }, owner.playerToken);
    const tap = { id: reward.rewardId, expectedVersion: 0, unit: 'sips', recipientId: owner.playerId };
    await expect(service.distributeReward(tap, owner.playerToken)).rejects.toMatchObject({ status: 403 });
    await expect(service.distributeReward({ ...tap, recipientId: opponents[0].playerId, unit: 'shots' }, owner.playerToken)).rejects.toMatchObject({ status: 400 });
    expect(db.all(Punishment)).toHaveLength(0);
  });
  test('a one-sip breaking hit destroys ALL 100 shield points and deals its full punishment', async () => {
    db.all(Player).find(row => row.playerId === opponents[0].playerId).shield = 100;
    const { reward } = await offer('legendary', 'kings-decree');
    await service.chooseReward({ id: reward.rewardId, choiceId: 'kings-decree' }, owner.playerToken);
    const result = await service.distributeReward({ id: reward.rewardId, expectedVersion: 0, unit: 'sips', recipientId: opponents[0].playerId }, owner.playerToken);
    expect(result.distribution.lastResult).toMatchObject({ shieldBefore: 100, shield: 0, shieldBroken: true, assigned: { sips: 1 } });
    expect(db.all(Punishment)[0]).toMatchObject({ amount: 1, unit: 'sips' });
  });
  test('shields absorb only new punishments and partial shots become whole sips', async () => {
    const recipient = db.all(Player).find(row => row.playerId === opponents[0].playerId);
    recipient.shield = 2;
    const old = await db.save(Punishment, { amount: 9, remainingAmount: 9, unit: 'sips', player: recipient, recieved: false });
    const { reward } = await offer('epic', 'monster-trade');
    await service.chooseReward({ id: reward.rewardId, choiceId: 'monster-trade' }, owner.playerToken);
    await service.distributeReward({ id: reward.rewardId, expectedVersion: 0, unit: 'shots', recipientId: recipient.playerId }, owner.playerToken);
    expect(db.all(Punishment).find(row => row.punishmentId === old.punishmentId).remainingAmount).toBe(9);
    expect(db.all(Punishment)[1]).toMatchObject({ unit: 'sips', amount: 3 });
    expect(recipient.shield).toBe(0);
  });
  test('expiry releases ownership and prohibits selecting the same champion, including restart', async () => {
    await service.ingest({ gameId: game.gameId, input: feed(190) }, game.hostToken);
    const status = await new GameflowService(db as any).status(owner.playerId, owner.playerToken);
    expect(status).toMatchObject({ champion: null, rotationAvailable: true, player: { previousChampionId: champions.blue[0].championId } });
    expect(db.all(Champion)[0].player).toBeNull();
    await expect(service.chooseChampion({ player: owner.playerId, champion: champions.blue[0].championId }, owner.playerToken)).rejects.toMatchObject({ status: 409 });
    await service.chooseChampion({ player: owner.playerId, champion: champions.blue[1].championId }, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).rotationRemainingSeconds).toBe(180);
  });
  test('successful champion extension and Burning Bright switch are persisted exactly once', async () => {
    const { reward } = await offer('standard', 'encore');
    const request = { id: reward.rewardId, choiceId: 'encore' };
    await service.chooseReward(request, owner.playerToken);
    await service.chooseReward(request, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).rotationRemainingSeconds).toBe(300);
    const burning = await offer('standard', 'burning-bright');
    const choose = { id: burning.reward.rewardId, choiceId: burning.choice.id };
    expect((await service.chooseReward(choose, owner.playerToken)).distribution.remaining.shots).toBe(5);
    expect((await new GameflowService(db as any).chooseReward(choose, owner.playerToken)).distribution.remaining.shots).toBe(5);
    expect((await service.status(owner.playerId, owner.playerToken)).champion).toBeNull();
    expect(db.all(Reward).find(row => row.rewardId === burning.reward.rewardId).distributed).toBe(false);
  });
  test.each([[180, 3], [120.1, 3], [120, 2], [60.1, 2], [60, 1], [0.5, 1]])(
    'Burning Bright rounds %s remaining seconds up to %s shots at commitment', async (seconds, shots) => {
      const { reward } = await offer('standard', 'burning-bright');
      await service.ingest({ gameId: game.gameId, input: feed(190 - seconds) }, game.hostToken);
      const request = { id: reward.rewardId, choiceId: 'burning-bright' };
      let result = await service.chooseReward(request, owner.playerToken);
      expect(result.distribution.remaining).toEqual({ sips: 0, shots, chugs: 0 });
      expect(await service.status(owner.playerId, owner.playerToken)).toMatchObject({ champion: null, player: { previousChampionId: champions.blue[0].championId } });
      await expect(service.chooseChampion({ player: owner.playerId, champion: champions.blue[0].championId }, owner.playerToken)).rejects.toMatchObject({ status: 409 });
      await service.chooseChampion({ player: owner.playerId, champion: champions.blue[1].championId }, owner.playerToken);
      expect((await new GameflowService(db as any).chooseReward(request, owner.playerToken)).distribution.remaining.shots).toBe(shots);
      for (let expectedVersion = 0; expectedVersion < shots; expectedVersion++) {
        result = await service.distributeReward({ id: reward.rewardId, recipientId: opponents[0].playerId, unit: 'shots', expectedVersion }, owner.playerToken);
      }
      expect(result.distributed).toBe(true);
      expect((await service.status(opponents[0].playerId, opponents[0].playerToken)).punishmentTotals.shots).toBe(shots);
    });
  test('Volley hits every enemy once, without hitting the owner or breaking shields', async () => {
    db.all(Player).find(row => row.playerId === opponents[0].playerId).shield = 1;
    const { reward } = await offer('standard', 'volley');
    const request = { id: reward.rewardId, choiceId: 'volley' };
    expect((await service.chooseReward(request, owner.playerToken)).distributed).toBe(true);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    for (const [index, player] of opponents.entries()) {
      const status = await service.status(player.playerId, player.playerToken);
      expect(status.punishmentTotals.sips).toBe(index === 0 ? 0 : 1);
      expect(status.player.shield).toBe(0);
    }
    expect((await service.status(owner.playerId, owner.playerToken)).punishmentTotals).toEqual({ sips: 0, shots: 0, chugs: 0 });
  });
  test('Close Combat charges one shot once and deals two shots to one enemy', async () => {
    const { reward } = await offer('standard', 'close-combat');
    const request = { id: reward.rewardId, choiceId: 'close-combat' };
    await service.chooseReward(request, owner.playerToken);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).punishmentTotals.shots).toBe(1);
    await service.distributeReward({ id: reward.rewardId, recipientId: opponents[0].playerId, unit: 'shots', expectedVersion: 0 }, owner.playerToken);
    await expect(service.distributeReward({ id: reward.rewardId, recipientId: opponents[1].playerId, unit: 'shots', expectedVersion: 1 }, owner.playerToken)).rejects.toMatchObject({ status: 400 });
    expect((await service.distributeReward({ id: reward.rewardId, recipientId: opponents[0].playerId, unit: 'shots', expectedVersion: 1 }, owner.playerToken)).distributed).toBe(true);
    expect((await service.status(opponents[0].playerId, opponents[0].playerToken)).punishmentTotals.shots).toBe(2);
  });
  test('Shockwave gives three sips to each enemy, not a shared total', async () => {
    const { reward } = await offer('epic', 'shockwave');
    const request = { id: reward.rewardId, choiceId: 'shockwave' };
    const result = await service.chooseReward(request, owner.playerToken);
    expect(result.distributed).toBe(true);
    expect(Object.keys(result.distribution.targets)).toHaveLength(opponents.length);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    for (const player of opponents) {
      expect((await service.status(player.playerId, player.playerToken)).punishmentTotals).toEqual({ sips: 3, shots: 0, chugs: 0 });
    }
    expect((await service.status(owner.playerId, owner.playerToken)).punishmentTotals.sips).toBe(0);
  });
  test('Monster Hide grants its shield once and can distribute three sips freely', async () => {
    const { reward } = await offer('epic', 'monster-hide');
    const request = { id: reward.rewardId, choiceId: 'monster-hide' };
    expect((await service.chooseReward(request, owner.playerToken)).distribution.remaining.sips).toBe(3);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).player.shield).toBe(5);
    for (let index = 0; index < opponents.length; index++) {
      const result = await service.distributeReward({ id: reward.rewardId, recipientId: opponents[index].playerId, unit: 'sips', expectedVersion: index }, owner.playerToken);
      expect(result.distributed).toBe(index === 2);
      expect((await service.status(opponents[index].playerId, opponents[index].playerToken)).punishmentTotals.sips).toBe(1);
    }
  });
  test.each([
    ['last-stand', 'chugs', 2, 0],
    ['royal-tribute', 'shots', 3, 60],
    ['chaos-crown', 'chugs', 3, 180],
  ])('%s gives one native unit to each distinct opponent and applies owner effects once', async (id: string, unit: string, targets: number, seconds: number) => {
    for (const player of opponents) db.all(Player).find(row => row.playerId === player.playerId).shield = 10;
    const { reward } = await offer('legendary', id);
    const request = { id: reward.rewardId, choiceId: id };
    let result = await service.chooseReward(request, owner.playerToken);
    expect(result.distribution.remaining[unit]).toBe(targets);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    const ownerStatus = await service.status(owner.playerId, owner.playerToken);
    expect(ownerStatus.rotationRemainingSeconds).toBe(seconds);
    expect(ownerStatus.punishmentTotals).toEqual({ sips: 0, shots: 0, chugs: id === 'chaos-crown' ? 1 : 0 });
    if (id === 'last-stand') expect(ownerStatus.champion).toBeNull();
    for (let index = 0; index < targets; index++) {
      const tap = { id: reward.rewardId, recipientId: opponents[index].playerId, unit, expectedVersion: index };
      result = await service.distributeReward(tap, owner.playerToken);
      await service.distributeReward(tap, owner.playerToken);
      expect(result.distribution.lastResult).toMatchObject({ shieldBefore: 10, shield: 0, shieldBroken: true, assigned: { [unit]: 1 } });
      if (index + 1 < targets) {
        await expect(service.distributeReward({ ...tap, expectedVersion: index + 1 }, owner.playerToken)).rejects.toMatchObject({ status: 400 });
      }
    }
    expect(result.distributed).toBe(true);
    expect(Object.keys(result.distribution.targets)).toHaveLength(targets);
    for (const [index, player] of opponents.entries()) {
      const status = await service.status(player.playerId, player.playerToken);
      expect(status.punishmentTotals[unit]).toBe(index < targets ? 1 : 0);
      expect(status.player.shield).toBe(index < targets ? 0 : 10);
    }
  });
  test('Royal Volley automatically gives every opponent one shot and breaks each shield, once', async () => {
    db.all(Player).find(row => row.playerId === owner.playerId).shield = 10;
    for (const player of opponents) db.all(Player).find(row => row.playerId === player.playerId).shield = 10;
    const { reward } = await offer('legendary', 'royal-volley');
    const request = { id: reward.rewardId, choiceId: 'royal-volley' };
    const result = await service.chooseReward(request, owner.playerToken);
    expect(result.distributed).toBe(true);
    expect(Object.keys(result.distribution.targets)).toHaveLength(opponents.length);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    for (const player of opponents) {
      const status = await service.status(player.playerId, player.playerToken);
      expect(status.punishmentTotals).toEqual({ sips: 0, shots: 1, chugs: 0 });
      expect(status.player.shield).toBe(0);
    }
    const status = await service.status(owner.playerId, owner.playerToken);
    expect(status.player.shield).toBe(10);
    expect(status.punishmentTotals).toEqual({ sips: 0, shots: 0, chugs: 0 });
  });
  test('revenge backfire cannot reroll and prolongs the champion exactly once', async () => {
    const { reward } = await offer('revenge', 'jackpot-or-disaster');
    jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(999_999_999);
    const request = { id: reward.rewardId, choiceId: 'jackpot-or-disaster' };
    expect(await service.chooseReward(request, owner.playerToken)).toMatchObject({ distributed: true, distribution: { outcome: 'backfire' } });
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    expect(db.all(Punishment)).toHaveLength(1);
    expect(db.all(Punishment)[0]).toMatchObject({ unit: 'chugs', amount: 1 });
    expect((await service.status(owner.playerId, owner.playerToken)).rotationRemainingSeconds).toBe(300);
  });
  test('Suicide Bomber assigns one chug to the owner and one opponent, with no duplicate costs', async () => {
    const { reward, choice } = await offer('revenge', 'suicide-bomber');
    expect(choice.tier).toBe('risky');
    const request = { id: reward.rewardId, choiceId: choice.id };
    expect((await service.chooseReward(request, owner.playerToken)).distribution.remaining).toEqual({ sips: 0, shots: 0, chugs: 1 });
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    const tap = { id: reward.rewardId, recipientId: opponents[0].playerId, unit: 'chugs', expectedVersion: 0 };
    expect((await service.distributeReward(tap, owner.playerToken)).distributed).toBe(true);
    await service.distributeReward(tap, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).punishmentTotals).toEqual({ sips: 0, shots: 0, chugs: 1 });
    expect((await service.status(opponents[0].playerId, opponents[0].playerToken)).punishmentTotals).toEqual({ sips: 0, shots: 0, chugs: 1 });
    expect(db.all(Punishment)).toHaveLength(2);
  });
  test.each([[10, 120], [150, 0]])('Short Fuse reduces champion time by sixty seconds at game time %s once', async (time, remaining) => {
    const { reward, choice } = await offer('revenge', 'short-fuse');
    expect(choice.tier).toBe('small');
    await service.ingest({ gameId: game.gameId, input: feed(time) }, game.hostToken);
    const request = { id: reward.rewardId, choiceId: choice.id };
    expect((await service.chooseReward(request, owner.playerToken)).distributed).toBe(true);
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    const status = await service.status(owner.playerId, owner.playerToken);
    expect(status.rotationRemainingSeconds).toBe(remaining);
    if (!remaining) expect(status.champion).toBeNull();
    expect(db.all(Punishment)).toHaveLength(0);
  });
  test('tap failure rolls back shields, budget, version and punishment together', async () => {
    db.all(Player).find(row => row.playerId === opponents[0].playerId).shield = 100;
    const { reward } = await offer('legendary', 'kings-decree');
    await service.chooseReward({ id: reward.rewardId, choiceId: 'kings-decree' }, owner.playerToken);
    db.failOn = Punishment;
    await expect(service.distributeReward({ id: reward.rewardId, expectedVersion: 0, unit: 'sips', recipientId: opponents[0].playerId }, owner.playerToken)).rejects.toThrow('injected');
    expect(db.all(Player).find(row => row.playerId === opponents[0].playerId).shield).toBe(100);
    expect(db.all(Reward)[0].distribution).toMatchObject({ version: 0, remaining: { sips: 12 } });
    expect(db.all(Punishment)).toHaveLength(0);
  });
});
