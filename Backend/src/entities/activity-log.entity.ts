import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Game } from './game.entity';

export type ActivityType =
  | 'game_created' | 'game_started' | 'game_ended'
  | 'player_joined' | 'player_left' | 'team_changed'
  | 'champion_selected' | 'champion_rotated' | 'champion_killed'
  | 'reward_earned' | 'reward_distributed'
  | 'punishment_assigned' | 'punishment_confirmed';

// Append-only history. Participants are JSON snapshots, not mutable player relations.
@Entity('activity_log')
@Index('IDX_activity_log_game_activity', ['gameId', 'activityId'])
export class ActivityLog {
  @PrimaryGeneratedColumn()
  activityId: number;

  @Column()
  gameId: number;

  @ManyToOne(() => Game, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  @Column({ type: 'varchar' })
  type: ActivityType;

  @Column({ type: 'timestamptz' })
  recordedAt: Date;

  @Column({ type: 'double precision', nullable: true })
  gameTime: number | null;

  @Column({ type: 'jsonb' })
  data: Record<string, any>;
}
