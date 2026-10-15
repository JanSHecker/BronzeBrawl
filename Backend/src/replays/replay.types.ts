import { BadRequestException } from '@nestjs/common';

export interface ReplayScores {
  version: 1; balance: number; carry: number; momentum: number | null; overall: number;
  metrics: Record<string, any>;
}
export interface ReplayItem {
  matchId: string; gameVersion: string; patch: string; sizeBytes: number; sha256: string; createdAt: string;
  analysisStatus: 'pending' | 'ready' | 'failed'; analysisError: string | null;
  scores: ReplayScores | null; reservedGameId: number | null;
}
export const REGIONS: Record<string, string> = {
  BR1: 'americas', LA1: 'americas', LA2: 'americas', NA1: 'americas',
  EUW1: 'europe', EUN1: 'europe', TR1: 'europe', RU: 'europe',
  KR: 'asia', JP1: 'asia', OC1: 'sea', PH2: 'sea', SG2: 'sea', TH2: 'sea', TW2: 'sea', VN2: 'sea', ME1: 'europe',
};
export const MAX_REPLAY_BYTES = 150 * 1024 * 1024;
export const SORT_KEYS = ['overall', 'balance', 'carry', 'momentum'] as const;
export type SortKey = typeof SORT_KEYS[number];
export function validId(id: string): string {
  const m = typeof id === 'string' && /^([A-Z0-9]+)_([1-9][0-9]{0,19})$/.exec(id);
  if (!m || !REGIONS[m[1]] || BigInt(m[2]) > 18446744073709551615n) throw new BadRequestException('Invalid Riot match ID');
  return id;
}
export function patchOf(version: string): string {
  if (typeof version !== 'string' || !/^[1-9][0-9]{0,2}\.[0-9]{1,3}\.[0-9]{1,10}\.[0-9]{1,10}$/.test(version)) throw new BadRequestException('A full game version is required');
  return version.split('.').slice(0, 2).map(Number).join('.');
}
export function sortKey(value?: string): SortKey {
  if (value !== undefined && !SORT_KEYS.includes(value as SortKey)) throw new BadRequestException('Invalid score sort');
  return (value || 'overall') as SortKey;
}
export function gameId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new BadRequestException('gameId must be a positive safe integer');
  return value as number;
}
