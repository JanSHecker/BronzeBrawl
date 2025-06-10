import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from './entities/game.entity';
import { PlayerService } from './player.service';
import { ChampionService } from './champion.service';

@Injectable()
export class GameService {
  constructor(
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
    private readonly playerService: PlayerService,
    private readonly championService: ChampionService,
  ) {}

  createGame(gameData: Partial<Game>): Promise<Game> {
    const game = this.gameRepository.create(gameData);
    return this.gameRepository.save(game);
  }

  async getGame(id) {
    const game = await this.gameRepository
      .createQueryBuilder('game')
      .where('game.gameId =:gameID', { gameID: id })
      .getOne();
    return game;
  }

  async createDummygame(gameId) {
    const champions = await this.championService.getAllChampions(gameId);
    const blueTeam = champions.blue[0].team;
    const redTeam = champions.red[0].team;

    for (let i = 0; i < 10; i++) {
      const playerTemplate = {
        playerName: 'Knecht ' + i,
        game: gameId,
        team: i < 5 ? blueTeam : redTeam,
        champion: i < 5 ? champions.blue[i] : champions.red[i - 5],
        killCounter: 5,
        deathCounter: 5,
      };
      await this.playerService.createPlayer(playerTemplate);
    }
  }
}
