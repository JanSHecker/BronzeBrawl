import { randomInt } from 'crypto';
import defaults from './reward-catalog.json';

export const REWARD_UNITS = ['sips', 'shots', 'chugs'] as const;
export type RewardUnit = typeof REWARD_UNITS[number];
export type Amounts = Record<RewardUnit, number>;
export type Difficulty = 'easy' | 'baseline' | 'hard' | 'terror';
export interface RewardChoice {
  id: string;
  name?: string;
  effect?: string;
  amount?: number;
  unit?: string;
  mode?: string;
  tier?: string;
  amounts?: Partial<Amounts>;
  selfAmounts?: Partial<Amounts>;
  failureAmounts?: Partial<Amounts>;
  randomBonus?: Partial<Amounts>;
  shield?: Partial<Amounts>;
  shieldPoints?: number;
  timeSeconds?: number;
  failureTimeSeconds?: number;
  forceSwitch?: boolean;
  breaksShields?: boolean;
  successChance?: number;
  minTargets?: number;
  maxTargets?: number;
  perTarget?: boolean;
  weight?: number;
  conversions?: { shots: number; chugs: number };
}
export interface RewardDistribution {
  choiceId: string;
  remaining: Amounts;
  version: number;
  targets: Record<string, Amounts>;
  outcome: 'success' | 'backfire';
  lastResult?: any;
}

export const emptyAmounts = (): Amounts => ({ sips: 0, shots: 0, chugs: 0 });
export const unitCount = (amounts: Partial<Amounts>): number => REWARD_UNITS.reduce((n, unit) => n + (amounts?.[unit] || 0), 0);
export const nextRewardUnit = (amounts: Amounts): RewardUnit | undefined => REWARD_UNITS.find(unit => amounts[unit] > 0);

function setting(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isFinite(value) || value <= 0 || value > 10000) throw new Error(`Invalid ${key}`);
  return value;
}

/** Fractional native units convert DOWN to sips; sips never convert up. Round only once. */
export function scaleAmounts(source: Partial<Amounts> = {}, multiplier = 1, conversions = { shots: 5, chugs: 15 }): Amounts {
  const result = emptyAmounts();
  let sips = (source.sips || 0) * multiplier;
  for (const unit of ['shots', 'chugs'] as const) {
    const scaled = (source[unit] || 0) * multiplier;
    result[unit] = Math.floor(scaled);
    sips += (scaled - result[unit]) * conversions[unit];
  }
  result.sips = Math.max(0, Math.ceil(sips - 1e-9));
  return result;
}

export function sipVolume(source: Partial<Amounts>, conversions: { shots: number; chugs: number }): number {
  return (source.sips || 0) + (source.shots || 0) * conversions.shots + (source.chugs || 0) * conversions.chugs;
}

export function rewardConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const conversions = { shots: setting(env, 'SIPS_PER_SHOT', 5), chugs: setting(env, 'SIPS_PER_CHUG', 15) };
  if (!Object.values(conversions).every(Number.isInteger)) throw new Error('Shield conversions must be whole sip counts');
  const multipliers = {
    easy: setting(env, 'DIFFICULTY_EASY', 0.5), baseline: setting(env, 'DIFFICULTY_BASELINE', 1),
    hard: setting(env, 'DIFFICULTY_HARD', 1.5), terror: setting(env, 'DIFFICULTY_TERROR', 2),
  };
  const overrides = env.REWARD_CATALOG_OVERRIDES ? JSON.parse(env.REWARD_CATALOG_OVERRIDES) : {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Reward overrides must be an object keyed by ID');
  const ids = Object.values(defaults).flat().map(row => row.id);
  if (Object.keys(overrides).some(id => !ids.includes(id))) throw new Error('Unknown reward override');
  const pools: Record<string, RewardChoice[]> = {};
  for (const [pool, entries] of Object.entries(defaults)) {
    pools[pool] = entries.map(entry => {
      const choice: RewardChoice = { ...entry, ...overrides[entry.id], id: entry.id };
      if (overrides[entry.id] !== undefined && (!overrides[entry.id] || typeof overrides[entry.id] !== 'object' || Array.isArray(overrides[entry.id]))) throw new Error(`Invalid override: ${entry.id}`);
      if (!['single', 'split', 'free', 'random', 'scatter', 'team', 'self', 'enemy_team'].includes(choice.mode)) throw new Error(`Invalid reward mode: ${entry.id}`);
      for (const field of ['amounts', 'selfAmounts', 'failureAmounts', 'randomBonus', 'shield']) {
        if (choice[field] !== undefined && (!choice[field] || typeof choice[field] !== 'object' || Array.isArray(choice[field]))) throw new Error(`Invalid ${entry.id}.${field}`);
        for (const [unit, amount] of Object.entries(choice[field] || {})) {
          if (!REWARD_UNITS.includes(unit as RewardUnit) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error(`Invalid ${entry.id}.${field}`);
        }
      }
      for (const field of ['timeSeconds', 'failureTimeSeconds']) {
        if (choice[field] !== undefined && (!Number.isInteger(choice[field]) || Math.abs(choice[field]) > 3600)) throw new Error(`Invalid ${entry.id}.${field}`);
      }
      if (choice.successChance !== undefined && (!Number.isFinite(choice.successChance) || choice.successChance <= 0 || choice.successChance > 1)) throw new Error(`Invalid odds: ${entry.id}`);
      if (choice.weight !== undefined && (!Number.isFinite(choice.weight) || choice.weight <= 0)) throw new Error(`Invalid weight: ${entry.id}`);
      for (const field of ['minTargets', 'maxTargets']) {
        if (choice[field] !== undefined && (!Number.isInteger(choice[field]) || choice[field] < 1 || choice[field] > 5)) throw new Error(`Invalid ${entry.id}.${field}`);
      }
      for (const field of ['forceSwitch', 'breaksShields', 'perTarget']) {
        if (choice[field] !== undefined && typeof choice[field] !== 'boolean') throw new Error(`Invalid ${entry.id}.${field}`);
      }
      if (choice.perTarget && !choice.minTargets) throw new Error(`Missing recipient count: ${entry.id}`);
      if ((choice.maxTargets || 5) < (choice.minTargets || 1)) throw new Error(`Invalid recipient range: ${entry.id}`);
      if (pool === 'revenge' && !['small', 'risky'].includes(choice.tier)) throw new Error(`Invalid revenge tier: ${entry.id}`);
      if (choice.mode === 'self' && unitCount(choice.amounts)) throw new Error(`Self reward cannot distribute: ${entry.id}`);
      if (pool === 'legendary' && !choice.breaksShields) throw new Error('Every legendary must break shields');
      if (pool === 'pentakill' && (choice.mode !== 'enemy_team' || !choice.breaksShields)) throw new Error('Pentakill must target and break enemy shields only');
      return choice;
    });
  }
  if (pools.epic.filter(choice => choice.breaksShields).length !== 1) throw new Error('Exactly one epic must break shields');
  return { conversions, multipliers, pools };
}

export function scaledChoice(choice: RewardChoice, difficulty: Difficulty, config: ReturnType<typeof rewardConfiguration>): RewardChoice {
  const multiplier = config.multipliers[difficulty];
  if (!multiplier) throw new Error('Invalid difficulty');
  const result = { ...choice, conversions: { ...config.conversions } };
  for (const field of ['amounts', 'selfAmounts', 'failureAmounts', 'randomBonus'] as const) result[field] = scaleAmounts(choice[field], multiplier, config.conversions);
  result.shieldPoints = Math.ceil(sipVolume(choice.shield || {}, config.conversions) * multiplier);
  if (!Number.isSafeInteger(result.shieldPoints) || result.shieldPoints > 1_000_000
    || ['amounts', 'selfAmounts', 'failureAmounts', 'randomBonus'].some(field => unitCount(result[field]) > 1000)) throw new Error(`Reward exceeds supported budget: ${choice.id}`);
  return result;
}

export function drawChoices(pool: RewardChoice[], revenge = false): RewardChoice[] {
  const pick = (choices: RewardChoice[]) => {
    const total = choices.reduce((n, choice) => n + (choice.weight || 1), 0);
    let roll = randomInt(1_000_000) / 1_000_000 * total;
    return choices.find(choice => (roll -= choice.weight || 1) < 0) || choices[choices.length - 1];
  };
  if (revenge) return ['small', 'risky'].map(tier => pick(pool.filter(choice => choice.tier === tier))).filter(Boolean);
  const first = pick(pool);
  return [first, pick(pool.filter(choice => choice.id !== first.id))].filter(Boolean);
}

export function targetAllowed(choice: RewardChoice, state: RewardDistribution, recipientId: number): boolean {
  const targets = Object.keys(state.targets);
  const existing = state.targets[String(recipientId)];
  const maximum = choice.mode === 'single' ? 1 : choice.maxTargets || Infinity;
  if (!existing && targets.length >= maximum) return false;
  const unit = nextRewardUnit(state.remaining);
  if (!unit) return false;
  if (choice.perTarget && (existing?.[unit] || 0) >= (choice.amounts?.[unit] || 0)) return false;
  const needed = Math.max(0, (choice.minTargets || 1) - targets.length);
  return !existing || unitCount(state.remaining) > needed;
}
