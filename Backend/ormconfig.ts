import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getDataBaseConfig = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const synchronizeOverride = config.get<string>('TYPEORM_SYNCHRONIZE');
  const dropSchemaOverride = config.get<string>('TYPEORM_DROP_SCHEMA');

  return {
    type: 'postgres',
    host: config.get<string>('POSTGRES_HOST', 'postgres'),
    port: parseInt(config.get<string>('POSTGRES_PORT', '5432'), 10),
    username: config.get('POSTGRES_USER'),
    password: config.get('POSTGRES_PASSWORD'),
    database: config.get('POSTGRES_DB'),
    autoLoadEntities: true,
    synchronize:
      synchronizeOverride != null
        ? synchronizeOverride === 'true'
        : !isProduction,
    dropSchema: dropSchemaOverride === 'true' && !isProduction,
  };
};
