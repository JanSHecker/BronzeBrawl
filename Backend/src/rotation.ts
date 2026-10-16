export const TIME_ROTATION_DURATION_SECONDS = 180;
export const CHAMPION_SELECTION_GRACE_SECONDS = 30;

export function championSelectionRemainingSeconds(
  player: { championSelectionEndsAtGameTime?: number | null; champion?: unknown },
  gameTime: number | null | undefined,
): number | null {
  if (player.champion) return null;
  return rotationRemainingSeconds({ rotationEndsAtGameTime: player.championSelectionEndsAtGameTime }, gameTime);
}

/** Deadlines use LoL game seconds, not wall-clock time. Effects can shift the
 * champion's persisted deadline without changing the base duration or owner. */
export function rotationRemainingSeconds(
  champion: { rotationEndsAtGameTime?: number | null } | null,
  gameTime: number | null | undefined,
): number | null {
  const deadline = champion?.rotationEndsAtGameTime;
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)
    || typeof gameTime !== 'number' || !Number.isFinite(gameTime)) return null;
  return Math.max(0, deadline - gameTime);
}
