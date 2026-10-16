import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import RewardPage from '../RewardPage/RewardPage';
import api from '../api';
import defaults from '../../../Backend/src/reward-catalog.json';

vi.mock('axios', () => {
  const client = { get: vi.fn(), interceptors: { request: { use: vi.fn() } } };
  client.create = () => client;
  return { default: client };
});
const catalog = {
  difficulty: 'baseline', multiplier: 1, conversions: { shots: 5, chugs: 15 }, maxShield: 10,
  pools: Object.fromEntries(Object.entries(defaults).map(([pool, choices]) => [pool, choices.map(choice => ({
    ...choice, shieldPoints: Math.min(10, (choice.shield?.sips || 0) + (choice.shield?.shots || 0) * 5),
  }))])),
};
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: catalog });
});

test('lists every catalogue entry and its effects without requiring a session', async () => {
  render(<RewardPage />);
  expect(await screen.findByText(/41 catalogue entries/)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('rewardCatalog', expect.objectContaining({ params: { difficulty: 'baseline' } }));
  expect(screen.getAllByRole('article')).toHaveLength(41);
  for (const choice of Object.values(defaults).flat()) {
    expect(screen.getByRole('heading', { name: choice.name, level: 3 })).toBeInTheDocument();
  }
  expect(screen.getByRole('region', { name: 'Legacy Turret' })).toHaveTextContent('New turret chests use the Normal pool instead.');
  expect(screen.getAllByText('Breaks target’s entire shield')).toHaveLength(9);
  expect(screen.getByText('Breaks every enemy shield')).toBeInTheDocument();
  expect(screen.getByText('Gain 10 shield points (max 10 total)')).toBeInTheDocument();
  expect(screen.getByText('50% success. Otherwise: you receive 1 shots')).toBeInTheDocument();
});

test('search matches names and effects and explains empty results', async () => {
  render(<RewardPage />);
  await screen.findByText(/41 catalogue entries/);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search rewards' }), { target: { value: 'pocket shield' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Pocket Shield' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'breaks every enemy shield' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(within(screen.getByRole('article')).getByRole('heading', { name: 'Pentakill' })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no such reward' } });
  expect(screen.getByRole('status')).toHaveTextContent('No rewards match your search.');
});

test('changing difficulty requests server-scaled rewards instead of guessing locally', async () => {
  render(<RewardPage />);
  await screen.findByText(/41 catalogue entries/);
  api.get.mockResolvedValue({ data: { ...catalog, difficulty: 'hard', multiplier: 1.5, pools: {
    standard: [{ id: 'marked', name: 'Marked', mode: 'single', amounts: { sips: 3 } }],
  } } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Difficulty' }), { target: { value: 'hard' } });
  expect(await screen.findByText('3 sips total to one opponent')).toBeInTheDocument();
  expect(api.get).toHaveBeenLastCalledWith('rewardCatalog', expect.objectContaining({ params: { difficulty: 'hard' } }));
  expect(screen.getByText(/1.5× difficulty/)).toBeInTheDocument();
});

test('loading errors and invalid responses can be retried', async () => {
  api.get.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: '<html>not json</html>' }).mockResolvedValue({ data: catalog });
  render(<RewardPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid reward catalogue response');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/41 catalogue entries/)).toBeInTheDocument();
});

test('late responses from an earlier difficulty cannot overwrite the current catalogue', async () => {
  let resolve;
  api.get.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ data: { ...catalog, multiplier: 2 } });
  render(<RewardPage />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'terror' } });
  expect(await screen.findByText(/2× difficulty/)).toBeInTheDocument();
  await act(async () => resolve({ data: catalog }));
  expect(screen.getByText(/2× difficulty/)).toBeInTheDocument();
});

test('/reward is directly accessible without adding navigation links', async () => {
  window.history.replaceState({}, '', '/reward');
  const { default: Router } = await import('../Router');
  render(<Router />);
  expect(await screen.findByRole('heading', { name: 'All rewards', level: 1 })).toBeInTheDocument();
  expect(await screen.findByText(/41 catalogue entries/)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/reward');
  expect(screen.queryByRole('link', { name: /reward/i })).not.toBeInTheDocument();
});
