import { MAX_SHIELD } from '../constants';

export const shieldText = shield => `${shield || 0}/${MAX_SHIELD}`;
export const UNITS = ['sips', 'shots', 'chugs'];
export const DUMMY_RECIPIENT_ID = 'dummy';
export const nextUnit = amounts => UNITS.find(unit => amounts?.[unit] > 0);
export const amountText = amounts => UNITS.filter(unit => amounts?.[unit]).map(unit => `${amounts[unit]} ${unit}`).join(' + ');
export const normalizedChoice = choice => choice.effect === 'assign'
  ? { ...choice, name: 'Assign', mode: 'single', amounts: { sips: choice.amount } } : choice;

export function choiceDescription(input) {
  const choice = normalizedChoice(input);
  const parts = [];
  if (amountText(choice.amounts)) {
    const target = { single: 'to one opponent', split: 'between opponents', free: 'however you like', random: 'to a random opponent', scatter: 'randomly, one unit at a time', team: 'evenly across opponents', enemy_team: 'to every opponent' }[choice.mode];
    parts.push(`${amountText(choice.amounts)}${choice.perTarget || choice.mode === 'enemy_team' ? ' per target' : ' total'} ${target || ''}`);
  }
  if (choice.minTargets) parts.push(`${choice.minTargets}${choice.maxTargets !== choice.minTargets ? `–${choice.maxTargets}` : ''} targets`);
  if (amountText(choice.randomBonus)) parts.push(`Plus ${amountText(choice.randomBonus)} to another random opponent`);
  if (choice.timeSeconds) parts.push(`${choice.timeSeconds > 0 ? '+' : '−'}${Math.abs(choice.timeSeconds)}s champion lifetime`);
  if (choice.forceSwitch) parts.push('Switch champion immediately');
  if (amountText(choice.selfAmounts)) parts.push(`You receive ${amountText(choice.selfAmounts)}`);
  if (choice.shieldPoints) parts.push(`Gain ${Math.min(MAX_SHIELD, choice.shieldPoints)} shield points (max ${MAX_SHIELD} total)`);
  if (choice.successChance !== undefined) {
    const failure = [amountText(choice.failureAmounts) && `you receive ${amountText(choice.failureAmounts)}`, choice.failureTimeSeconds && `+${choice.failureTimeSeconds}s on your champion`].filter(Boolean).join('; ');
    parts.push(`${Math.round(choice.successChance * 100)}% success. Otherwise: ${failure}`);
  }
  return parts;
}

export function canTarget(choice, state, recipientId) {
  if (!choice || !state) return false;
  if (recipientId === DUMMY_RECIPIENT_ID) return Boolean(nextUnit(state.remaining));
  const targets = Object.keys(state.targets || {}).filter(id => id !== DUMMY_RECIPIENT_ID);
  const existing = state.targets?.[String(recipientId)];
  if (!existing && targets.length >= (choice.mode === 'single' ? 1 : choice.maxTargets || Infinity)) return false;
  const unit = nextUnit(state.remaining);
  if (!unit) return false;
  if (choice.perTarget && (existing?.[unit] || 0) >= (choice.amounts?.[unit] || 0)) return false;
  const remaining = UNITS.reduce((sum, key) => sum + (state.remaining?.[key] || 0), 0);
  return !existing || remaining > Math.max(0, (choice.minTargets || 1) - targets.length);
}
