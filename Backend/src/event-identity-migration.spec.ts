import { Table, TableUnique } from 'typeorm';
import { GameflowEventIdentity1710000002000 } from '../migrations/1710000002000-GameflowEventIdentity';

class EventIdentityQueryRunner {
  table = new Table({ name: 'event', uniques: [] });
  duplicateRows: any[] = [];
  query = jest.fn(async () => this.duplicateRows);
  createUniqueConstraint = jest.fn(async (_tableName: string, unique: TableUnique) => {
    this.table.uniques.push(unique);
  });
  getTable = jest.fn(async () => this.table);
}

describe('GameflowEventIdentity migration', () => {
  test('reports duplicate game/event identities before attempting the unique constraint', async () => {
    const queryRunner = new EventIdentityQueryRunner();
    queryRunner.duplicateRows = [{ gameId: 17, ingameId: 9, eventIds: [41, 44] }];

    await expect(new GameflowEventIdentity1710000002000().up(queryRunner as any))
      .rejects.toThrow(
        'gameId=17, ingameId=9, eventIds=[41, 44]',
      );
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.createUniqueConstraint).not.toHaveBeenCalled();
  });

  test('creates the identity constraint after a clean preflight and remains idempotent', async () => {
    const queryRunner = new EventIdentityQueryRunner();
    const migration = new GameflowEventIdentity1710000002000();

    await migration.up(queryRunner as any);
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledTimes(1);
    expect(queryRunner.table.uniques[0].columnNames).toEqual(['gameGameId', 'ingameId']);

    await migration.up(queryRunner as any);
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.createUniqueConstraint).toHaveBeenCalledTimes(1);
  });
});
