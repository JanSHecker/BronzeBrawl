import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import api, { hostTokenKey, writeActiveSession } from '../api';
import LogPage from '../ActivityLog/LogPage';
import EventLog from '../ActivityLog/EventLog';
import { useGameActivity } from '../ActivityLog/useGameActivity';

vi.mock('axios', () => {
  const client = { get: vi.fn(), interceptors: { request: { use: vi.fn() } } };
  client.create = () => client;
  return { default: client };
});

const entry = (activityId, type = 'player_joined', data = { player: { playerId: 7, playerName: 'Alice' } }) => ({
  activityId, gameId: 42, type, recordedAt: '2026-10-16T12:00:00Z', gameTime: 65, data,
});
const renderPage = (url = '/log') => render(<MemoryRouter initialEntries={[url]}><LogPage /></MemoryRouter>);
const session = () => {
  writeActiveSession({ gameId: 42 });
  sessionStorage.setItem(hostTokenKey(42), 'a'.repeat(64));
};

test('log page explains missing session without making requests', () => {
  api.get.mockClear();
  renderPage();
  expect(screen.getByText(/Create or join a game/)).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

test('log loads authenticated history, older pages and live updates without duplicates', async () => {
  session();
  api.get.mockImplementation(async (_url, { params }) => {
    if (params.before) return { data: { items: [entry(1, 'game_created', {})], nextCursor: null } };
    if (params.after) return { data: { items: [entry(4, 'game_ended', {})], nextCursor: null } };
    return { data: { items: [entry(3), entry(2, 'game_started', {})], nextCursor: 2 } };
  });
  renderPage();
  expect(await screen.findByText('Alice joined the game.')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('gameActivity', expect.objectContaining({
    params: { gameId: 42, playerId: undefined, limit: 100 }, headers: { 'X-Game-Token': 'a'.repeat(64) },
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Load older events' }));
  expect(await screen.findByText('Game created.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Game ended.')).toBeInTheDocument();
  expect(screen.getAllByText('Alice joined the game.')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Load older events' })).not.toBeInTheDocument();
});

test('log handles empty history, request errors and retry', async () => {
  session();
  api.get.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({ data: { items: [], nextCursor: null } });
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
});

test('presentation supports environment kills, assists, amounts and safe unknown event fallback', () => {
  render(<EventLog items={[
    entry(1, 'champion_killed', { environment: 'Turret', victim: { championName: 'Ahri' }, assisters: [{ championName: 'Lux' }] }),
    entry(2, 'reward_distributed', { player: { playerName: 'Alice' }, recipient: { playerName: 'Bob' }, amount: 9 }),
    entry(3, 'future_type', {}),
  ]} />);
  expect(screen.getByText('Turret killed Ahri. Assists: Lux.')).toBeInTheDocument();
  expect(screen.getByText('Alice distributed 9 to Bob.')).toBeInTheDocument();
  expect(screen.getByText('Game activity: future_type.')).toBeInTheDocument();
  expect(screen.getAllByText('1:05')).toHaveLength(3);
});

test('presentation identifies streaks, multikills and timeline objective provenance', () => {
  render(<EventLog items={[
    entry(1, 'champion_killed', { killer: { championName: 'Viego' }, victim: { championName: 'Galio' }, killstreak: 8, streakName: 'Legendary' }),
    entry(2, 'multikill', { killer: { championName: 'Viego' }, count: 5 }),
    entry(3, 'objective_captured', { objective: 'Grubs', winningTeam: 0, grubScore: [2, 1], source: 'match_timeline' }),
  ]} />);
  expect(screen.getByText('Viego killed Galio. Legendary (8).')).toBeInTheDocument();
  expect(screen.getByText('Viego scored a Pentakill!')).toBeInTheDocument();
  expect(screen.getByText('Blue team secured Grubs (2–1) [match timeline].')).toBeInTheDocument();
});

test('catalogue history describes choices, completed distributions, shields and forced expiry without undefined amounts', () => {
  render(<EventLog items={[
    entry(1, 'reward_chosen', { player: { playerName: 'Alice' }, choiceId: 'loaded-coin', outcome: 'backfire' }),
    entry(2, 'reward_distributed', { player: { playerName: 'Alice' }, rewardId: 8 }),
    entry(3, 'shield_changed', { player: { playerName: 'Bob' }, broken: true, shield: 0 }),
    entry(4, 'champion_expired', { player: { playerName: 'Alice' }, champion: { championName: 'Ahri' } }),
  ]} />);
  expect(screen.getByText('Alice chose loaded-coin — it backfired.')).toBeInTheDocument();
  expect(screen.getByText('Alice completed reward #8.')).toBeInTheDocument();
  expect(screen.getByText('Bob lost their entire shield.')).toBeInTheDocument();
  expect(screen.getByText('Alice must switch away from Ahri.')).toBeInTheDocument();
  expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
});

test('scope changes clear previous history and ignore late responses', async () => {
  session();
  let resolve;
  api.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  renderPage();
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  act(() => writeActiveSession(null));
  await act(async () => resolve({ data: { items: [entry(1)], nextCursor: null } }));
  expect(screen.queryByText('Alice joined the game.')).not.toBeInTheDocument();
  expect(screen.getByText(/Create or join a game/)).toBeInTheDocument();
});

test('live catch-up drains multiple pages without gaps and retains existing history', async () => {
  function Harness() {
    const log = useGameActivity({ gameId: 42, hostToken: 'a'.repeat(64) });
    return <><button onClick={log.refresh}>Refresh history</button><span>{log.items.length} entries</span></>;
  }
  const entries = Array.from({ length: 205 }, (_, index) => entry(index + 1));
  api.get.mockImplementation(async (_url, { params }) => {
    if (!params.after) return { data: { items: [entries[0]], nextCursor: null } };
    const incoming = entries.filter(item => item.activityId > params.after);
    return { data: { items: incoming.slice(0, 100), nextCursor: incoming.length > 100 ? incoming[99].activityId : null } };
  });
  render(<Harness />);
  expect(await screen.findByText('1 entries')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  expect(await screen.findByText('205 entries')).toBeInTheDocument();
});
