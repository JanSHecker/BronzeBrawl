import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LolAPIService } from './lolAPI.service';
import { PlayerService } from './player.service';
import { ChampionService } from './champion.service';
import { GameService } from './game.service';
import { PunishmentService } from './punishment.service';
import { RewardService } from './reward.service';
import { DistributionService } from './distribution.service';
import { TeamService } from './team.service';
import { GameflowService } from './gameflow.service';
import { getDataSourceToken } from '@nestjs/typeorm';
import { REQUIRED_APPLICATION_COLUMNS, REQUIRED_FOREIGN_KEYS, REQUIRED_MIGRATIONS, REQUIRED_UNIQUE_CONSTRAINTS } from './database/readiness';

const readinessQuery = jest.fn().mockImplementation((sql: string) => {
  if (sql.includes('typeorm_migrations')) return [...REQUIRED_MIGRATIONS];
  if (sql.includes('information_schema.columns')) {
    return Object.entries(REQUIRED_APPLICATION_COLUMNS).flatMap(([table_name, columns]) =>
      columns.map((column_name) => ({ table_name, column_name })));
  }
  const primaryKeys: Record<string, string[]> = {
    game: ['gameId'], team: ['teamId'], champion: ['championId'], player: ['playerId'],
    punishment: ['punishmentId'], reward: ['rewardId'], takedown: ['takedownId'], event: ['eventId'],
    champion_assists_takedown: ['championChampionId', 'takedownTakedownId'],
    activity_log: ['activityId'],
  };
  const rows: any[] = Object.entries(primaryKeys).flatMap(([table_name, columns]) => columns.map((column_name, index) => ({
    table_name, constraint_name: `pk_${table_name}`, constraint_type: 'PRIMARY KEY', column_name, ordinal_position: index + 1,
  })));
  for (const [table_name, columns, referenced_table_name, referencedColumns] of REQUIRED_FOREIGN_KEYS) {
    rows.push(...columns.map((column_name, index) => ({
      table_name, constraint_name: `fk_${table_name}_${column_name}`, constraint_type: 'FOREIGN KEY', column_name,
      ordinal_position: index + 1, referenced_table_name, referenced_column_name: referencedColumns[index],
    })));
  }
  for (const [table_name, columns] of REQUIRED_UNIQUE_CONSTRAINTS) {
    rows.push(...columns.map((column_name, index) => ({
      table_name, constraint_name: `uq_${table_name}`, constraint_type: 'UNIQUE', column_name,
      ordinal_position: index + 1,
    })));
  }
  return rows;
});

const createMock = () => ({
  getHello: jest.fn(),
  getLolInput: jest.fn(),
  saveLolInput: jest.fn(),
  createPlayer: jest.fn(),
  getAllPlayers: jest.fn(),
  getTeams: jest.fn(),
  joinTeam: jest.fn(),
  getAllChampions: jest.fn(),
  chooseChampion: jest.fn(),
  createDummygame: jest.fn(),
  createPunishment: jest.fn(),
  getKDA: jest.fn(),
  confirmPunishment: jest.fn(),
  confirmReward: jest.fn(),
  getPunishments: jest.fn(),
  getRewards: jest.fn(),
  getTeamChampions: jest.fn(),
  getGame: jest.fn(),
  runGame: jest.fn(),
});

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: createMock() },
        { provide: LolAPIService, useValue: createMock() },
        { provide: PlayerService, useValue: createMock() },
        { provide: ChampionService, useValue: createMock() },
        { provide: GameService, useValue: createMock() },
        { provide: PunishmentService, useValue: createMock() },
        { provide: RewardService, useValue: createMock() },
        { provide: DistributionService, useValue: createMock() },
        { provide: TeamService, useValue: createMock() },
        { provide: GameflowService, useValue: new GameflowService({} as any) },
        {
          provide: getDataSourceToken(),
          useValue: {
            isInitialized: true,
            query: readinessQuery,
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('exposes the read-only reward catalogue without a player or game token', () => {
    expect(appController.getRewardCatalog(undefined)).toMatchObject({ difficulty: 'baseline', maxShield: 10 });
    expect(appController.getRewardCatalog('easy').multiplier).toBe(0.5);
    expect(() => appController.getRewardCatalog('invented')).toThrow('invalid difficulty');
  });

  describe('health', () => {
    it('should return a ready JSON contract with timestamp', async () => {
      expect(await appController.getHealth()).toEqual(
        expect.objectContaining({
          status: 'ok',
          readiness: 'ready',
          database: 'ok',
          timestamp: expect.any(String),
        }),
      );
    });
  });
});
