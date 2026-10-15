import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { patchOf, REGIONS, ReplayScores, validId } from './replay.types';
import { scoreMatch } from './replay-scoring';

export class ReplayAnalysisError extends Error {}
@Injectable()
export class RiotClient {
  private cooldownUntil = 0;
  configured(): boolean { return !!process.env.RIOT_API_KEY?.trim(); }
  async pause(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }
  private async fetch(url: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.cooldownUntil > Date.now()) await this.pause(this.cooldownUntil - Date.now());
      try {
        return (await axios.get(url, { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY }, timeout: 10000,
          maxRedirects: 0, maxContentLength: 16 * 1024 * 1024, responseType: 'json' })).data;
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) throw new ReplayAnalysisError('Riot authorization failed');
        if (status === 404) throw new ReplayAnalysisError('Riot match not found');
        if (status === 429) {
          const raw = error.response.headers?.['retry-after'];
          const seconds = Number(raw);
          const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(raw) - Date.now();
          this.cooldownUntil = Date.now() + Math.min(120000, Math.max(1000, Number.isFinite(delay) ? delay : 10000));
          if (attempt === 2) throw new ReplayAnalysisError('Riot rate limit; retry later');
        } else {
          if (status && status < 500) throw new ReplayAnalysisError('Riot request rejected');
          if (attempt === 2) throw new ReplayAnalysisError('Riot unavailable or request timed out');
          this.cooldownUntil = Date.now() + 1000 * 2 ** attempt;
        }
      }
    }
    throw new ReplayAnalysisError('Riot unavailable');
  }
  async analyze(id: string, gameVersion: string): Promise<ReplayScores> {
    validId(id); patchOf(gameVersion);
    if (!this.configured()) throw new ReplayAnalysisError('Riot API key is not configured');
    const base = `https://${REGIONS[id.split('_')[0]]}.api.riotgames.com/lol/match/v5/matches/${id}`;
    const match = await this.fetch(base);
    try {
      if (patchOf(match?.info?.gameVersion) !== patchOf(gameVersion)) throw new Error();
      scoreMatch(id, match, null);
    } catch { throw new ReplayAnalysisError('Invalid Match-V5 identity, version or match data'); }
    let timeline = null, timelineError: string = null;
    try { timeline = await this.fetch(`${base}/timeline`); }
    catch (e) { timelineError = e instanceof ReplayAnalysisError ? e.message : 'Riot timeline unavailable'; }
    const scores = scoreMatch(id, match, timeline);
    if (timelineError) scores.metrics.timelineError = timelineError;
    return scores;
  }
}
