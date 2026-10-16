import 'reflect-metadata';
import { GameflowService } from './gameflow.service';
import { Player } from './entities/player.entity';
import { Champion } from './entities/champion.entity';
import { Reward } from './entities/reward.entity';
import { Punishment } from './entities/punishment.entity';
import { MemoryStore } from './testing/memory-store';
import { Difficulty, DUMMY_RECIPIENT_ID, nextRewardUnit, rewardConfiguration, scaledChoice, unitCount } from './rewards';

const config = rewardConfiguration({});
const roster = [
  { championName: 'Ahri', riotIdGameName: 'Owner', team: 'ORDER' },
  { championName: 'Lux', riotIdGameName: 'Spare', team: 'ORDER' },
  { championName: 'Garen', riotIdGameName: 'Opponent', team: 'CHAOS' },
];
const feed = (ended = false) => ({ allPlayers: roster, gameData: { gameTime: 10 },
  events: { Events: ended ? [{ EventID: 1, EventName: 'GameEnd', EventTime: 10, Result: 'Win' }] : [] } });

let db: MemoryStore, service: GameflowService, game: any, owner: any, teams: any[];
async function setup(difficulty: Difficulty = 'baseline', selectChampion = true) {
  db = new MemoryStore();
  service = new GameflowService(db as any);
  game = await service.runGame({ rewardAmount: 2, punishmentAmount: 2, difficulty });
  await service.ingest({ gameId: game.gameId, input: feed() }, game.hostToken);
  teams = (await service.getTeams(game.gameId)).teams;
  owner = await service.createPlayer({ playerName: 'Owner', gameCode: game.gameCode });
  await service.joinTeam({ player: owner.playerId, team: teams[0].teamId }, owner.playerToken);
  if (selectChampion) {
    const champions = await service.getAllChampions(game.gameId);
    await service.chooseChampion({ player: owner.playerId, champion: champions.blue[0].championId }, owner.playerToken);
  }
}
async function endGame() {
  await service.ingest({ gameId: game.gameId, input: feed(true) }, game.hostToken);
}
async function savedOffer(pool: string, id: string, difficulty: Difficulty = 'baseline') {
  const choice = scaledChoice(config.pools[pool].find(row => row.id === id), difficulty, config);
  return db.save(Reward, { player: db.all(Player)[0], amount: 2, chestType: pool, distributed: false,
    openedAt: new Date(), choices: [choice], distribution: null });
}
afterEach(() => jest.restoreAllMocks());

describe('solo reward resolution', () => {
  for (const difficulty of ['easy', 'baseline', 'hard', 'terror'] as Difficulty[]) {
    test.each(['standard', 'support', 'revenge', 'turret', 'epic', 'legendary', 'pentakill'])(
      `${difficulty}: %s chests open without any opposing players or an active champion`, async chestType => {
        await setup(difficulty, false);
        const reward = await db.save(Reward, { player: db.all(Player)[0], chestType, amount: 2, distributed: false });
        const opened = await service.openChest({ id: reward.rewardId }, owner.playerToken);
        expect(opened.choices).toHaveLength(chestType === 'pentakill' ? 1 : 2);
        if (chestType === 'revenge') expect(opened.choices.map(row => row.tier)).toEqual(['small', 'risky']);
        if (chestType === 'turret') expect(opened.choices.every(row => config.pools.standard.some(choice => choice.id === row.id))).toBe(true);
      });
  }

  for (const ended of [false, true]) {
    for (const [pool, entries] of Object.entries(config.pools)) {
      test.each(entries.map(choice => [choice.id]))(`${ended ? 'ended' : 'live'} solo ${pool}: %s consumes its whole budget`, async id => {
        await setup('baseline', !ended);
        if (ended) await endGame();
        jest.spyOn(require('crypto'), 'randomInt').mockReturnValue(0);
        const reward = await savedOffer(pool, id);
        let result = await service.chooseReward({ id: reward.rewardId, choiceId: id }, owner.playerToken);
        let taps = 0;
        while (!result.distributed) {
          const request = { id: reward.rewardId, recipientId: DUMMY_RECIPIENT_ID,
            unit: nextRewardUnit(result.distribution.remaining), expectedVersion: result.distribution.version };
          result = await new GameflowService(db as any).distributeReward(request, owner.playerToken);
          expect(await service.distributeReward(request, owner.playerToken)).toEqual(result);
          expect(result.distribution.lastResult).toMatchObject({ dummy: true, punishments: [] });
          expect(++taps).toBeLessThan(100);
        }
        expect(unitCount(result.distribution.remaining)).toBe(0);
        expect(db.all(Player)).toHaveLength(1);
        expect(db.all(Punishment).every(row => row.player.playerId === owner.playerId)).toBe(true);
        if (ended) expect((await service.status(owner.playerId, owner.playerToken)).champion).toBeNull();
      });
    }
  }

  test('dummy taps preserve unit order, authorization and version checks', async () => {
    await setup();
    const reward = await savedOffer('legendary', 'kings-decree');
    await service.chooseReward({ id: reward.rewardId, choiceId: 'kings-decree' }, owner.playerToken);
    const request = { id: reward.rewardId, recipientId: DUMMY_RECIPIENT_ID, unit: 'sips', expectedVersion: 0 };
    await expect(service.distributeReward(request, 'a'.repeat(64))).rejects.toMatchObject({ status: 403 });
    await expect(service.distributeReward({ ...request, unit: 'shots' }, owner.playerToken)).rejects.toMatchObject({ status: 400 });
    await expect(service.distributeReward({ ...request, expectedVersion: 1 }, owner.playerToken)).rejects.toMatchObject({ status: 409 });
    await expect(service.distributeReward({ ...request, recipientId: owner.playerId }, owner.playerToken)).rejects.toMatchObject({ status: 403 });
    expect((await service.distributeReward(request, owner.playerToken)).distribution.version).toBe(1);
    expect(db.all(Punishment)).toHaveLength(0);
  });

  test('a real opponent joining hides the dummy and can finish a partially dummy-assigned reward', async () => {
    await setup();
    const reward = await savedOffer('standard', 'marked');
    await service.chooseReward({ id: reward.rewardId, choiceId: 'marked' }, owner.playerToken);
    await service.distributeReward({ id: reward.rewardId, recipientId: DUMMY_RECIPIENT_ID, unit: 'sips', expectedVersion: 0 }, owner.playerToken);
    const opponent = await service.createPlayer({ playerName: 'Opponent', gameCode: game.gameCode });
    await service.joinTeam({ player: opponent.playerId, team: teams[1].teamId }, opponent.playerToken);
    const request = { id: reward.rewardId, recipientId: DUMMY_RECIPIENT_ID, unit: 'sips', expectedVersion: 1 };
    await expect(service.distributeReward(request, owner.playerToken)).rejects.toMatchObject({ status: 403 });
    await service.distributeReward({ ...request, recipientId: opponent.playerId }, owner.playerToken);
    const result = await service.distributeReward({ ...request, recipientId: opponent.playerId, expectedVersion: 2 }, owner.playerToken);
    expect(result.distributed).toBe(true);
    expect(db.all(Punishment)).toHaveLength(2);
    expect(db.all(Punishment)[0].player.playerId).toBe(opponent.playerId);
  });
});

describe('post-game settlement', () => {
  test('unopened and already committed chests, real assignments and punishment consumption remain usable', async () => {
    await setup();
    const opponent = await service.createPlayer({ playerName: 'Opponent', gameCode: game.gameCode });
    await service.joinTeam({ player: opponent.playerId, team: teams[1].teamId }, opponent.playerToken);
    const reward = await savedOffer('standard', 'marked');
    await service.chooseReward({ id: reward.rewardId, choiceId: 'marked' }, owner.playerToken);
    const deadline = db.all(Champion)[0].rotationEndsAtGameTime;
    await endGame();
    for (const chestType of ['standard', 'revenge', 'epic', 'legendary', 'pentakill']) {
      const chest = await db.save(Reward, { player: db.all(Player)[0], chestType, amount: 2, distributed: false });
      expect((await service.openChest({ id: chest.rewardId }, owner.playerToken)).openedAt).toBeTruthy();
    }
    const timeReward = await savedOffer('standard', 'encore');
    expect((await service.chooseReward({ id: timeReward.rewardId, choiceId: 'encore' }, owner.playerToken)).distributed).toBe(true);
    expect(db.all(Champion)[0].rotationEndsAtGameTime).toBe(deadline);
    for (const expectedVersion of [0, 1, 2]) {
      await service.distributeReward({ id: reward.rewardId, recipientId: opponent.playerId, unit: 'sips', expectedVersion }, owner.playerToken);
    }
    for (const punishment of db.all(Punishment)) {
      await service.consumePunishment({ id: punishment.punishmentId, expectedRemaining: 1 }, opponent.playerToken);
    }
    expect((await service.status(opponent.playerId, opponent.playerToken)).punishmentTotals.sips).toBe(0);
    expect((await service.status(owner.playerId, owner.playerToken)).gameState).toBe('ended');
  });

  test('historical foundation offers can still be assigned to dummy after game end', async () => {
    await setup();
    const reward = await db.save(Reward, { player: db.all(Player)[0], amount: 2, chestType: 'standard', distributed: false,
      openedAt: new Date(), choices: [{ id: 'assign', effect: 'assign', amount: 2 }] });
    await endGame();
    expect(await service.confirmReward({ id: reward.rewardId, punishment: { recipient: { playerId: DUMMY_RECIPIENT_ID } } }, owner.playerToken))
      .toMatchObject({ dummy: true, punishments: [] });
    expect(db.all(Reward)[0].distributed).toBe(true);
    expect(db.all(Punishment)).toHaveLength(0);
  });
});
