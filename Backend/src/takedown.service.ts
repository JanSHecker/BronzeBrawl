import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Takedown } from './entities/takedown.entity';
import { PlayerService } from './player.service';

@Injectable()
export class TakedownService {
  constructor(
    @InjectRepository(Takedown)
    private readonly takedownRepository: Repository<Takedown>,
    private readonly playerService: PlayerService,
  ) {}

  createTakedown(takedownData: Partial<Takedown>): Promise<Takedown> {
    const takedown = this.takedownRepository.create(takedownData);
    this.playerService.updateChangeCounter(takedown.killer, true);
    this.playerService.updateChangeCounter(takedown.killed, false);
    return this.takedownRepository.save(takedown);
  }
}
