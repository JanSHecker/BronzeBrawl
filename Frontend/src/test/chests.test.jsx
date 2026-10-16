import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import ChestInventory from '../StatusPage/ChestInventory';
import ChestProgress from '../StatusPage/ChestProgress';
import PunishmentCounters from '../StatusPage/PunishmentCounters';

const http = vi.hoisted(() => ({ post: vi.fn(), interceptors: { request: { use: vi.fn() } } }));
vi.mock('axios', () => ({ default: { create: () => http } }));
const unopened = { rewardId: 7, amount: 9, chestType: 'epic', distributed: false, openedAt: null };
const opened = { ...unopened, openedAt: '2026-10-16T10:00:00Z', choices: [{ id: 'marked', name: 'Marked', mode: 'single', amounts: { sips: 2, shots: 0, chugs: 0 } }] };
const enemies = [{ championId: 10, championName: 'Garen', player: { playerId: 50, playerName: 'Sam' } }];
beforeEach(() => {
  vi.clearAllMocks();
  http.post.mockResolvedValue({ data: opened });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

test('rarity-labelled chest categories display inventory and source milestones', () => {
  render(<><ChestInventory rewards={[unopened]} enemyTeam={enemies} onRefresh={vi.fn()} /><ChestProgress /></>);
  expect(screen.getByRole('button', { name: 'Epic chest, 1 available' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Legendary chest, 0 available' })).toBeDisabled();
  expect(screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuemax'))).toEqual(['1', '2', '3', '1', '1', '1']);
});

test('reveal is server-owned, opening survives polling, and tapping assigns without confirmation', async () => {
  const refresh = vi.fn().mockResolvedValue();
  const view = render(<ChestInventory rewards={[unopened]} enemyTeam={enemies} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Epic chest, 1 available' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  await screen.findByRole('button', { name: 'Marked' });
  expect(http.post).toHaveBeenCalledWith('openChest', { id: 7 });
  view.rerender(<ChestInventory rewards={[opened]} enemyTeam={enemies} onRefresh={refresh} />);
  let current = { ...opened, distribution: { choiceId: 'marked', remaining: { sips: 2, shots: 0, chugs: 0 }, version: 0, targets: {} } };
  http.post.mockImplementation(async (name, request) => {
    if (name === 'distributeReward') current = { ...current, distributed: request.expectedVersion === 1, distribution: { ...current.distribution, version: request.expectedVersion + 1, remaining: { sips: 1 - request.expectedVersion, shots: 0, chugs: 0 }, targets: { 50: { sips: request.expectedVersion + 1 } } } };
    return { data: current };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Marked' }));
  const target = await screen.findByRole('button', { name: 'Give 1 sips to Sam. Shield 0/10.' });
  expect(target.querySelector('.status-shield-badge')).toHaveTextContent('0/10');
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  fireEvent.click(target);
  fireEvent.click(target);
  await screen.findByText('Complete');
  expect(http.post).toHaveBeenLastCalledWith('distributeReward', { id: 7, expectedVersion: 1, unit: 'sips', recipientId: 50 });
});

test('a previously opened chest restores the same offer without another opening request', async () => {
  render(<ChestInventory rewards={[opened]} enemyTeam={enemies} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Epic chest, 1 available' }));
  expect(screen.getByRole('button', { name: 'Marked' })).toBeInTheDocument();
  expect(http.post).not.toHaveBeenCalled();
});

test('Pentakill inventory shows its one enemy-team effect and resolves without manual targeting', async () => {
  const chest = { ...unopened, chestType: 'pentakill' };
  const offer = { ...chest, openedAt: '2026-10-16T10:00:00Z', choices: [{
    id: 'pentakill', name: 'Pentakill', mode: 'enemy_team', amounts: { sips: 0, shots: 0, chugs: 1 }, shieldPoints: 10, breaksShields: true,
  }] };
  http.post.mockResolvedValueOnce({ data: offer }).mockResolvedValueOnce({ data: { ...offer, distributed: true } });
  render(<ChestInventory rewards={[chest]} enemyTeam={enemies} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pentakill chest, 1 available' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  const choice = await screen.findByRole('button', { name: 'Pentakill', exact: true });
  expect(screen.getByText('1 chugs per target to every opponent')).toBeInTheDocument();
  expect(screen.getByText('Gain 10 shield points (max 10 total)')).toBeInTheDocument();
  expect(screen.getByText('Breaks every enemy shield')).toBeInTheDocument();
  fireEvent.click(choice);
  await screen.findByText('Complete');
  expect(http.post).toHaveBeenLastCalledWith('chooseReward', { id: 7, choiceId: 'pentakill' });
  expect(screen.queryByRole('button', { name: /Give 1/ })).not.toBeInTheDocument();
});

test('a tap arriving during status refresh starts another queue drain', async () => {
  let releaseRefresh;
  const refresh = vi.fn().mockReturnValueOnce(new Promise(resolve => { releaseRefresh = resolve; })).mockResolvedValue();
  let current = { ...opened, distribution: { choiceId: 'marked', remaining: { sips: 2, shots: 0, chugs: 0 }, version: 0, targets: {} } };
  http.post.mockImplementation(async (_name, request) => {
    current = { ...current, distributed: request.expectedVersion === 1, distribution: { ...current.distribution,
      version: request.expectedVersion + 1, remaining: { sips: 1 - request.expectedVersion, shots: 0, chugs: 0 }, targets: { 50: { sips: request.expectedVersion + 1 } } } };
    return { data: current };
  });
  render(<ChestInventory rewards={[current]} enemyTeam={enemies} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Epic chest, 1 available' }));
  fireEvent.click(screen.getByRole('button', { name: 'Give 1 sips to Sam. Shield 0/10.' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Give 1 sips to Sam. Shield 0/10.' }));
  expect(http.post).toHaveBeenCalledOnce();
  await act(async () => releaseRefresh());
  await screen.findByText('Complete');
  expect(http.post).toHaveBeenCalledTimes(2);
});

test('opening failures are retryable and do not consume or hide the chest', async () => {
  http.post.mockRejectedValueOnce(new Error('offline'));
  render(<ChestInventory rewards={[unopened]} enemyTeam={enemies} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Epic chest, 1 available' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(screen.getByRole('button', { name: 'Open', exact: true })).toBeEnabled();
});

test('normal inventory combines turret chests and preserves already opened offers', () => {
  const turret = { ...opened, chestType: 'turret' };
  render(<ChestInventory rewards={[turret, { ...unopened, rewardId: 8, chestType: 'standard' }]} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Normal chest, 2 available' }));
  expect(screen.queryByRole('button', { name: /Turret chest/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Normal' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marked', exact: true })).toBeInTheDocument();
  expect(http.post).not.toHaveBeenCalled();
});

test.each([false, true])('solo dummy assignment consumes multi-target rewards, including after game end: %s', async ended => {
  const choice = { id: 'split', name: 'Split', mode: 'split', amounts: { sips: 1 }, perTarget: true, minTargets: 2, maxTargets: 2 };
  const offer = { ...opened, choices: [choice] };
  let current = { ...offer, recipients: [], distribution: { choiceId: 'split', remaining: { sips: 2, shots: 0, chugs: 0 }, version: 0, targets: {} } };
  http.post.mockImplementation(async (name, request) => {
    if (name === 'openChest') return { data: offer };
    if (name === 'distributeReward') current = { ...current, distributed: request.expectedVersion === 1, distribution: {
      ...current.distribution, version: request.expectedVersion + 1, remaining: { sips: 1 - request.expectedVersion },
      targets: { dummy: { sips: request.expectedVersion + 1 } }, lastResult: { dummy: true, assigned: { sips: 1 } },
    } };
    return { data: current };
  });
  render(<ChestInventory rewards={[unopened]} recipients={[]} ended={ended} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Epic chest, 1 available' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Split', exact: true }));
  const dummy = await screen.findByRole('button', { name: 'Assign to dummy' });
  fireEvent.click(dummy);
  fireEvent.click(dummy);
  await screen.findByText('Complete');
  expect(http.post).toHaveBeenLastCalledWith('distributeReward', { id: 7, expectedVersion: 1, unit: 'sips', recipientId: 'dummy' });
});

test('registered opponents suppress the dummy button even while choosing champions', () => {
  const chest = { ...opened, distribution: { choiceId: 'marked', remaining: { sips: 2 }, targets: {}, version: 0 } };
  render(<ChestInventory rewards={[chest]} recipients={[{ playerId: 50, playerName: 'Sam', champion: null }]} ended onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Epic chest, 1 available' }));
  expect(screen.queryByRole('button', { name: 'Assign to dummy' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Give 1 sips to Sam. Shield 0/10.' })).toBeEnabled();
});

test('punishments total by unit and submit a single guarded decrement, not a client total', async () => {
  let resolve;
  http.post.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const refresh = vi.fn().mockResolvedValue();
  render(<PunishmentCounters punishments={[
    { punishmentId: 1, amount: 7, remainingAmount: 3, unit: 'sips' },
    { punishmentId: 2, amount: 2, unit: 'sips' },
    { punishmentId: 3, amount: 1, unit: 'shots' },
  ]} onRefresh={refresh} />);
  const sips = screen.getByRole('button', { name: '5 sips remaining. Tap to subtract one.' });
  fireEvent.click(sips); fireEvent.click(sips);
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.post).toHaveBeenCalledWith('consumePunishment', { id: 1, expectedRemaining: 3 });
  expect(screen.getByRole('button', { name: /1 shots/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /0 chugs/ })).toBeDisabled();
  await act(async () => resolve({ data: {} }));
  expect(refresh).toHaveBeenCalledOnce();
});

test('a stale punishment tap refreshes canonical values and shows a retryable error', async () => {
  http.post.mockRejectedValueOnce(new Error('punishment changed'));
  const refresh = vi.fn().mockResolvedValue();
  render(<PunishmentCounters punishments={[{ punishmentId: 1, amount: 1 }]} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: /1 sips/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('punishment changed');
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});
