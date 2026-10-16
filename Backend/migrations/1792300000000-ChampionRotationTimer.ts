import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChampionRotationTimer1792300000000 implements MigrationInterface {
  name = 'ChampionRotationTimer1792300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "champion" ADD COLUMN "rotationEndsAtGameTime" double precision`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "champion" DROP COLUMN "rotationEndsAtGameTime"`);
  }
}
