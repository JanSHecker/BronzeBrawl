import axios from 'axios';
import { RiotClient } from './riot.client';
jest.mock('axios');
const get = axios.get as jest.Mock;
const match = () => ({ metadata: { matchId: 'EUW1_123' }, info: { mapId: 11, gameVersion: '16.20.1.2', gameDuration: 1800,
  participants: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, teamId: i < 5 ? 100 : 200, kills: 2, goldEarned: 10000 })) } });
describe('Riot Match-V5 worker transport', () => {
  let client: RiotClient;
  beforeEach(() => { get.mockReset(); process.env.RIOT_API_KEY = 'test-key-not-real'; client = new RiotClient(); jest.spyOn(client, 'pause').mockResolvedValue(undefined); });
  afterEach(() => { delete process.env.RIOT_API_KEY; });
  it('uses fixed routing, secret header, timeouts and no redirects', async () => {
    get.mockResolvedValueOnce({ data: match() }).mockRejectedValueOnce({ response: { status: 404 } });
    const s = await client.analyze('EUW1_123', '16.20.1.2'); expect(s.momentum).toBeNull();
    expect(get.mock.calls[0][0]).toBe('https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_123');
    expect(get.mock.calls[0][1]).toMatchObject({ headers: { 'X-Riot-Token': 'test-key-not-real' }, timeout: 10000, maxRedirects: 0 });
    expect(get.mock.calls[1][0]).toMatch(/\/EUW1_123\/timeline$/);
  });
  it('fails closed without key and rejects user URL/unknown platform before network', async () => {
    await expect(client.analyze('https://evil.test/123', '16.20.1.2')).rejects.toThrow(); expect(get).not.toHaveBeenCalled();
    delete process.env.RIOT_API_KEY; await expect(client.analyze('EUW1_123', '16.20.1.2')).rejects.toThrow('Riot API key is not configured');
  });
  it('honors bounded Retry-After and stops after three rate-limited attempts', async () => {
    get.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '2' } } });
    await expect(client.analyze('EUW1_123', '16.20.1.2')).rejects.toThrow('Riot rate limit');
    expect(get).toHaveBeenCalledTimes(3); expect(client.pause).toHaveBeenCalledWith(expect.any(Number));
  });
  it('does not retry unauthorized key and never surfaces transport secrets', async () => {
    get.mockRejectedValue({ response: { status: 403 }, message: 'test-key-not-real' });
    await expect(client.analyze('EUW1_123','16.20.1.2')).rejects.toThrow('Riot authorization failed'); expect(get).toHaveBeenCalledTimes(1);
  });
  it('rejects conflicting match identity and replay version', async () => {
    const m = match(); m.metadata.matchId = 'EUW1_999'; get.mockResolvedValue({ data: m });
    await expect(client.analyze('EUW1_123','16.20.1.2')).rejects.toThrow();
    get.mockResolvedValue({ data: match() }); await expect(client.analyze('EUW1_123','16.21.1.2')).rejects.toThrow();
  });
  it('interrupts long rate-limit waits during graceful shutdown', async () => {
    (client.pause as jest.Mock).mockRestore();
    const waiting = client.pause(120000);
    const aborted = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    client.cancel();
    await aborted;
  });
});
