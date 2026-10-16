import { ChampionAutoSelection1792900000000 } from '../../migrations/1792900000000-ChampionAutoSelection';

test('selection migration backfills only rotated waiting players in active games and is reversible', async () => {
  const query = jest.fn();
  const migration = new ChampionAutoSelection1792900000000();
  await migration.up({ query } as any);
  expect(query.mock.calls[0][0]).toBe('ALTER TABLE "player" ADD COLUMN "championSelectionEndsAtGameTime" double precision');
  const backfill = query.mock.calls[1][0];
  expect(backfill).toContain('game."lastGameTime" + 30');
  expect(backfill).toContain('player."championChampionId" IS NULL');
  expect(backfill).toContain('player."previousChampionId" IS NOT NULL');
  expect(backfill).toContain('game."lastGameTime" IS NOT NULL');
  expect(backfill).toContain('game."state" <> \'ended\'');
  await migration.down({ query } as any);
  expect(query).toHaveBeenLastCalledWith('ALTER TABLE "player" DROP COLUMN "championSelectionEndsAtGameTime"');
});
