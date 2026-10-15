import { Body, Controller, Get, Headers, HttpException, HttpStatus, Optional, Post, Query, Res } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Response } from 'express';
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
import { checkDatabaseReadiness } from './database/readiness';

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
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly gameflow?: GameflowService,
  ) {}

  @Get('health')
  async getHealth(@Res({ passthrough: true }) response?: Response) {
    const readiness = await checkDatabaseReadiness(this.dataSource);
    const body = {
      status: readiness.ready ? 'ok' : 'error',
      readiness: readiness.ready ? 'ready' : 'not_ready',
      database: readiness.ready ? 'ok' : 'unavailable',
      timestamp: new Date().toISOString(),
      ...(readiness.ready ? {} : { reason: 'database_schema_unavailable' }),
    };
    if (!readiness.ready && response) response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }

  @Get('lolInput')
  getHello(): object {
    return this.lolApiService.getLolInput();
  }

  @Post('sendLoLInput')
  async receiveLoLInput(@Body() request: any, @Headers('x-game-token') token: string) {
    if (!this.gameflow) return this.lolApiService.saveLolInput(request);
    return this.gameflow.ingest(request, token);
  }

  @Get('runGame')
  async runGame(
    @Query('punishmentAmount') punishmentAmount,
    @Query('rewardAmount') rewardAmount,
    @Query('rotationMode') rotationMode,
    @Query('defaultCounter') defaultCounter,
  ) {
    if (this.gameflow) return this.gameflow.runGame({ punishmentAmount, rewardAmount, rotationMode, defaultCounter });
    const game = await this.gameService.createGame({ punishmentAmount, rewardAmount, rotationMode, defaultRotationCounter: defaultCounter });
    return game;
  }

  @Post('createPlayer')
  async createPlayer(@Body() playerData) {
    if (this.gameflow) return this.gameflow.createPlayer(playerData);
    return this.playerService.createPlayer(playerData);
  }

  @Get('getTeams')
  async getTeams(@Query('id') gameId) {
    if (this.gameflow) return this.gameflow.getTeams(gameId);
    return { players: await this.playerService.getAllPlayers(gameId), teams: await this.teamService.getTeams(gameId) };
  }

  @Post('joinTeam')
  async joinTeam(@Body() input, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.joinTeam(input, token);
    return this.playerService.joinTeam(input.player, input.team);
  }

  @Get('getAllChampions')
  async getAllChampions(@Query('id') gameId) {
    if (this.gameflow) return this.gameflow.getAllChampions(gameId);
    return this.championService.getAllChampions(gameId);
  }

  @Post('chooseChampion')
  async chooseChampion(@Body() input, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.chooseChampion(input, token);
    return this.playerService.chooseChampion(input);
  }

  @Post('Dummygame')
  createDummygame() {
    throw new HttpException('public dummy game is disabled', HttpStatus.NOT_FOUND);
  }

  @Post('createPunishment')
  createPunishment() {
    throw new HttpException('public punishment creation is disabled', HttpStatus.NOT_FOUND);
  }

  @Get('kda')
  async getKDA(@Query('id') championId) {
    if (this.gameflow) return this.gameflow.kda(championId);
    return this.championService.getKDA(championId);
  }

  @Post('confirmPunishment')
  async confirmPunishment(@Body() input, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.confirmPunishment(input, token);
    return this.punishmentService.confirmPunishment(input.id);
  }

  @Post('confirmReward')
  async confirmReward(@Body() input, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.confirmReward(input, token);
    await this.distributionService.distributePunishment(input);
    return this.rewardService.confirmReward(input.id);
  }

  @Get('getChangeCounters')
  async getChangeCounter(@Query('id') playerId, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.getChangeCounters(playerId, token);
    return this.playerService.getChangeCounters(playerId);
  }

  @Get('Status')
  async getStatus(@Query('playerId') playerId, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.status(playerId, token);
    return {
      punishments: await this.punishmentService.getPunishments(playerId),
      rewards: await this.rewardService.getRewards(playerId),
      counter: await this.playerService.getChangeCounters(playerId),
    };
  }

  @Get('getSettings')
  async getSettings(@Query('gameId') gameId) {
    if (this.gameflow) return this.gameflow.getSettings(gameId);
    return this.gameService.getGame(gameId);
  }

  @Post('deletePlayer')
  async deletePlayer(@Body() input, @Headers('x-player-token') token: string) {
    if (this.gameflow) return this.gameflow.deletePlayer(input, token);
    return this.playerService.deletePlayer(input.id);
  }
}
