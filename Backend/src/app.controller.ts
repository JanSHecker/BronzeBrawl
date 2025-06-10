import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { LolAPIService } from './lolAPI.service';
import { PlayerService } from './player.service';
import { ChampionService } from './champion.service';
import { GameService } from './game.service';
import { PunishmentService } from './punishment.service';
import { RewardService } from './reward.service';
import { DistributionService } from './distribution.service';
import { TeamService } from './team.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly lolApiService: LolAPIService,
    private readonly playerService: PlayerService,
    private readonly championService: ChampionService,
    private readonly gameService: GameService,
    private readonly punishmentService: PunishmentService,
    private readonly rewardService: RewardService,
    private readonly distributionService: DistributionService,
    private readonly teamService: TeamService,
  ) {}

  @Get('lolInput')
  getHello(): object {
    return this.lolApiService.getLolInput();
  }

  @Post('sendLoLInput')
  async recieveLoLInput(@Body() input) {
    await this.lolApiService.saveLolInput(input);
  }

  @Get('runGame')
  async runGame(
    @Query('punishmentAmount') pAmount,
    @Query('rewardAmount') rAmount,
    @Query('rotationMode') rotationMode,
    @Query('defaultCounter') defaultCounter,
  ) {
    const gameTemplate = {
      punishmentAmount: pAmount,
      rewardAmount: rAmount,
      rotationMode: rotationMode,
      defaultRotationCounter: defaultCounter,
    };
    const game = await this.gameService.createGame(gameTemplate);
    this.appService.runGame(game.gameId);
    console.log(`A new game was created with ID ${game.gameId}`);
    return game;
  }
  @Post('createPlayer')
  async createPlayer(@Body() playerData) {
    return await this.playerService.createPlayer(playerData);
  }
  @Get('getTeams')
  async getTeams(@Query('id') gameId) {
    const res = {
      players: await this.playerService.getAllPlayers(gameId),
      teams: await this.teamService.getTeams(gameId),
    };
    return res;
  }
  @Post('joinTeam')
  joinTeam(@Body() playerTeamPair) {
    this.playerService.joinTeam(playerTeamPair.player, playerTeamPair.team);
  }
  @Get('getAllChampions')
  getAllChampions(@Query('id') game) {
    return this.championService.getAllChampions(game);
  }
  @Post('chooseChampion')
  chooseChampion(@Body() playerChampionPair) {
    this.playerService.chooseChampion(playerChampionPair);
  }
  @Post('Dummygame')
  createDummygame(@Body() game) {
    this.gameService.createDummygame(game.id);
  }
  @Post('createPunishment')
  distributePunishment(@Body() punishment) {
    this.distributionService.distributePunishment(punishment);
  }
  @Get('kda')
  getKDA(@Query('id') champion) {
    return this.championService.getKDA(champion);
  }
  @Post('confirmPunishment')
  confirmPunishment(@Body() punishment) {
    this.punishmentService.confirmPunishment(punishment.id);
  }
  @Post('confirmReward')
  async confirmReward(@Body() reward) {
    await this.distributionService.distributePunishment(reward);
    this.rewardService.confirmReward(reward.id);
  }
  @Get('getChangeCounters')
  getChangeCounter(@Query('id') playerId) {
    return this.playerService.getChangeCounters(playerId);
  }
  @Get('Status')
  async getStatus(
    @Query('playerId') playerId,
    @Query('championId') championId,
    @Query('enemyTeam') teamId,
  ) {
    const status = {
      punishments: await this.punishmentService.getPunishments(playerId),
      rewards: await this.rewardService.getRewards(playerId),
      counter: await this.playerService.getChangeCounters(playerId),
      kda: await this.championService.getKDA(championId),
      enemyTeam: await this.championService.getTeamChampions(teamId),
    };
    return status;
  }
  @Get('getSettings')
  async getSettings(@Query('gameId') gameId) {
    return await this.gameService.getGame(gameId);
  }
  @Post('deletePlayer')
  deletePlayer(@Body() player) {
    this.playerService.deletePlayer(player.id);
  }
}
