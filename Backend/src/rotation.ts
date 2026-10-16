export const TIME_ROTATION_DURATION_SECONDS = 180;

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
