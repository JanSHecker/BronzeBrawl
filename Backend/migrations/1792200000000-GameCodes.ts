import { randomInt } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class GameCodes1792200000000 implements MigrationInterface {
  name = 'GameCodes1792200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game"
      ADD COLUMN "gameCode" character varying(4),
      ADD CONSTRAINT "UQ_game_gameCode" UNIQUE ("gameCode"),
      ADD CONSTRAINT "CHK_game_gameCode" CHECK ("gameCode" ~ '^[A-Z]{4}$')`);

    // Preserve existing live rounds, but do not make finished games joinable.
    const games = await queryRunner.query(`SELECT "gameId" FROM "game" WHERE "state" IS DISTINCT FROM 'ended' ORDER BY "gameId"`);
    if (games.length > 26 ** 4) throw new Error('Game code space exhausted');
    const used = new Set<string>();
    for (const game of games) {
      let code: string;
      do { code = Array.from({ length: 4 }, () => String.fromCharCode(65 + randomInt(26))).join(''); }
      while (used.has(code));
      used.add(code);
      await queryRunner.query(`UPDATE "game" SET "gameCode" = $1 WHERE "gameId" = $2`, [code, game.gameId]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game" DROP COLUMN "gameCode"`);
  }
}
