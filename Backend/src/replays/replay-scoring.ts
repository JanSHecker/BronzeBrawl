import { ReplayScores } from './replay.types';
const unit = (n: number) => Math.min(1, Math.max(0, n));
const points = (n: number) => Math.round(unit(n) * 10000) / 100;
const nonnegative = (v: any) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Formula v1. Only server-fetched Match-V5 objects enter this function. */
export function scoreMatch(id: string, match: any, timeline: any): ReplayScores {
  const info = match?.info;
  const p = info?.participants;
  if (match?.metadata?.matchId !== id || info?.mapId !== 11 || !Number.isFinite(info?.gameDuration) || info.gameDuration <= 0 ||
      !Array.isArray(p) || p.length !== 10 || new Set(p.map(x => x?.participantId)).size !== 10 ||
      p.some(x => !Number.isInteger(x?.participantId) || x.participantId < 1 || x.participantId > 10 ||
        ![100, 200].includes(x.teamId) || !Number.isSafeInteger(x.kills) || x.kills < 0 || !nonnegative(x.goldEarned)) ||
      [100, 200].some(teamId => p.filter(x => x.teamId === teamId).length !== 5)) throw new Error('Invalid Match-V5 match identity or data');
  const teams = [100, 200].map(teamId => {
    const players = p.filter(x => x.teamId === teamId).map(x => ({ participantId: x.participantId, teamId, kills: x.kills }));
    const kills = players.reduce((sum, x) => sum + x.kills, 0);
    const shares = players.map(x => kills ? x.kills / kills : 0);
    return { teamId, kills, players, killShares: shares, killConcentration: shares.reduce((sum, s) => sum + s * s, 0) };
  });
  const totalKills = teams[0].kills + teams[1].kills;
  const killParity = totalKills ? 1 - Math.abs(teams[0].kills - teams[1].kills) / totalKills : 1;
  const ranked = [...p].sort((a, b) => b.kills - a.kills || a.participantId - b.participantId);
  const leader = ranked[0];
  const concentration = Math.max(...teams.map(t => t.kills ? unit((Math.max(...t.killShares) - .2) / .8) * Math.min(1, t.kills / 10) : 0));
  const dominance = leader.kills ? (leader.kills - ranked[1].kills) / leader.kills : 0;
  const carry = .75 * concentration + .25 * dominance;
  let timelineStatus = timeline == null ? 'missing' : 'invalid';
  let gold: any = null;
  let momentum: number = null;
  try {
    const frames = timeline?.info?.frames;
    if (timeline?.metadata?.matchId !== id || !Array.isArray(frames) || frames.length < 2 || frames.length > 2000) throw new Error();
    let previous = -1;
    const samples = frames.map(frame => {
      if (!nonnegative(frame?.timestamp) || frame.timestamp <= previous || frame.timestamp > info.gameDuration * 1000 + 120000) throw new Error();
      previous = frame.timestamp;
      const entries = Object.entries(frame.participantFrames || {});
      if (entries.length !== 10) throw new Error();
      const sums = { 100: 0, 200: 0 };
      for (const player of p) {
        const value: any = frame.participantFrames[String(player.participantId)];
        if (value?.participantId !== player.participantId || !nonnegative(value.totalGold)) throw new Error();
        sums[player.teamId] += value.totalGold;
      }
      const total = sums[100] + sums[200];
      return { timestamp: frame.timestamp, team100: sums[100], team200: sums[200], difference: sums[100] - sums[200], parity: total ? 1 - Math.abs(sums[100] - sums[200]) / total : 1 };
    });
    if (samples[0].timestamp > 120000 || samples[samples.length - 1].timestamp < info.gameDuration * 1000 - 120000) throw new Error();
    let integral = 0, leadChanges = 0, lastLead = 0, peak = 0, trough = 0, recovery = 0;
    samples.forEach((s, i) => {
      if (i) integral += (s.parity + samples[i - 1].parity) / 2 * (s.timestamp - samples[i - 1].timestamp);
      const lead = s.difference > 1000 ? 1 : s.difference < -1000 ? -1 : 0;
      if (lead && lastLead && lead !== lastLead) leadChanges++;
      if (lead) lastLead = lead;
      if (peak > 1000) recovery = Math.max(recovery, peak - s.difference);
      if (trough < -1000) recovery = Math.max(recovery, s.difference - trough);
      peak = Math.max(peak, s.difference); trough = Math.min(trough, s.difference);
    });
    const swing = peak - trough;
    const parity = integral / (samples[samples.length - 1].timestamp - samples[0].timestamp);
    momentum = points(.4 * unit((swing - 2000) / 18000) + .3 * unit(leadChanges / 2) + .3 * unit((recovery - 2000) / 12000));
    gold = { timeWeightedParity: parity, minLead: trough, maxLead: peak, swing, leadChanges, comebackRecovery: recovery, deadband: 1000, samples };
    timelineStatus = 'valid';
  } catch { /* Honest partial data: never fabricate gold or momentum. */ }
  const balance = points(gold ? .6 * killParity + .4 * gold.timeWeightedParity : killParity);
  const carryPoints = points(carry);
  const overall = momentum === null ? .8 * balance + .2 * carryPoints : .6 * balance + .15 * carryPoints + .25 * momentum;
  return { version: 1, balance, carry: carryPoints, momentum, overall: Math.round(overall * 100) / 100,
    metrics: { formula: 'bronze-brawl-v1', timelineStatus, partial: timelineStatus !== 'valid', durationSeconds: info.gameDuration,
      totalKills, killsPerMinute: totalKills / (info.gameDuration / 60), killParity, teams,
      carryPlayer: { participantId: leader.participantId, teamId: leader.teamId, kills: leader.kills }, concentration, dominance, gold } };
}
