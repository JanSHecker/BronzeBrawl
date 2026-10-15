import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompanionConnection1792100000000 implements MigrationInterface {
  name = 'CompanionConnection1792100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game"
      ADD COLUMN "companionTokenHash" character varying,
      ADD COLUMN "lastCompanionAt" TIMESTAMP,
      ADD COLUMN "companionAvailability" character varying`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game"
      DROP COLUMN "companionAvailability",
      DROP COLUMN "lastCompanionAt",
      DROP COLUMN "companionTokenHash"`);
  }
}
