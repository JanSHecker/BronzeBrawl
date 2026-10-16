/** Timeline IDs occupy a disjoint, PostgreSQL-integer-safe namespace. */
export const TIMELINE_EVENT_BASE = 1_000_000_000;
export const NEUTRAL_OBJECTIVES = new Set(['DragonKill', 'BaronKill', 'HeraldKill', 'HordeKill', 'VoidGrubKill']);

export function baseChampionName(player: any): string {
  return /^game_character_(?:skin_)?displayname_Viego(?:_|$)/i.test(player.rawSkinName || '') ? 'Viego' : player.championName;
}

export const spreeChest = (kills: number): string => kills >= 8 ? 'legendary' : kills >= 3 ? 'epic' : 'standard';
export const spreeName = (kills: number): string | null => kills >= 8 ? 'Legendary'
  : ({ 3: 'Killing Spree', 4: 'Rampage', 5: 'Unstoppable', 6: 'Dominating', 7: 'Godlike' }[kills] || null);
export const MULTIKILL_CHESTS = { 2: 'standard', 3: 'epic', 4: 'legendary', 5: 'pentakill' } as const;

/** Rebuilt from persisted raw events: follows the LoL participant, not its current BB owner. */
export class CombatTracker {
  private sprees = new Map<number, number>();
  private chains = new Map<number, { start: number; time: number; kills: number }>();
  private awarded = new Set<string>();

  kill(raw: any, killer?: number, victim?: number): number {
    // An uncredited environment execution does not interrupt a killing spree.
    if (killer && victim) this.sprees.set(victim, 0);
    if (!killer) return 0;
    const spree = (this.sprees.get(killer) || 0) + 1;
    this.sprees.set(killer, spree);
    const previous = this.chains.get(killer);
    const at = raw.EventTime;
    const gap = previous && at - previous.time;
    if (typeof at === 'number' && previous && gap >= 0 && gap <= (previous.kills === 4 ? 30 : 10)) {
      previous.kills++;
      previous.time = at;
    } else {
      this.chains.set(killer, { start: raw.EventID, time: at, kills: 1 });
    }
    return spree;
  }

  multikill(raw: any, killer: number): boolean {
    const chain = this.chains.get(killer);
    if (!chain || !Number.isFinite(chain.time) || Math.abs(chain.time - raw.EventTime) > 0.5 || chain.kills < raw.KillStreak) return false;
    const key = `${killer}:${chain.start}:${raw.KillStreak}`;
    if (this.awarded.has(key)) return false;
    this.awarded.add(key);
    return true;
  }
}
