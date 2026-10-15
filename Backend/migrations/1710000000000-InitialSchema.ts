import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
  TableUnique,
} from 'typeorm';

/**
 * Frozen schema for the entities in Backend/src/entities.
 *
 * This migration deliberately creates columns and relationships explicitly instead
 * of relying on synchronize. Keep later schema changes in new migrations.
 */

function sameColumns(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

async function assertCompatibleTable(queryRunner: QueryRunner, expected: Table): Promise<Table> {
  const actual = await queryRunner.getTable(expected.name);
  if (!actual) {
    throw new Error(`Initial schema is incompatible: required table "${expected.name}" is missing`);
  }

  const missingColumns = (expected.columns || [])
    .filter((expectedColumn) => !actual.columns.some((column) => column.name === expectedColumn.name))
    .map((column) => column.name);
  const incompatibleColumns = (expected.columns || [])
    .filter((expectedColumn) => {
      const actualColumn = actual.columns.find((column) => column.name === expectedColumn.name);
      if (!actualColumn) return false;
      return actualColumn.type.toLowerCase() !== expectedColumn.type.toLowerCase()
        || actualColumn.isNullable !== Boolean(expectedColumn.isNullable)
        || actualColumn.isPrimary !== Boolean(expectedColumn.isPrimary)
        || actualColumn.isGenerated !== Boolean(expectedColumn.isGenerated);
    })
    .map((column) => column.name);
  if (missingColumns.length || incompatibleColumns.length) {
    const details = [
      missingColumns.length ? `missing columns: ${missingColumns.join(', ')}` : '',
      incompatibleColumns.length ? `incompatible columns: ${incompatibleColumns.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Initial schema is incompatible for table "${expected.name}" (${details})`);
  }

  const missingUniques = (expected.uniques || [])
    .filter((expectedUnique) => !(actual.uniques || []).some((unique) => sameColumns(unique.columnNames, expectedUnique.columnNames)))
    .map((unique) => unique.columnNames.join(', '));
  if (missingUniques.length) {
    throw new Error(`Initial schema is incompatible for table "${expected.name}" (missing unique constraint on ${missingUniques.join('; ')})`);
  }

  return actual;
}

function sameForeignKey(left: TableForeignKey, right: TableForeignKey): boolean {
  return sameColumns(left.columnNames, right.columnNames)
    && left.referencedTableName === right.referencedTableName
    && sameColumns(left.referencedColumnNames, right.referencedColumnNames);
}

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      new Table({
        name: 'game',
        columns: [
          { name: 'gameId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'punishmentAmount', type: 'integer' },
          { name: 'rewardAmount', type: 'integer' },
          { name: 'rotationMode', type: 'character varying' },
          { name: 'defaultRotationCounter', type: 'integer', isNullable: true },
        ],
      }),
      new Table({
        name: 'team',
        columns: [
          { name: 'teamId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'teamName', type: 'integer' },
          { name: 'gameGameId', type: 'integer', isNullable: true },
        ],
      }),
      new Table({
        name: 'champion',
        columns: [
          { name: 'championId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'championName', type: 'character varying' },
          { name: 'summonerName', type: 'character varying' },
          { name: 'teamTeamId', type: 'integer', isNullable: true },
        ],
      }),
      new Table({
        name: 'player',
        columns: [
          { name: 'playerId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'playerName', type: 'character varying' },
          { name: 'killCounter', type: 'integer', default: 0 },
          { name: 'deathCounter', type: 'integer', default: 0 },
          { name: 'teamTeamId', type: 'integer', isNullable: true },
          { name: 'gameGameId', type: 'integer', isNullable: true },
          { name: 'championChampionId', type: 'integer', isNullable: true },
        ],
        uniques: [
          new TableUnique({ name: 'REL_29de01f1c70fb4b68b37f70fd4', columnNames: ['championChampionId'] }),
        ],
      }),
      new Table({
        name: 'punishment',
        columns: [
          { name: 'punishmentId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'amount', type: 'integer' },
          { name: 'punishmentType', type: 'integer' },
          { name: 'recieved', type: 'boolean', default: false },
          { name: 'playerPlayerId', type: 'integer', isNullable: true },
          { name: 'distributorPlayerId', type: 'integer', isNullable: true },
        ],
      }),
      new Table({
        name: 'reward',
        columns: [
          { name: 'rewardId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'amount', type: 'integer' },
          { name: 'rewardType', type: 'integer' },
          { name: 'distributed', type: 'boolean', default: false },
          { name: 'playerPlayerId', type: 'integer', isNullable: true },
        ],
      }),
      new Table({
        name: 'takedown',
        columns: [
          { name: 'takedownId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'multiKill', type: 'integer' },
          { name: 'shutdown', type: 'boolean' },
          { name: 'killerChampionId', type: 'integer', isNullable: true },
          { name: 'killedChampionId', type: 'integer', isNullable: true },
          { name: 'punishmentPunishmentId', type: 'integer', isNullable: true },
          { name: 'rewardRewardId', type: 'integer', isNullable: true },
        ],
        uniques: [
          new TableUnique({ name: 'REL_e3b673f6e68d4af9614ec9a4b9', columnNames: ['punishmentPunishmentId'] }),
          new TableUnique({ name: 'REL_58f0a49f91475c0239066c4bed', columnNames: ['rewardRewardId'] }),
        ],
      }),
      new Table({
        name: 'event',
        columns: [
          { name: 'eventId', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'ingameId', type: 'integer' },
          { name: 'eventType', type: 'character varying' },
          { name: 'gameGameId', type: 'integer', isNullable: true },
          { name: 'takedownTakedownId', type: 'integer', isNullable: true },
          { name: 'rewardRewardId', type: 'integer', isNullable: true },
        ],
        uniques: [
          new TableUnique({ name: 'REL_20fcf59bdf6c72dd30ff4b8bbe', columnNames: ['takedownTakedownId'] }),
          new TableUnique({ name: 'REL_629f04a6878fe128792a7f8fa0', columnNames: ['rewardRewardId'] }),
        ],
      }),
      new Table({
        name: 'champion_assists_takedown',
        columns: [
          { name: 'championChampionId', type: 'integer', isPrimary: true },
          { name: 'takedownTakedownId', type: 'integer', isPrimary: true },
        ],
      }),
    ];

    for (const table of tables) {
      // synchronize-created tables are deliberately retained; compatibility is
      // checked below rather than allowing createTable(true) to silently skip a
      // partial or incompatible table.
      await queryRunner.createTable(table, true);
      await assertCompatibleTable(queryRunner, table);
    }

    const foreignKeys: Array<{ table: string; foreignKey: TableForeignKey }> = [
      { table: 'team', foreignKey: new TableForeignKey({ name: 'FK_f14a242db81e2e7eb71270e4daa', columnNames: ['gameGameId'], referencedTableName: 'game', referencedColumnNames: ['gameId'] }) },
      { table: 'champion', foreignKey: new TableForeignKey({ name: 'FK_45d2cdec8f882b8b1044c65ae05', columnNames: ['teamTeamId'], referencedTableName: 'team', referencedColumnNames: ['teamId'] }) },
      { table: 'player', foreignKey: new TableForeignKey({ name: 'FK_3ac6a63695f713fff944c621cbd', columnNames: ['teamTeamId'], referencedTableName: 'team', referencedColumnNames: ['teamId'] }) },
      { table: 'player', foreignKey: new TableForeignKey({ name: 'FK_855b9eba93fb5e5c260fc6ce644', columnNames: ['gameGameId'], referencedTableName: 'game', referencedColumnNames: ['gameId'] }) },
      { table: 'player', foreignKey: new TableForeignKey({ name: 'FK_29de01f1c70fb4b68b37f70fd49', columnNames: ['championChampionId'], referencedTableName: 'champion', referencedColumnNames: ['championId'] }) },
      { table: 'punishment', foreignKey: new TableForeignKey({ name: 'FK_e4d0f45deded4fa340aec6b947e', columnNames: ['playerPlayerId'], referencedTableName: 'player', referencedColumnNames: ['playerId'] }) },
      { table: 'punishment', foreignKey: new TableForeignKey({ name: 'FK_aa559ba7ddaf5c32e47945dd512', columnNames: ['distributorPlayerId'], referencedTableName: 'player', referencedColumnNames: ['playerId'] }) },
      { table: 'reward', foreignKey: new TableForeignKey({ name: 'FK_2de4ebc8dfbe455c2c94d5c7875', columnNames: ['playerPlayerId'], referencedTableName: 'player', referencedColumnNames: ['playerId'] }) },
      { table: 'takedown', foreignKey: new TableForeignKey({ name: 'FK_64ba34bbee4af50000c9c190189', columnNames: ['killerChampionId'], referencedTableName: 'champion', referencedColumnNames: ['championId'] }) },
      { table: 'takedown', foreignKey: new TableForeignKey({ name: 'FK_5ccdd439283102f48f97279ff96', columnNames: ['killedChampionId'], referencedTableName: 'champion', referencedColumnNames: ['championId'] }) },
      { table: 'takedown', foreignKey: new TableForeignKey({ name: 'FK_e3b673f6e68d4af9614ec9a4b9b', columnNames: ['punishmentPunishmentId'], referencedTableName: 'punishment', referencedColumnNames: ['punishmentId'] }) },
      { table: 'takedown', foreignKey: new TableForeignKey({ name: 'FK_58f0a49f91475c0239066c4bed9', columnNames: ['rewardRewardId'], referencedTableName: 'reward', referencedColumnNames: ['rewardId'] }) },
      { table: 'event', foreignKey: new TableForeignKey({ name: 'FK_b9e431e7314624466902d11419c', columnNames: ['gameGameId'], referencedTableName: 'game', referencedColumnNames: ['gameId'] }) },
      { table: 'event', foreignKey: new TableForeignKey({ name: 'FK_20fcf59bdf6c72dd30ff4b8bbe6', columnNames: ['takedownTakedownId'], referencedTableName: 'takedown', referencedColumnNames: ['takedownId'] }) },
      { table: 'event', foreignKey: new TableForeignKey({ name: 'FK_629f04a6878fe128792a7f8fa01', columnNames: ['rewardRewardId'], referencedTableName: 'reward', referencedColumnNames: ['rewardId'] }) },
      { table: 'champion_assists_takedown', foreignKey: new TableForeignKey({ name: 'FK_7d7e653c900a671782274e60566', columnNames: ['championChampionId'], referencedTableName: 'champion', referencedColumnNames: ['championId'] }) },
      { table: 'champion_assists_takedown', foreignKey: new TableForeignKey({ name: 'FK_697fad4236f81ea6b597aa66abe', columnNames: ['takedownTakedownId'], referencedTableName: 'takedown', referencedColumnNames: ['takedownId'] }) },
    ];

    for (const { table, foreignKey } of foreignKeys) {
      const actual = await queryRunner.getTable(table);
      if (!actual) {
        throw new Error(`Initial schema is incompatible: required table "${table}" is missing`);
      }
      const conflicting = (actual.foreignKeys || []).find((existing) =>
        sameColumns(existing.columnNames, foreignKey.columnNames) && !sameForeignKey(existing, foreignKey));
      if (conflicting) {
        throw new Error(`Initial schema is incompatible: table "${table}" has a conflicting foreign key on ${foreignKey.columnNames.join(', ')}`);
      }
      if (!(actual.foreignKeys || []).some((existing) => sameForeignKey(existing, foreignKey))) {
        await queryRunner.createForeignKey(table, foreignKey);
      }
    }

    for (const index of [
      new TableIndex({ name: 'IDX_7d7e653c900a671782274e6056', columnNames: ['championChampionId'] }),
      new TableIndex({ name: 'IDX_697fad4236f81ea6b597aa66abe', columnNames: ['takedownTakedownId'] }),
    ]) {
      const actual = await queryRunner.getTable('champion_assists_takedown');
      if (!actual) throw new Error('Initial schema is incompatible: join table is missing');
      const namedIndex = (actual.indices || []).find((existing) => existing.name === index.name);
      if (namedIndex && !sameColumns(namedIndex.columnNames, index.columnNames)) {
        throw new Error(`Initial schema is incompatible: index "${index.name}" has unexpected columns`);
      }
      if (!namedIndex && !(actual.indices || []).some((existing) => sameColumns(existing.columnNames, index.columnNames))) {
        await queryRunner.createIndex('champion_assists_takedown', index);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('champion_assists_takedown', true, true, true);
    for (const table of ['event', 'takedown', 'reward', 'punishment', 'player', 'champion', 'team', 'game']) {
      await queryRunner.dropTable(table, true, true, true);
    }
  }
}
