import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
  JoinColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { Player } from './player.entity';
import { Takedown } from './takedown.entity';

@Entity()
export class Champion {
  @PrimaryGeneratedColumn()
  championId: number;

  @Column()
  championName: string;

  @Column()
  summonerName: string;

  @OneToMany(() => Takedown, (takedown) => takedown.killer)
  kills: Takedown[];

  @OneToMany(() => Takedown, (takedown) => takedown.killed)
  deaths: Takedown[];

  @ManyToMany(() => Takedown, (takedown) => takedown.assistor)
  @JoinTable()
  assists: Takedown[];

  @ManyToOne(() => Team, (team) => team.champions)
  team: Team;

  @OneToOne(() => Player, (player) => player.champion)
  player: Player;
}
