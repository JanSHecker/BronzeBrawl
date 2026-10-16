import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const backendRequire = createRequire(resolve(process.cwd(), 'e2e', 'reward-fixtures.js'));
backendRequire('../../Backend/node_modules/reflect-metadata');
const { DataSource } = backendRequire('../../Backend/node_modules/typeorm');
const { ConfigService } = backendRequire('../../Backend/node_modules/@nestjs/config');
const { getDataSourceOptions } = backendRequire('../../Backend/dist/ormconfig');
const { GameflowService } = backendRequire('../../Backend/dist/src/gameflow.service');
export const { rewardConfiguration, scaledChoice, nextRewardUnit } = backendRequire('../../Backend/dist/src/rewards');
export const { Reward } = backendRequire('../../Backend/dist/src/entities/reward.entity');
export const { Player } = backendRequire('../../Backend/dist/src/entities/player.entity');
export const { Punishment } = backendRequire('../../Backend/dist/src/entities/punishment.entity');
export const catalog = rewardConfiguration({});
export const labels = { standard: 'Kills', support: 'Assists', revenge: 'Revenge', turret: 'Turret', epic: 'Grubs / Herald / Dragon', legendary: 'Baron / Elder', pentakill: 'Pentakill' };

// Direct fixture seeding is confined to an explicitly supplied disposable database.
// Player actions under test still use the actual browser -> HTTP -> PostgreSQL path.
export async function fixtureDatabase() {
  if (!process.env.TEST_DATABASE_URL || process.env.NODE_ENV !== 'test') throw new Error('Real browser reward tests require NODE_ENV=test and TEST_DATABASE_URL');
  const database = new DataSource(getDataSourceOptions(new ConfigService()));
  await database.initialize();
  return database;
}

export async function setupRewardGame(database, difficulty = 'baseline') {
  const service = new GameflowService(database);
  const game = await service.runGame({ rewardAmount: 2, punishmentAmount: 2, difficulty });
  const roster = [
    { championName: 'Ahri', riotIdGameName: 'BrowserOwner', team: 'ORDER' },
    { championName: 'Lux', riotIdGameName: 'BrowserSpare', team: 'ORDER' },
    ...['Garen', 'Jinx', 'Ashe'].map(championName => ({ championName, riotIdGameName: `Browser${championName}`, team: 'CHAOS' })),
  ];
  const feed = time => ({ allPlayers: roster, events: { Events: [] }, gameData: { gameTime: time } });
  await service.ingest({ gameId: game.gameId, input: feed(10) }, game.hostToken);
  const teams = (await service.getTeams(game.gameId)).teams;
  const champions = await service.getAllChampions(game.gameId);
  const owner = await service.createPlayer({ playerName: 'Alex', gameCode: game.gameCode });
  await service.joinTeam({ player: owner.playerId, team: teams[0].teamId }, owner.playerToken);
  await service.chooseChampion({ player: owner.playerId, champion: champions.blue.find(row => row.championName === 'Ahri').championId }, owner.playerToken);
  const opponents = [];
  const red = [...champions.red].sort((a, b) => ['Garen', 'Jinx', 'Ashe'].indexOf(a.championName) - ['Garen', 'Jinx', 'Ashe'].indexOf(b.championName));
  for (const champion of red) {
    const player = await service.createPlayer({ playerName: champion.championName, gameCode: game.gameCode });
    await service.joinTeam({ player: player.playerId, team: teams[1].teamId }, player.playerToken);
    await service.chooseChampion({ player: player.playerId, champion: champion.championId }, player.playerToken);
    opponents.push(player);
  }
  return { service, game, owner, opponents, champions, feed, difficulty };
}

export async function seedReward(database, context, pool, id, overrides = {}, opened = true) {
  const source = catalog.pools[pool === 'support' ? 'standard' : pool].find(choice => choice.id === id);
  const choice = { ...scaledChoice(source, context.difficulty, catalog), ...overrides };
  const alternative = catalog.pools[pool === 'support' ? 'standard' : pool].find(row => row.id !== id);
  const other = alternative && scaledChoice(alternative, context.difficulty, catalog);
  const reward = await database.getRepository(Reward).save({ amount: 2, rewardType: 1, distributed: false,
    player: { playerId: context.owner.playerId }, chestType: pool, openedAt: opened ? new Date() : null,
    choices: opened ? [choice, other].filter(Boolean) : [], distribution: null });
  return { reward, choice };
}

export async function enterGame(page, context) {
  await page.route(/^https:\/\/(static\.bigbrain\.gg|ddragon\.leagueoflegends\.com)\//, route => route.abort());
  await page.addInitScript(({ game, owner }) => {
    sessionStorage.setItem('bb:active', JSON.stringify({ gameId: game.gameId, gameCode: game.gameCode, playerId: owner.playerId }));
    sessionStorage.setItem(`bb:player:${game.gameId}:${owner.playerId}`, owner.playerToken);
  }, { game: context.game, owner: context.owner });
  await page.goto('/status');
}
