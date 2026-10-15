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

export type DatabaseReadiness =
  | { ready: true; missingTables: [] }
  | { ready: false; missingTables: string[]; error?: unknown };

/** Check both connectivity and the complete application schema; never infer readiness from connectivity alone. */
export async function checkDatabaseReadiness(
  dataSource: Pick<DataSource, 'isInitialized' | 'query'> | undefined,
): Promise<DatabaseReadiness> {
  if (!dataSource?.isInitialized) {
    return { ready: false, missingTables: [...REQUIRED_APPLICATION_TABLES] };
  }

  try {
    const rows = (await dataSource.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [REQUIRED_APPLICATION_TABLES],
    )) as Array<{ table_name: string }>;
    const present = new Set(rows.map((row) => row.table_name));
    const missingTables = REQUIRED_APPLICATION_TABLES.filter((table) => !present.has(table));
    return missingTables.length === 0
      ? { ready: true, missingTables: [] }
      : { ready: false, missingTables: [...missingTables] };
  } catch (error) {
    return { ready: false, missingTables: [...REQUIRED_APPLICATION_TABLES], error };
  }
}
