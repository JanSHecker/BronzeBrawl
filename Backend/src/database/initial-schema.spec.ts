import { Table, TableIndex } from 'typeorm';
import { InitialSchema1710000000000 } from '../../migrations/1710000000000-InitialSchema';

/** A small in-memory QueryRunner models TypeORM's createTable(true) semantics. */
class ExistingSchemaQueryRunner {
  readonly tables = new Map<string, Table>();
  foreignKeyCreates = 0;
  indexCreates = 0;

  async createTable(table: Table): Promise<void> {
    if (!this.tables.has(table.name)) this.tables.set(table.name, table);
  }

  async getTable(name: string): Promise<Table | undefined> {
    return this.tables.get(name);
  }

  async createForeignKey(tableName: string, foreignKey: any): Promise<void> {
    this.tables.get(tableName)!.foreignKeys.push(foreignKey);
    this.foreignKeyCreates += 1;
  }

  async createIndex(tableName: string, index: TableIndex): Promise<void> {
    this.tables.get(tableName)!.indices.push(index);
    this.indexCreates += 1;
  }
}

describe('InitialSchema migration compatibility', () => {
  test('can be applied again to an existing synchronized schema without duplicate constraints', async () => {
    const queryRunner = new ExistingSchemaQueryRunner();
    const migration = new InitialSchema1710000000000();

    await migration.up(queryRunner as any);
    const firstForeignKeyCreates = queryRunner.foreignKeyCreates;
    const firstIndexCreates = queryRunner.indexCreates;

    // This is the state a prior synchronize or a partially completed migration
    // leaves behind: all tables and constraints already exist.
    await migration.up(queryRunner as any);

    expect(queryRunner.foreignKeyCreates).toBe(firstForeignKeyCreates);
    expect(queryRunner.indexCreates).toBe(firstIndexCreates);
    expect(queryRunner.tables.size).toBe(9);
  });
});
