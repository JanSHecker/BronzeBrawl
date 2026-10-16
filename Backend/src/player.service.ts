import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Player } from './entities/player.entity';

@Injectable()
export class PlayerService {
  constructor(
    @InjectRepository(Player)
    private readonly playerRepository: Repository<Player>,
  ) {}

  async createPlayer(playerData: Partial<Player>) {
    const player = await this.playerRepository.create(playerData);
    await this.playerRepository.save(player);
    return player;
  }
  async getAllPlayers(gameId) {
    const allPlayers = await this.playerRepository
      .createQueryBuilder('player')
      .leftJoinAndSelect('player.team', 'team')
      .where('player.game = :gameID', { gameID: gameId })
      .getMany();
    const players = {
      blue: allPlayers.filter(function (player) {
        if (player.team !== null) {
          return player.team.teamName === 0;
        }
      }),
      red: allPlayers.filter(function (player) {
        if (player.team !== null) {
          return player.team.teamName === 1;
        }
      }),
    };
    return players;
  }
  async getPlayerById(id): Promise<Player> {
    const player = await this.playerRepository
      .createQueryBuilder('player')
      .where('player.playerId =:playerID', { playerID: id })
      .getOne();
    return player;
  }
  async joinTeam(playerId, teamId) {
    return await this.playerRepository
      .createQueryBuilder('player')
      .update(Player)
      .set({
        team: teamId,
      })
      .where('playerId =:playerID', { playerID: playerId })
      .execute();
  }
  async getChampionPlayer(championID) {
    return this.playerRepository
      .createQueryBuilder('player')
      .leftJoinAndSelect('player.champion', 'champion')
      .where('player.champion =:championID', {
        championID,
      })
      .getOne();
  }

  async deletePlayer(id) {
    await this.playerRepository
      .createQueryBuilder('player')
      .delete()
      .from(Player)
      .where('playerId =:ID', { ID: id })
      .execute();
  }
}
