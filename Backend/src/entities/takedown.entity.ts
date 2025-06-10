import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToOne,
  ManyToMany,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { Event } from './event.entity';
import { Champion } from './champion.entity';
import { Punishment } from './punishment.entity';
import { Reward } from './reward.entity';

@Entity()
export class Takedown {
  @PrimaryGeneratedColumn()
  takedownId: number;

  @Column()
  multiKill: number;

  @Column()
  shutdown: boolean;

  @ManyToOne(() => Champion, (champion) => champion.kills)
  killer: Champion;

  @ManyToOne(() => Champion, (champion) => champion.deaths)
  killed: Champion;

  @ManyToMany(() => Champion, (champion) => champion.assists)
  assistor: Champion[];

  @OneToOne(() => Punishment, { cascade: true })
  @JoinColumn()
  punishment: Punishment;

  @OneToOne(() => Reward, { cascade: true })
  @JoinColumn()
  reward: Reward;
  @OneToOne(() => Event, (event) => event.takedown)
  event: Event;
}
