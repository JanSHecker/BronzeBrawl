import { DataSource } from 'typeorm';

export const REQUIRED_APPLICATION_TABLES = [
  'game',
  'team',
  'champion',
  'player',
  'punishment',
  'reward',
  'takedown',
  'event',
  'champion_assists_takedown',
] as const;

export const REQUIRED_APPLICATION_COLUMNS: Record<string, readonly string[]> = {
  game: [
    'gameId', 'punishmentAmount', 'rewardAmount',
    'state', 'hostTokenHash', 'lastGameTime', 'lastFeedAt', 'rosterFingerprint', 'feedSnapshot',
    'companionTokenHash', 'lastCompanionAt', 'companionAvailability', 'gameCode',
  ],
  team: ['teamId', 'teamName', 'gameGameId'],
  champion: ['championId', 'championName', 'summonerName', 'teamTeamId', 'riotId', 'riotIdGameName', 'riotIdTagLine', 'rotationEndsAtGameTime'],
  player: ['playerId', 'playerName', 'teamTeamId', 'gameGameId', 'championChampionId', 'playerTokenHash'],
  punishment: ['punishmentId', 'amount', 'punishmentType', 'recieved', 'playerPlayerId', 'distributorPlayerId'],
  reward: ['rewardId', 'amount', 'rewardType', 'distributed', 'playerPlayerId'],
  takedown: ['takedownId', 'multiKill', 'shutdown', 'killerChampionId', 'killedChampionId', 'punishmentPunishmentId', 'rewardRewardId'],
  event: ['eventId', 'ingameId', 'eventType', 'gameGameId', 'takedownTakedownId', 'rewardRewardId', 'payload'],
  champion_assists_takedown: ['championChampionId', 'takedownTakedownId'],
};

export const REQUIRED_UNIQUE_CONSTRAINTS = [
  ['event', ['gameGameId', 'ingameId']],
  ['game', ['gameCode']],
] as const;

export const REQUIRED_FOREIGN_KEYS = [
  ['team', ['gameGameId'], 'game', ['gameId']],
  ['champion', ['teamTeamId'], 'team', ['teamId']],
  ['player', ['teamTeamId'], 'team', ['teamId']],
  ['player', ['gameGameId'], 'game', ['gameId']],
  ['player', ['championChampionId'], 'champion', ['championId']],
  ['punishment', ['playerPlayerId'], 'player', ['playerId']],
  ['punishment', ['distributorPlayerId'], 'player', ['playerId']],
  ['reward', ['playerPlayerId'], 'player', ['playerId']],
  ['takedown', ['killerChampionId'], 'champion', ['championId']],
  ['takedown', ['killedChampionId'], 'champion', ['championId']],
  ['takedown', ['punishmentPunishmentId'], 'punishment', ['punishmentId']],
  ['takedown', ['rewardRewardId'], 'reward', ['rewardId']],
  ['event', ['gameGameId'], 'game', ['gameId']],
  ['event', ['takedownTakedownId'], 'takedown', ['takedownId']],
  ['event', ['rewardRewardId'], 'reward', ['rewardId']],
  ['champion_assists_takedown', ['championChampionId'], 'champion', ['championId']],
  ['champion_assists_takedown', ['takedownTakedownId'], 'takedown', ['takedownId']],
] as const;

export const REQUIRED_MIGRATIONS = [
  { name: 'InitialSchema1710000000000', timestamp: 1710000000000 },
  { name: 'GameflowSecurity1710000001000', timestamp: 1710000001000 },
  { name: 'GameflowEventIdentity1710000002000', timestamp: 1710000002000 },
  { name: 'CompanionConnection1792100000000', timestamp: 1792100000000 },
  { name: 'GameCodes1792200000000', timestamp: 1792200000000 },
  { name: 'ChampionRotationTimer1792300000000', timestamp: 1792300000000 },
  { name: 'TimeOnlyRotation1792400000000', timestamp: 1792400000000 },
] as const;

export type DatabaseReadiness =
  | { ready: true; missingTables: [] }
  | { ready: false; missingTables: string[]; error?: unknown };

type SchemaRow = {
  table_name: string;
  column_name?: string;
  constraint_name?: string;
  constraint_type?: string;
  ordinal_position?: string | number;
  referenced_table_name?: string;
  referenced_column_name?: string;
};

/** Check the migration ledger and complete application schema; never infer readiness from connectivity alone. */
export async function checkDatabaseReadiness(
  dataSource: Pick<DataSource, 'isInitialized' | 'query'> | undefined,
): Promise<DatabaseReadiness> {
  if (!dataSource?.isInitialized) {
    return { ready: false, missingTables: [...REQUIRED_APPLICATION_TABLES] };
  }

  try {
    const migrationRows = await dataSource.query(
      `SELECT timestamp, name FROM "typeorm_migrations"
       WHERE ${REQUIRED_MIGRATIONS.map((_, index) => `(timestamp = $${index * 2 + 1} AND name = $${index * 2 + 2})`).join(' OR ')}`,
      REQUIRED_MIGRATIONS.flatMap((migration) => [migration.timestamp, migration.name]),
    ) as Array<{ timestamp: string | number; name: string }>;
    const appliedMigrations = new Set(migrationRows.map((row) => `${row.timestamp}:${row.name}`));
    if (REQUIRED_MIGRATIONS.some((migration) => !appliedMigrations.has(`${migration.timestamp}:${migration.name}`))) {
      return { ready: false, missingTables: [...REQUIRED_APPLICATION_TABLES] };
    }

    const columnRows = await dataSource.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [REQUIRED_APPLICATION_TABLES],
    ) as SchemaRow[];
    const presentColumns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingTables = new Set<string>();
    for (const table of REQUIRED_APPLICATION_TABLES) {
      for (const column of REQUIRED_APPLICATION_COLUMNS[table]) {
        if (!presentColumns.has(`${table}.${column}`)) missingTables.add(table);
      }
    }

    const constraintRows = await dataSource.query(
      `SELECT table_class.relname AS table_name,
              constraint_row.conname AS constraint_name,
              CASE constraint_row.contype
                WHEN 'p' THEN 'PRIMARY KEY'
                WHEN 'f' THEN 'FOREIGN KEY'
                WHEN 'u' THEN 'UNIQUE'
              END AS constraint_type,
              table_column.attname AS column_name,
              table_columns.ordinal_position,
              referenced_class.relname AS referenced_table_name,
              referenced_column.attname AS referenced_column_name
       FROM pg_catalog.pg_constraint constraint_row
       JOIN pg_catalog.pg_class table_class
         ON table_class.oid = constraint_row.conrelid
       JOIN pg_catalog.pg_namespace table_schema
         ON table_schema.oid = table_class.relnamespace
       JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS table_columns(attnum, ordinal_position)
         ON true
       JOIN pg_catalog.pg_attribute table_column
         ON table_column.attrelid = table_class.oid
        AND table_column.attnum = table_columns.attnum
       LEFT JOIN pg_catalog.pg_class referenced_class
         ON referenced_class.oid = constraint_row.confrelid
       LEFT JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY AS referenced_columns(attnum, ordinal_position)
         ON referenced_columns.ordinal_position = table_columns.ordinal_position
       LEFT JOIN pg_catalog.pg_attribute referenced_column
         ON referenced_column.attrelid = referenced_class.oid
        AND referenced_column.attnum = referenced_columns.attnum
       WHERE table_schema.nspname = current_schema()
         AND table_class.relname = ANY($1::text[])
         AND constraint_row.contype IN ('p', 'f', 'u')`,
      [REQUIRED_APPLICATION_TABLES],
    ) as SchemaRow[];
    const constraints = new Map<string, SchemaRow[]>();
    for (const row of constraintRows) {
      const key = `${row.table_name}|${row.constraint_name}|${row.constraint_type}`;
      const rows = constraints.get(key) || [];
      rows.push(row);
      constraints.set(key, rows);
    }
    const hasConstraint = (
      table: string,
      type: string,
      columns: readonly string[],
      referencedTable?: string,
      referencedColumns?: readonly string[],
    ) => [...constraints.entries()].some(([key, rows]) => {
      const [rowTable, , rowType] = key.split('|');
      if (rowTable !== table || rowType !== type) return false;
      const ordered = [...rows].sort((a, b) => Number(a.ordinal_position) - Number(b.ordinal_position));
      if (ordered.length !== columns.length || !ordered.every((row, index) => row.column_name === columns[index])) return false;
      if (referencedTable && !ordered.every((row) => row.referenced_table_name === referencedTable)) return false;
      return !referencedColumns || ordered.every((row, index) => row.referenced_column_name === referencedColumns[index]);
    });

    const primaryKeyColumns: Record<string, readonly string[]> = {
      game: ['gameId'], team: ['teamId'], champion: ['championId'], player: ['playerId'],
      punishment: ['punishmentId'], reward: ['rewardId'], takedown: ['takedownId'], event: ['eventId'],
      champion_assists_takedown: ['championChampionId', 'takedownTakedownId'],
    };
    for (const [table, columns] of Object.entries(primaryKeyColumns)) {
      if (!hasConstraint(table, 'PRIMARY KEY', columns)) missingTables.add(table);
    }
    for (const [table, columns, referencedTable, referencedColumns] of REQUIRED_FOREIGN_KEYS) {
      if (!hasConstraint(table, 'FOREIGN KEY', columns, referencedTable, referencedColumns)) missingTables.add(table);
    }

    for (const [table, columns] of REQUIRED_UNIQUE_CONSTRAINTS) {
      if (!hasConstraint(table, 'UNIQUE', columns)) missingTables.add(table);
    }

    return missingTables.size === 0
      ? { ready: true, missingTables: [] }
      : { ready: false, missingTables: [...missingTables] };
  } catch (error) {
    return { ready: false, missingTables: [...REQUIRED_APPLICATION_TABLES], error };
  }
}
