import { Entity, PrimaryGeneratedColumn, OneToMany, Column } from 'typeorm';
import { Event } from './event.entity';
import { Team } from './team.entity';
import { Player } from './player.entity';

@Entity()
export class Game {
  @PrimaryGeneratedColumn()
  gameId: number;

  @Column()
  punishmentAmount: number;

  @Column()
  rewardAmount: number;

  @Column()
  rotationMode: string;

  @Column({ nullable: true })
  defaultRotationCounter: number;

  @OneToMany(() => Event, (event) => event.game)
  events: Event[];

  @OneToMany(() => Team, (team) => team.game)
  teams: Team[];

  @OneToMany(() => Player, (player) => player.game)
  players: Player[];
}
