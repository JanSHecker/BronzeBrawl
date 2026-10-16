import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShieldCap1792800000000 implements MigrationInterface {
  name = 'ShieldCap1792800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "player" SET "shield" = 10 WHERE "shield" > 10`);
  }

  async down(): Promise<void> {
    // Previous shield balances cannot be reconstructed; leave current balances intact.
  }
}
