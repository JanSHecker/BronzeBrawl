import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reward } from './entities/reward.entity';
import { PunishmentService } from './punishment.service';
import { PlayerService } from './player.service';

@Injectable()
export class RewardService {
  constructor(
    @InjectRepository(Reward)
    private readonly rewardRepository: Repository<Reward>,
  ) {}

  createReward(rewardData: Partial<Reward>): Promise<Reward> {
    const reward = this.rewardRepository.create(rewardData);
    return this.rewardRepository.save(reward);
  }
  async getReward(rewardId): Promise<Reward> {
    const reward = await this.rewardRepository
      .createQueryBuilder('reward')
      .where('reward.rewardId =:rewardID', { rewardID: rewardId })
      .getOne();
    return reward;
  }
  async getRewards(playerId) {
    return await this.rewardRepository
      .createQueryBuilder('reward')
      .leftJoinAndSelect('reward.player', 'player')
      .where('reward.player =:playerID', { playerID: playerId })
      .getMany();
  }
  confirmReward(rewardId) {
    this.rewardRepository
      .createQueryBuilder('reward')
      .update()
      .set({
        distributed: true,
      })
      .where('rewardId =:rewardID', {
        rewardID: rewardId,
      })
      .execute();
  }
}
