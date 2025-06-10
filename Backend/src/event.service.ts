import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from './entities/event.entity';
import { Game } from './entities/game.entity';

@Injectable()
export class EventService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
  ) {}

  createEvent(eventData: Partial<Event>): Promise<Event> {
    const event = this.eventRepository.create(eventData);
    return this.eventRepository.save(event);
  }
  async hasGameEnded(game: Game): Promise<boolean> {
    const endEvent = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.game = :gameID', { gameID: game.gameId })
      .andWhere('event.eventType =:eventType', { eventType: 'GameEnd' })
      .getOne();
    if (endEvent !== null) {
      return true;
    } else {
      return false;
    }
  }
}
