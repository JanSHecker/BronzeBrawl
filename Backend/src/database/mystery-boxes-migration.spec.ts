import { MysteryBoxes1792600000000 } from '../../migrations/1792600000000-MysteryBoxes';

describe('mystery chest migration', () => {
  test('adds durable state without deleting existing rewards or changing game rules', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MysteryBoxes1792600000000().up({ query } as any);
    const statements = query.mock.calls.map(([sql]) => sql).join('\n');
    expect(statements).toContain('"chestProgress" jsonb NOT NULL DEFAULT');
    expect(statements).not.toMatch(/rotation/i);
    expect(statements).toContain('"chestType" character varying NOT NULL DEFAULT \'standard\'');
    expect(statements).toContain('"choices" jsonb');
    expect(statements).toContain('"unit" character varying NOT NULL DEFAULT \'sips\'');
    expect(statements).toContain('CASE WHEN "recieved" THEN 0 ELSE "amount" END');
    expect(statements).not.toMatch(/DELETE|TRUNCATE|DROP|UPDATE "game"/);
  });
});
