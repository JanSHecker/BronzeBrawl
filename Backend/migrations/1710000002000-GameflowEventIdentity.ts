import { MigrationInterface, QueryRunner, TableUnique } from 'typeorm';

/** Make feed event identity durable across processes and service restarts. */
export class GameflowEventIdentity1710000002000 implements MigrationInterface {
  name = 'GameflowEventIdentity1710000002000';

  private readonly unique = new TableUnique({
    name: 'UQ_event_game_ingame',
    columnNames: ['gameGameId', 'ingameId'],
  });

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('event');
    if (!table) throw new Error('Gameflow event identity migration requires the event table');
    if (!(table.uniques || []).some((unique) => unique.columnNames.length === 2
      && unique.columnNames[0] === 'gameGameId' && unique.columnNames[1] === 'ingameId')) {
      const duplicates = await queryRunner.query(`
        SELECT "gameGameId" AS "gameId", "ingameId", ARRAY_AGG("eventId" ORDER BY "eventId") AS "eventIds"
        FROM "event"
        WHERE "gameGameId" IS NOT NULL
        GROUP BY "gameGameId", "ingameId"
        HAVING COUNT(*) > 1
        ORDER BY "gameGameId", "ingameId"
      `);
      if (duplicates.length) {
        const identities = duplicates.map((duplicate: { gameId: number | string; ingameId: number | string; eventIds: Array<number | string> }) =>
          `gameId=${duplicate.gameId}, ingameId=${duplicate.ingameId}, eventIds=[${duplicate.eventIds.join(', ')}]`).join('; ');
        throw new Error(
          `Gameflow event identity migration blocked: duplicate event identities exist (${identities}). `
          + 'Resolve or merge the listed event rows, then rerun the migration; no rows were deleted automatically.',
        );
      }
      await queryRunner.createUniqueConstraint('event', this.unique);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('event');
    const unique = table?.uniques.find((candidate) => candidate.name === this.unique.name);
    if (unique) await queryRunner.dropUniqueConstraint('event', unique);
  }
}
