import { MigrationInterface, QueryRunner } from 'typeorm';

export class MysteryBoxes1792600000000 implements MigrationInterface {
  name = 'MysteryBoxes1792600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player"
      ADD COLUMN "chestProgress" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "reward"
      ADD COLUMN "chestType" character varying NOT NULL DEFAULT 'standard',
      ADD COLUMN "openedAt" TIMESTAMP,
      ADD COLUMN "choices" jsonb,
      ADD COLUMN "sourceEventId" integer`);
    await queryRunner.query(`ALTER TABLE "punishment"
      ADD COLUMN "unit" character varying NOT NULL DEFAULT 'sips',
      ADD COLUMN "remainingAmount" integer`);
    await queryRunner.query(`UPDATE "punishment" SET "remainingAmount" = CASE WHEN "recieved" THEN 0 ELSE "amount" END`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "punishment" DROP COLUMN "remainingAmount", DROP COLUMN "unit"`);
    await queryRunner.query(`ALTER TABLE "reward" DROP COLUMN "sourceEventId", DROP COLUMN "choices", DROP COLUMN "openedAt", DROP COLUMN "chestType"`);
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "chestProgress"`);
  }
}
