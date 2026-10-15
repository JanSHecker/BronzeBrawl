import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Persist gameflow state and capability material without ever storing raw tokens. */
export class GameflowSecurity1710000001000 implements MigrationInterface {
  name = 'GameflowSecurity1710000001000';

  private readonly columns: Record<string, TableColumn[]> = {
    game: [
      new TableColumn({ name: 'state', type: 'character varying', default: "'waiting_for_feed'" }),
      new TableColumn({ name: 'hostTokenHash', type: 'character varying', isNullable: true }),
      new TableColumn({ name: 'lastGameTime', type: 'double precision', isNullable: true }),
      new TableColumn({ name: 'lastFeedAt', type: 'timestamp without time zone', isNullable: true }),
      new TableColumn({ name: 'rosterFingerprint', type: 'character varying', isNullable: true }),
      new TableColumn({ name: 'feedSnapshot', type: 'jsonb', isNullable: true }),
    ],
    player: [new TableColumn({ name: 'playerTokenHash', type: 'character varying', isNullable: true })],
    champion: [
      new TableColumn({ name: 'riotId', type: 'character varying', isNullable: true }),
      new TableColumn({ name: 'riotIdGameName', type: 'character varying', isNullable: true }),
      new TableColumn({ name: 'riotIdTagLine', type: 'character varying', isNullable: true }),
    ],
    event: [new TableColumn({ name: 'payload', type: 'jsonb', isNullable: true })],
  };

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [tableName, columns] of Object.entries(this.columns)) {
      for (const column of columns) {
        if (!(await queryRunner.hasColumn(tableName, column.name))) await queryRunner.addColumn(tableName, column);
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [tableName, columns] of Object.entries(this.columns)) {
      for (const column of [...columns].reverse()) {
        if (await queryRunner.hasColumn(tableName, column.name)) await queryRunner.dropColumn(tableName, column.name);
      }
    }
  }
}
