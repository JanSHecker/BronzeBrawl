import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueRewards1792700000000 implements MigrationInterface {
  name = 'UniqueRewards1792700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" ADD COLUMN "difficulty" character varying NOT NULL DEFAULT 'baseline'`);
    await queryRunner.query(`ALTER TABLE "player" ADD COLUMN "shield" integer NOT NULL DEFAULT 0,
      ADD COLUMN "previousChampionId" integer`);
    await queryRunner.query(`ALTER TABLE "reward" ADD COLUMN "distribution" jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reward" DROP COLUMN "distribution"`);
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "previousChampionId", DROP COLUMN "shield"`);
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "difficulty"`);
  }
}
