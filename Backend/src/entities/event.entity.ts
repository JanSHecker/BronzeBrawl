import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Game } from './game.entity';
import { Takedown } from './takedown.entity';
import { Reward } from './reward.entity';

@Entity()
export class Event {
  @PrimaryGeneratedColumn()
  eventId: number;

  @Column()
  ingameId: number;

  @Column()
  eventType: string;

  @ManyToOne(() => Game, (game) => game.events)
  game: Game;

  @OneToOne(() => Takedown, { cascade: true })
  @JoinColumn()
  takedown: Takedown;

  @OneToOne(() => Reward, { cascade: true })
  @JoinColumn()
  reward: Reward;
}
