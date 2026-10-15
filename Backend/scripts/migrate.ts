import dataSource from '../data-source';
import { MigrationExecutor } from 'typeorm';

const MIGRATION_LOCK = 782493105;

export async function migrate(command = 'run'): Promise<void> {
  await dataSource.initialize();
  // The executor receives this same runner, so the advisory lock covers the
  // migration ledger and transactional DDL on the same PostgreSQL session.
  const lock = dataSource.createQueryRunner();
  try {
    await lock.connect();
    await lock.query(`SET statement_timeout TO '120s'`);
    await lock.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    if (dataSource.migrations.length === 0) {
      throw new Error('No frozen migrations found. Generate/review the initial migration before deployment.');
    }
    const executor = new MigrationExecutor(dataSource, lock);
    executor.transaction = 'all';
    if (command === 'run') {
      const applied = await executor.executePendingMigrations();
      console.log(`Migrations applied: ${applied.length}`);
    } else if (command === 'revert') {
      await executor.undoLastMigration();
      console.log('Last migration reverted; application must remain stopped until compatible.');
    } else if (command === 'show') {
      console.log(`Pending migrations: ${await executor.showMigrations()}`);
    } else {
      throw new Error('Expected migration command: run, show, or revert');
    }
  } finally {
    try { await lock.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`); }
    finally { await lock.release(); await dataSource.destroy(); }
  }
}

if (require.main === module) {
  migrate(process.argv[2]).catch((error) => {
    // Avoid emitting connection URLs/passwords or arbitrary query parameters.
    console.error(`Migration failed (${error.code || error.name || 'error'}). Check database/schema and reviewed migration files.`);
    if (String(error.message).startsWith('No frozen migrations')) console.error(error.message);
    process.exitCode = 1;
  });
}
