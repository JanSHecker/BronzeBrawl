import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import { join } from 'path';

/** Shared by Nest and the CLI; __dirname is Backend/ in TS and Backend/dist/ in JS. */
export const getDataSourceOptions = (config: ConfigService): DataSourceOptions => {
  const extension = __filename.endsWith('.ts') ? 'ts' : 'js';
  // TEST_DATABASE_URL is deliberately opt-in for test/generation processes only.
  const testUrl = config.get<string>('TEST_DATABASE_URL');
  if (testUrl && config.get<string>('NODE_ENV') !== 'test') {
    throw new Error('TEST_DATABASE_URL is allowed only with NODE_ENV=test');
  }
  return {
    type: 'postgres',
    ...(testUrl
      ? { url: testUrl }
      : {
          host: config.get<string>('POSTGRES_HOST', 'postgres'),
          port: Number(config.get<string>('POSTGRES_PORT', '5432')),
          username: config.get<string>('POSTGRES_USER'),
          password: config.get<string>('POSTGRES_PASSWORD'),
          database: config.get<string>('POSTGRES_DB'),
        }),
    entities: [join(__dirname, 'src', '**', `*.entity.${extension}`)],
    migrations: [join(__dirname, 'migrations', `*.${extension}`)],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    migrationsRun: false,
    // No implicit DDL in any environment. Only reviewed, versioned migrations.
    synchronize: false,
    dropSchema: false,
    logging: false,
  };
};

export const getDataBaseConfig = (config: ConfigService): TypeOrmModuleOptions => ({
  ...getDataSourceOptions(config),
  autoLoadEntities: true,
});
