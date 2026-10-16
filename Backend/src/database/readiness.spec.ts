import {
  checkDatabaseReadiness,
  REQUIRED_APPLICATION_COLUMNS,
  REQUIRED_APPLICATION_TABLES,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_MIGRATIONS,
  REQUIRED_UNIQUE_CONSTRAINTS,
} from './readiness';

const primaryKeys: Record<string, string[]> = {
  game: ['gameId'],
  team: ['teamId'],
  champion: ['championId'],
  player: ['playerId'],
  punishment: ['punishmentId'],
  reward: ['rewardId'],
  takedown: ['takedownId'],
  event: ['eventId'],
  champion_assists_takedown: ['championChampionId', 'takedownTakedownId'],
};

function completeSchemaQuery() {
  const columns = Object.entries(REQUIRED_APPLICATION_COLUMNS).flatMap(([table_name, names]) =>
    names.map((column_name) => ({ table_name, column_name })));
  const constraints = Object.entries(primaryKeys).flatMap(([table_name, names]) =>
    names.map((column_name, ordinal_position) => ({
      table_name, constraint_name: `pk_${table_name}`, constraint_type: 'PRIMARY KEY', column_name, ordinal_position: ordinal_position + 1,
    })));
  for (const [table_name, names, referenced_table_name, referencedColumns] of REQUIRED_FOREIGN_KEYS as ReadonlyArray<readonly [string, readonly string[], string, readonly string[]]>) {
    constraints.push(...names.map((column_name, index) => ({
      table_name,
      constraint_name: `fk_${table_name}_${column_name}`,
      constraint_type: 'FOREIGN KEY',
      column_name,
      ordinal_position: index + 1,
      referenced_table_name,
      referenced_column_name: referencedColumns[index],
    })));
  }
  for (const [table_name, names] of REQUIRED_UNIQUE_CONSTRAINTS) {
    constraints.push(...names.map((column_name, index) => ({
      table_name,
      constraint_name: `uq_${table_name}`,
      constraint_type: 'UNIQUE',
      column_name,
      ordinal_position: index + 1,
    })));
  }
  return jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('typeorm_migrations')) return [...REQUIRED_MIGRATIONS];
    if (sql.includes('information_schema.columns')) return columns;
    return constraints;
  });
}

function postgresCompositePrimaryKeyRows() {
  return [
    { table_name: 'champion_assists_takedown', constraint_name: 'PK_join', constraint_type: 'PRIMARY KEY', column_name: 'championChampionId', ordinal_position: 1 },
    { table_name: 'champion_assists_takedown', constraint_name: 'PK_join', constraint_type: 'PRIMARY KEY', column_name: 'takedownTakedownId', ordinal_position: 2 },
  ];
}

describe('database readiness', () => {
  test('is not ready when application tables are missing', async () => {
    const result = await checkDatabaseReadiness({
      isInitialized: true,
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('typeorm_migrations')) return [...REQUIRED_MIGRATIONS];
        if (sql.includes('information_schema.columns')) return [{ table_name: 'game', column_name: 'gameId' }];
        return [];
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.missingTables).toContain('player');
  });

  test('is ready only when migration, columns, and constraints exist', async () => {
    const result = await checkDatabaseReadiness({ isInitialized: true, query: completeSchemaQuery() });
    expect(result).toEqual({ ready: true, missingTables: [] });
  });

  test('accepts PostgreSQL ordinal-aware composite primary-key metadata', async () => {
    const query = completeSchemaQuery().mockImplementation((sql: string) => {
      if (sql.includes('typeorm_migrations')) return [...REQUIRED_MIGRATIONS];
      if (sql.includes('information_schema.columns')) {
        return Object.entries(REQUIRED_APPLICATION_COLUMNS).flatMap(([table_name, names]) =>
          names.map((column_name) => ({ table_name, column_name })));
      }
      const rows = completeSchemaQuery()(sql);
      return rows.filter((row: { table_name: string; constraint_type: string }) =>
        row.table_name !== 'champion_assists_takedown' || row.constraint_type !== 'PRIMARY KEY')
        .concat(postgresCompositePrimaryKeyRows());
    });
    const result = await checkDatabaseReadiness({ isInitialized: true, query });
    expect(result).toEqual({ ready: true, missingTables: [] });
    expect(query.mock.calls[2][0]).toContain('pg_catalog.pg_constraint');
    expect(query.mock.calls[2][0]).not.toContain('constraint_column_usage');
  });

  test('does not report a complete synchronized-looking schema without the migration ledger entry', async () => {
    const query = completeSchemaQuery().mockImplementation((sql: string) => {
      if (sql.includes('typeorm_migrations')) return REQUIRED_MIGRATIONS.slice(0, -1);
      return completeSchemaQuery();
    });
    const result = await checkDatabaseReadiness({ isInitialized: true, query });
    expect(result.ready).toBe(false);
  });

  test('reports an unavailable database as not ready', async () => {
    const result = await checkDatabaseReadiness({
      isInitialized: true,
      query: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    expect(result.ready).toBe(false);
    expect(result.missingTables).toEqual([...REQUIRED_APPLICATION_TABLES]);
  });

  test('requires the game code column and its unique constraint', async () => {
    for (const missing of ['column', 'constraint']) {
      const query = completeSchemaQuery().mockImplementation((sql: string) => {
        const rows = completeSchemaQuery()(sql);
        if (missing === 'column' && sql.includes('information_schema.columns')) {
          return rows.filter((row: any) => row.table_name !== 'game' || row.column_name !== 'gameCode');
        }
        if (missing === 'constraint' && sql.includes('pg_catalog.pg_constraint')) {
          return rows.filter((row: any) => row.table_name !== 'game' || row.constraint_type !== 'UNIQUE');
        }
        return rows;
      });
      expect(await checkDatabaseReadiness({ isInitialized: true, query })).toEqual({ ready: false, missingTables: ['game'] });
    }
  });
});
