export const CHEST_MILESTONES = {
  kills: { type: 'standard', target: 1 },
  assists: { type: 'support', target: 2 },
  revenge: { type: 'revenge', target: 3 },
  turret: { type: 'standard', target: 1 },
  epic: { type: 'epic', target: 1 },
  legendary: { type: 'legendary', target: 1 },
} as const;

export type ChestProgressKey = keyof typeof CHEST_MILESTONES;

export function objectiveMilestone(event: any): ChestProgressKey | null {
  switch (event.EventName) {
    case 'TurretKilled': return 'turret';
    case 'HordeKill':
    case 'VoidGrubKill':
    case 'HeraldKill': return 'epic';
    case 'DragonKill': return String(event.DragonType).toLowerCase() === 'elder' ? 'legendary' : 'epic';
    case 'BaronKill': return 'legendary';
    default: return null;
  }
}
