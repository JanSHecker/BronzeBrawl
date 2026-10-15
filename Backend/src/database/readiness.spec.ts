import { checkDatabaseReadiness, REQUIRED_APPLICATION_TABLES } from './readiness';

describe('database readiness', () => {
  test('is not ready when application tables are missing', async () => {
    const result = await checkDatabaseReadiness({
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ table_name: 'game' }]),
    });
    expect(result.ready).toBe(false);
    expect(result.missingTables).toContain('player');
  });

  test('is ready only when every required table exists', async () => {
    const result = await checkDatabaseReadiness({
      isInitialized: true,
      query: jest.fn().mockResolvedValue(REQUIRED_APPLICATION_TABLES.map((table_name) => ({ table_name }))),
    });
    expect(result).toEqual({ ready: true, missingTables: [] });
  });

  test('reports an unavailable database as not ready', async () => {
    const result = await checkDatabaseReadiness({
      isInitialized: true,
      query: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    expect(result.ready).toBe(false);
    expect(result.missingTables).toEqual([...REQUIRED_APPLICATION_TABLES]);
  });
});
