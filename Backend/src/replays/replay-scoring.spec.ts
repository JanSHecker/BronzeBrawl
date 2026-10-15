import { scoreMatch } from './replay-scoring';

// Generated Match-V5 fixtures: tests only, not real matches or production data.
export function matchFixture(kills = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4]) {
  return { metadata: { matchId: 'EUW1_123' }, info: { mapId: 11, gameVersion: '16.20.1.2', gameDuration: 1800,
    participants: kills.map((kills, i) => ({ participantId: i + 1, teamId: i % 2 ? 200 : 100, kills, goldEarned: 12000 })) } };
}
export function timelineFixture(differences = [0, 0, 0, 0]) {
  return { metadata: { matchId: 'EUW1_123' }, info: { frames: differences.map((d, n) => ({ timestamp: n * 600000,
    participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), {
      participantId: i + 1, totalGold: 500 + n * 3000 + (i % 2 ? Math.max(-d, 0) : Math.max(d, 0)) / 5,
    }])) })) } };
}
describe('version 1 independent replay scoring', () => {
  it('balanced is close but has no artificial momentum', () => {
    const s = scoreMatch('EUW1_123', matchFixture(), timelineFixture());
    expect(s.version).toBe(1); expect(s.balance).toBe(100); expect(s.momentum).toBe(0);
    expect(s.carry).toBeLessThan(30); expect(s.metrics.totalKills).toBe(40);
  });
  it('stomp remains unbalanced even with equal final gold', () => {
    const s = scoreMatch('EUW1_123', matchFixture([8, 0, 8, 0, 8, 0, 8, 0, 8, 0]), timelineFixture([0, 12000, 18000, 0]));
    expect(s.balance).toBeLessThan(45);
  });
  it('hypercarry sorts independently of closeness', () => {
    const s = scoreMatch('EUW1_123', matchFixture([20, 4, 0, 4, 0, 4, 0, 4, 0, 4]), timelineFixture());
    expect(s.balance).toBe(100); expect(s.carry).toBeGreaterThan(75);
    expect(s.metrics.carryPlayer.participantId).toBe(1);
  });
  it('uses real team membership and rewards substantial comebacks, not tiny noise', () => {
    const big = scoreMatch('EUW1_123', matchFixture(), timelineFixture([0, 12000, -6000, 6000]));
    const noise = scoreMatch('EUW1_123', matchFixture(), timelineFixture([0, 100, -100, 100]));
    expect(big.momentum).toBeGreaterThan(60); expect(noise.momentum).toBeLessThan(5);
    expect(big.metrics.gold.leadChanges).toBe(2);
  });
  it('no kills is finite and not a hypercarry', () => {
    const s = scoreMatch('EUW1_123', matchFixture(Array(10).fill(0)), null);
    expect(s.balance).toBe(100); expect(s.carry).toBe(0); expect(Number.isFinite(s.overall)).toBe(true);
    expect(s.momentum).toBeNull(); expect(s.metrics.gold).toBeNull(); expect(s.metrics.timelineStatus).toBe('missing');
  });
  it('malformed, unordered and incomplete timeline are explicit partial data', () => {
    const t = timelineFixture(); t.info.frames[1].timestamp = 0;
    for (const timeline of [t, {}, { ...timelineFixture(), metadata: { matchId: 'EUW1_999' } }]) {
      const s = scoreMatch('EUW1_123', matchFixture(), timeline);
      expect(s.momentum).toBeNull(); expect(s.metrics.timelineStatus).toBe('invalid');
    }
    const bad = timelineFixture(); delete bad.info.frames[1].participantFrames['10'];
    expect(scoreMatch('EUW1_123', matchFixture(), bad).momentum).toBeNull();
  });
  it('rejects conflicting identity, roster, map, kill/gold and duration data', () => {
    const bads = [matchFixture(), matchFixture(), matchFixture(), matchFixture(), matchFixture(), matchFixture()];
    bads[0].metadata.matchId = 'EUW1_999'; bads[1].info.mapId = 12;
    bads[2].info.participants[1].participantId = 1; bads[3].info.participants[1].kills = -1;
    bads[4].info.participants[1].goldEarned = NaN; bads[5].info.gameDuration = 0;
    for (const m of bads) expect(() => scoreMatch('EUW1_123', m, null)).toThrow();
  });
});
