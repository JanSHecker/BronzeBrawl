import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { getDataSourceOptions } from '../../ormconfig';
import { checkDatabaseReadiness, REQUIRED_APPLICATION_TABLES } from '../database/readiness';

const enabled = Boolean(process.env.TEST_DATABASE_URL);

describe('initial migration integration', () => {
  let dataSource: DataSource;

  (enabled ? beforeAll : beforeAll)(async () => {
    if (!enabled) return;
    dataSource = new DataSource(getDataSourceOptions(new ConfigService({
      NODE_ENV: 'test',
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    })));
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  (enabled ? test : test.skip)('migration creates every required application table', async () => {
    const result = await checkDatabaseReadiness(dataSource);
    expect(result).toEqual({ ready: true, missingTables: [] });
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
      [REQUIRED_APPLICATION_TABLES],
    );
    expect(rows.map((row: { table_name: string }) => row.table_name).sort())
      .toEqual([...REQUIRED_APPLICATION_TABLES].sort());
  });
});
