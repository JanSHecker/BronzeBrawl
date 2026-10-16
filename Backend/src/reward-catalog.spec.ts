import { GameflowService } from './gameflow.service';
import { Difficulty, rewardConfiguration, scaledChoice } from './rewards';

test.each(['easy', 'baseline', 'hard', 'terror'] as Difficulty[])('public catalogue includes every configured reward at %s without accessing a game', difficulty => {
  const config = rewardConfiguration();
  const service = new GameflowService({} as any);
  const result = service.getRewardCatalog(difficulty);
  expect(result).toMatchObject({ difficulty, multiplier: config.multipliers[difficulty], conversions: config.conversions, maxShield: 10 });
  expect(Object.keys(result.pools)).toEqual(Object.keys(config.pools));
  for (const [pool, choices] of Object.entries(config.pools)) {
    expect(result.pools[pool]).toEqual(choices.map(choice => scaledChoice(choice, difficulty, config)));
  }
  expect(Object.values(result.pools).flat()).toHaveLength(42);
  expect(result.pools.pentakill[0].shieldPoints).toBeLessThanOrEqual(10);
});

test('catalogue defaults to baseline and rejects unknown difficulties', () => {
  const service = new GameflowService({} as any);
  expect(service.getRewardCatalog().difficulty).toBe('baseline');
  for (const value of ['', 'extreme', 'toString', ['hard'], null]) {
    expect(() => service.getRewardCatalog(value as any)).toThrow('invalid difficulty');
  }
});

test('catalogue uses server overrides, conversion settings and difficulty multipliers', () => {
  const keys = ['REWARD_CATALOG_OVERRIDES', 'SIPS_PER_SHOT', 'DIFFICULTY_HARD'];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.REWARD_CATALOG_OVERRIDES = '{"marked":{"amounts":{"sips":4}}}';
    process.env.SIPS_PER_SHOT = '7';
    process.env.DIFFICULTY_HARD = '2';
    const result = new GameflowService({} as any).getRewardCatalog('hard');
    expect(result.conversions.shots).toBe(7);
    expect(result.multiplier).toBe(2);
    expect(result.pools.standard.find(choice => choice.id === 'marked').amounts.sips).toBe(8);
    expect(result.pools.epic.find(choice => choice.id === 'monster-hide').shieldPoints).toBe(10);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
