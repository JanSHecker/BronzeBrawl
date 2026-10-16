import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToOne,
  ManyToOne,
} from 'typeorm';
import { Player } from './player.entity';
import { Event } from './event.entity';
import { Takedown } from './takedown.entity';

@Entity()
export class Reward {
  @PrimaryGeneratedColumn()
  rewardId: number;

  @Column()
  amount: number;

  @Column()
  rewardType: number;

  @Column({ default: false })
  distributed: boolean;

  @Column({ default: 'standard' })
  chestType: string;

  @Column({ nullable: true })
  openedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  choices: Array<{ id: string; effect: string; amount: number; unit: string }>;

  @Column({ type: 'integer', nullable: true })
  sourceEventId: number;

  @ManyToOne(() => Player, (player) => player.rewards)
  player: Player;

  @OneToOne(() => Takedown, (takedown) => takedown.reward)
  takedown: Takedown;
  @OneToOne(() => Event, (event) => event.reward)
  event: Event;
}
