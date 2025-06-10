import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './entities/team.entity';
import { Game } from './entities/game.entity';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
  ) {}

  createTeam(name: number, game: Game): Promise<Team> {
    const teamData = {
      teamName: name,
      game: game,
    };
    const team = this.teamRepository.create(teamData);
    return this.teamRepository.save(team);
  }

  async getTeams(gameId: number): Promise<Team[]> {
    const team = await this.teamRepository
      .createQueryBuilder('team')
      .leftJoinAndSelect('team.game', 'game')
      .where('team.game.gameId =:gameID', { gameID: gameId })
      .getMany();
    return team;
  }
}
