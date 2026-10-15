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
      await queryRunner.createUniqueConstraint('event', this.unique);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('event');
    const unique = table?.uniques.find((candidate) => candidate.name === this.unique.name);
    if (unique) await queryRunner.dropUniqueConstraint('event', unique);
  }
}
