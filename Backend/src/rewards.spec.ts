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
  test('five pools of eight, shared support pool, four safe/four risky, and shield-breaking invariants', () => {
    expect(['standard', 'revenge', 'turret', 'epic', 'legendary'].map(key => config.pools[key].length)).toEqual([8, 8, 8, 8, 8]);
    expect(config.pools.pentakill).toHaveLength(1);
    expect(config.pools.revenge.filter(row => row.tier === 'small')).toHaveLength(4);
    expect(config.pools.revenge.filter(row => row.tier === 'risky')).toHaveLength(4);
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
    for (const expectedVersion of [0, 1]) {
      const tap = { id: reward.rewardId, recipientId: opponents[0].playerId, unit: 'sips', expectedVersion };
      const both = await Promise.all([service.distributeReward(tap, owner.playerToken), service.distributeReward(tap, owner.playerToken)]);
      expect(both[0].distribution.version).toBe(expectedVersion + 1);
      expect(both[1].distribution.version).toBe(expectedVersion + 1);
    }
    expect(db.all(Punishment)).toHaveLength(2);
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
  test('successful champion extension and immediate sacrifice are persisted exactly once', async () => {
    const { reward } = await offer('standard', 'encore');
    const request = { id: reward.rewardId, choiceId: 'encore' };
    await service.chooseReward(request, owner.playerToken);
    await service.chooseReward(request, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).rotationRemainingSeconds).toBe(300);
    const sacrifice = await offer('standard', 'champions-sacrifice');
    await service.chooseReward({ id: sacrifice.reward.rewardId, choiceId: sacrifice.choice.id }, owner.playerToken);
    expect((await service.status(owner.playerId, owner.playerToken)).champion).toBeNull();
    expect(db.all(Reward).find(row => row.rewardId === sacrifice.reward.rewardId).distributed).toBe(false);
  });
  test('revenge backfire cannot reroll and prolongs the champion exactly once', async () => {
    const { reward } = await offer('revenge', 'jackpot-or-disaster');
    jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(999_999_999);
    const request = { id: reward.rewardId, choiceId: 'jackpot-or-disaster' };
    expect(await service.chooseReward(request, owner.playerToken)).toMatchObject({ distributed: true, distribution: { outcome: 'backfire' } });
    await new GameflowService(db as any).chooseReward(request, owner.playerToken);
    expect(db.all(Punishment)).toHaveLength(1);
    expect(db.all(Punishment)[0]).toMatchObject({ unit: 'shots', amount: 1 });
    expect((await service.status(owner.playerId, owner.playerToken)).rotationRemainingSeconds).toBe(300);
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
