import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChampionAutoSelection1792900000000 implements MigrationInterface {
  name = 'ChampionAutoSelection1792900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player" ADD COLUMN "championSelectionEndsAtGameTime" double precision`);
    await queryRunner.query(`UPDATE "player" AS player
      SET "championSelectionEndsAtGameTime" = game."lastGameTime" + 30
      FROM "game" AS game
      WHERE player."gameGameId" = game."gameId"
        AND player."championChampionId" IS NULL
        AND player."previousChampionId" IS NOT NULL
        AND game."lastGameTime" IS NOT NULL AND game."state" <> 'ended'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "player" DROP COLUMN "championSelectionEndsAtGameTime"`);
  }
}
