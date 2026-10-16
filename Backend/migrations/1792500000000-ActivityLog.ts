import { MigrationInterface, QueryRunner } from 'typeorm';

export class ActivityLog1792500000000 implements MigrationInterface {
  name = 'ActivityLog1792500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "activity_log" (
      "activityId" SERIAL NOT NULL,
      "gameId" integer NOT NULL,
      "type" character varying NOT NULL,
      "recordedAt" timestamp with time zone NOT NULL,
      "gameTime" double precision,
      "data" jsonb NOT NULL,
      CONSTRAINT "PK_activity_log" PRIMARY KEY ("activityId"),
      CONSTRAINT "FK_activity_log_game" FOREIGN KEY ("gameId") REFERENCES "game"("gameId") ON DELETE CASCADE
    )`);
    await queryRunner.query('CREATE INDEX "IDX_activity_log_game_activity" ON "activity_log" ("gameId", "activityId")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "activity_log"');
  }
}
