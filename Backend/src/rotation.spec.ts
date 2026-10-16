import { championSelectionRemainingSeconds, rotationRemainingSeconds } from './rotation';
import { ChampionRotationTimer1792300000000 } from '../migrations/1792300000000-ChampionRotationTimer';
import { TimeOnlyRotation1792400000000 } from '../migrations/1792400000000-TimeOnlyRotation';

test('rotation time preserves fractional seconds, clamps expired timers and treats missing data as unknown', () => {
  expect(rotationRemainingSeconds({ rotationEndsAtGameTime: 180 }, 179.5)).toBe(0.5);
  expect(rotationRemainingSeconds({ rotationEndsAtGameTime: 180 }, 181)).toBe(0);
  for (const deadline of [undefined, null, NaN, Infinity]) {
    expect(rotationRemainingSeconds({ rotationEndsAtGameTime: deadline }, 0)).toBeNull();
  }
  expect(rotationRemainingSeconds(null, 0)).toBeNull();
  expect(rotationRemainingSeconds({ rotationEndsAtGameTime: 180 }, null)).toBeNull();
});

test('selection countdown uses the persisted game-time deadline only while unassigned', () => {
  expect(championSelectionRemainingSeconds({ championSelectionEndsAtGameTime: 220 }, 190)).toBe(30);
  expect(championSelectionRemainingSeconds({ championSelectionEndsAtGameTime: 220 }, 221)).toBe(0);
  expect(championSelectionRemainingSeconds({ championSelectionEndsAtGameTime: 220, champion: {} }, 190)).toBeNull();
  expect(championSelectionRemainingSeconds({}, 190)).toBeNull();
});

test('timer migration adds a nullable fractional game-time deadline and is reversible', async () => {
  const query = jest.fn();
  const migration = new ChampionRotationTimer1792300000000();
  await migration.up({ query } as any);
  expect(query).toHaveBeenLastCalledWith('ALTER TABLE "champion" ADD COLUMN "rotationEndsAtGameTime" double precision');
  await migration.down({ query } as any);
  expect(query).toHaveBeenLastCalledWith('ALTER TABLE "champion" DROP COLUMN "rotationEndsAtGameTime"');
});

test('time-only migration backfills active owned champions without replacing existing deadlines or deleting old data', async () => {
  const query = jest.fn();
  const migration = new TimeOnlyRotation1792400000000();
  await migration.up({ query } as any);
  expect(query.mock.calls[0][0]).toBe('ALTER TABLE "game" ALTER COLUMN "rotationMode" SET DEFAULT \'Time\'');
  expect(query.mock.calls[1][0]).toContain('game."lastGameTime" + 180');
  expect(query.mock.calls[1][0]).toContain('player."championChampionId" = champion."championId"');
  expect(query.mock.calls[1][0]).toContain('champion."rotationEndsAtGameTime" IS NULL');
  expect(query.mock.calls[1][0]).toContain('game."state" <> \'ended\'');
  expect(query.mock.calls.flat().join(' ')).not.toMatch(/DROP COLUMN|DELETE FROM/);
  await migration.down({ query } as any);
  expect(query).toHaveBeenLastCalledWith('ALTER TABLE "game" ALTER COLUMN "rotationMode" DROP DEFAULT');
});
