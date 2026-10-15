import 'reflect-metadata';
import { createHash } from 'crypto';
import { Game } from './entities/game.entity';
import { Player } from './entities/player.entity';
import { Team } from './entities/team.entity';
import { Champion } from './entities/champion.entity';
import { GameflowService } from './gameflow.service';

/**
 * Models the production TypeORM boundary: relations are only populated when
 * their complete relation path is requested. In particular, `team` does not
 * imply `team.game`.
 */
class RepositoryShapedDataSource {
  readonly game: any;
  readonly teams: any[];
  readonly players: any[];
  readonly champions: any[];
  readonly championRelations: string[][] = [];

  constructor() {
    this.game = {
      gameId: 42,
      punishmentAmount: 5,
      rewardAmount: 6,
      rotationMode: 'Kills',
      defaultRotationCounter: 2,
      state: 'live',
    };
    this.teams = [
      { teamId: 101, teamName: 0, game: this.game },
      { teamId: 102, teamName: 1, game: this.game },
    ];
    this.players = [{
      playerId: 501,
      playerName: 'Blue player',
      game: this.game,
      team: this.teams[0],
      champion: null,
      killCounter: 0,
      deathCounter: 0,
      playerTokenHash: createHash('sha256').update('a'.repeat(64)).digest('hex'),
    }];
    this.champions = [
      { championId: 601, championName: 'Ahri', summonerName: 'Alice', teamId: 101, player: null },
      { championId: 602, championName: 'Garen', summonerName: 'Bob', teamId: 102, player: null },
    ];
  }

  getRepository(type: any): any {
    return {
      find: async (options: any = {}) => this.find(type, options),
      save: async (value: any) => this.save(type, value),
    };
  }

  private async find(type: any, options: any): Promise<any[]> {
    if (type === Game) return [this.game];
    if (type === Team) return this.teams;
    if (type === Player) return this.players;
    if (type !== Champion) return [];

    const relations = options.relations || [];
    this.championRelations.push(relations);
    const loadsNestedGame = relations.includes('team.game');
    return this.champions.map((row) => ({
      ...row,
      team: loadsNestedGame
        ? this.teams.find((team) => team.teamId === row.teamId)
        : { teamId: row.teamId, teamName: this.teams.find((team) => team.teamId === row.teamId).teamName },
      player: row.player,
    }));
  }

  private async save(type: any, value: any): Promise<any> {
    if (type === Champion) {
      const row = this.champions.find((champion) => champion.championId === value.championId);
      Object.assign(row, value);
    }
    if (type === Player) Object.assign(this.players.find((player) => player.playerId === value.playerId), value);
    return value;
  }
}

describe('GameflowService production relation loading', () => {
  test('loads team.game for champion listing and selection through a TypeORM-shaped repository', async () => {
    const database = new RepositoryShapedDataSource();
    const service = new GameflowService(database as any);

    const all = await service.getAllChampions(42);
    expect(all.blue.map((champion: any) => champion.championId)).toEqual([601]);
    expect(all.red.map((champion: any) => champion.championId)).toEqual([602]);
    expect(database.championRelations).toContainEqual(['team', 'team.game', 'player']);

    const selected = await service.chooseChampion({ player: 501, champion: 601 }, 'a'.repeat(64));
    expect(selected).toMatchObject({ championId: 601, team: { gameId: 42, teamId: 101 } });
  });
});
