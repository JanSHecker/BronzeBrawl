import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  OneToMany,
  ManyToOne,
} from 'typeorm';
import { Player } from './player.entity';
import { Champion } from './champion.entity';
import { Game } from './game.entity';
@Entity()
export class Team {
  @PrimaryGeneratedColumn()
  teamId: number;

  @Column()
  teamName: number;

  @OneToMany(() => Player, (player) => player.team)
  players: Player[];

  @OneToMany(() => Champion, (champion) => champion.team)
  champions: Champion[];

  @ManyToOne(() => Game, (game) => game.teams)
  game: Game;
}
