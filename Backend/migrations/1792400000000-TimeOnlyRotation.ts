import { MigrationInterface, QueryRunner } from 'typeorm';

export class TimeOnlyRotation1792400000000 implements MigrationInterface {
  name = 'TimeOnlyRotation1792400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Keep obsolete columns/data for rollback, but no longer map or read them.
    // The old NOT NULL column still needs a default for new games.
    await queryRunner.query(`ALTER TABLE "game" ALTER COLUMN "rotationMode" SET DEFAULT 'Time'`);
    // Preserve timers from existing time games, including effect adjustments.
    await queryRunner.query(`UPDATE "champion" AS champion
      SET "rotationEndsAtGameTime" = game."lastGameTime" + 180
      FROM "player" AS player JOIN "game" AS game ON game."gameId" = player."gameGameId"
      WHERE player."championChampionId" = champion."championId"
        AND champion."rotationEndsAtGameTime" IS NULL
        AND game."lastGameTime" IS NOT NULL
        AND game."state" <> 'ended'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" ALTER COLUMN "rotationMode" DROP DEFAULT`);
  }
}
