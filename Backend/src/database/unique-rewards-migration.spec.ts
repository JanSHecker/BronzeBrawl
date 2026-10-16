import { UniqueRewards1792700000000 } from '../../migrations/1792700000000-UniqueRewards';

test('unique reward migration adds durable distribution, shields, difficulty and forced-rotation history without rewriting punishments', async () => {
  const query = jest.fn().mockResolvedValue(undefined);
  await new UniqueRewards1792700000000().up({ query } as any);
  const sql = query.mock.calls.map(([statement]) => statement).join('\n');
  expect(sql).toContain('"distribution" jsonb');
  expect(sql).toContain('"shield" integer NOT NULL DEFAULT 0');
  expect(sql).toContain('"difficulty" character varying NOT NULL DEFAULT \'baseline\'');
  expect(sql).toContain('"previousChampionId" integer');
  expect(sql).not.toMatch(/UPDATE|DELETE|TRUNCATE|DROP|ALTER TABLE "punishment"/);
});
