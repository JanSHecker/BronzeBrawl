import { Entity, PrimaryGeneratedColumn, OneToMany, Column } from 'typeorm';
import { Event } from './event.entity';
import { Team } from './team.entity';
import { Player } from './player.entity';

@Entity()
export class Game {
  @PrimaryGeneratedColumn()
  gameId: number;

  @Column({ type: 'varchar', length: 4, nullable: true, unique: true })
  gameCode: string;

  @Column()
  punishmentAmount: number;

  @Column()
  rewardAmount: number;

  @Column()
  rotationMode: string;

  @Column({ nullable: true })
  defaultRotationCounter: number;

  @Column({ default: 'waiting_for_feed' })
  state: string;

  @Column({ nullable: true })
  hostTokenHash: string;

  @Column({ nullable: true })
  companionTokenHash: string;

  @Column({ nullable: true })
  lastCompanionAt: Date;

  @Column({ nullable: true })
  companionAvailability: string;

  @Column({ nullable: true })
  lastGameTime: number;

  @Column({ nullable: true })
  lastFeedAt: Date;

  @Column({ nullable: true })
  rosterFingerprint: string;

  @Column({ type: 'jsonb', nullable: true })
  feedSnapshot: Record<string, any>;

  @OneToMany(() => Event, (event) => event.game)
  events: Event[];

  @OneToMany(() => Team, (team) => team.game)
  teams: Team[];

  @OneToMany(() => Player, (player) => player.game)
  players: Player[];
}
