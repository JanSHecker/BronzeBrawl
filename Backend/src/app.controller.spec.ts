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
  getChangeCounters: jest.fn(),
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
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return ok status with timestamp', () => {
      expect(appController.getHealth()).toEqual(
        expect.objectContaining({
          status: 'ok',
          timestamp: expect.any(String),
        }),
      );
    });
  });
});
