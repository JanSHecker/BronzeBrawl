import { ShieldCap1792800000000 } from '../../migrations/1792800000000-ShieldCap';

test('caps existing shields without changing lower balances or outstanding punishments', async () => {
  const query = jest.fn().mockResolvedValue(undefined);
  const migration = new ShieldCap1792800000000();
  await migration.up({ query } as any);
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith('UPDATE "player" SET "shield" = 10 WHERE "shield" > 10');
  await migration.down();
  expect(query).toHaveBeenCalledTimes(1);
});
