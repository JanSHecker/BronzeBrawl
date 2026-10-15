import { Module } from '@nestjs/common';
import { ReplayController, ReplayGuard } from './replay.controller';
import { ReplayService } from './replay.service';
import { RiotClient } from './riot.client';

@Module({ controllers: [ReplayController], providers: [ReplayGuard, ReplayService, RiotClient] })
export class ReplayModule {}
