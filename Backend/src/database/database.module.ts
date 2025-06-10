// src/database/database.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDataBaseConfig } from '../../ormconfig';
import { ConfigService } from '@nestjs/config';

// @Module({
//   imports: [
//     TypeOrmModule.forRoot(config),
//   ],
// })
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getDataBaseConfig(configService),
    }),
  ],
})
export class DatabaseModule {}
