import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { Champion } from './champion.entity';
import { Punishment } from './punishment.entity';
import { Game } from './game.entity';
import { Reward } from './reward.entity';

@Entity()
export class Player {
  @PrimaryGeneratedColumn()
  playerId: number;

  @Column()
  playerName: string;

  @Column({ default: 0 })
  killCounter: number;

  @Column({ default: 0 })
  deathCounter: number;

  @ManyToOne(() => Team, (team) => team.players)
  team: Team;
  @ManyToOne(() => Game, (game) => game.players)
  game: Game;

  @OneToOne(() => Champion, { cascade: true })
  @JoinColumn()
  champion: Champion;

  @OneToMany(() => Punishment, (punishment) => punishment.player)
  punishments: Punishment[];

  @OneToMany(() => Reward, (reward) => reward.player)
  rewards: Reward[];

  @OneToMany(() => Punishment, (punishment) => punishment.distributor)
  distributions: Punishment[];
}
