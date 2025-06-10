import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { Takedown } from './entities/takedown.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Champion } from './entities/champion.entity';
import { Player } from 'src/entities/player.entity';
import { Team } from 'src/entities/team.entity';
import { Punishment } from 'src/entities/punishment.entity';
import { Game } from 'src/entities/game.entity';
import { Event } from 'src/entities/event.entity';
import { LolAPIService } from './lolAPI.service';
import { ChampionService } from './champion.service';
import { GameService } from './game.service';
import { TeamService } from './team.service';
import { TakedownService } from './takedown.service';
import { EventService } from './event.service';
import { PunishmentService } from './punishment.service';
import { PlayerService } from './player.service';
import { Reward } from './entities/reward.entity';
import { RewardService } from './reward.service';
import { DistributionService } from './distribution.service';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forFeature([
      Champion,
      Takedown,
      Punishment,
      Game,
      Event,
      Player,
      Team,
      Reward,
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    LolAPIService,
    ChampionService,
    GameService,
    TeamService,
    TakedownService,
    EventService,
    PunishmentService,
    PlayerService,
    RewardService,
    DistributionService,
  ],
})
export class AppModule {}
