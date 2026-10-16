import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Takedown } from './entities/takedown.entity';

@Injectable()
export class TakedownService {
  constructor(
    @InjectRepository(Takedown)
    private readonly takedownRepository: Repository<Takedown>,
  ) {}

  async createTakedown(takedownData: Partial<Takedown>): Promise<Takedown> {
    const takedown = this.takedownRepository.create(takedownData);
    return this.takedownRepository.save(takedown);
  }
}
