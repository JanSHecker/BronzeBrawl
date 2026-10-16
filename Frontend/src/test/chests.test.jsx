import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import ChestInventory from '../StatusPage/ChestInventory';
import ChestProgress from '../StatusPage/ChestProgress';
import PunishmentCounters from '../StatusPage/PunishmentCounters';

const http = vi.hoisted(() => ({ post: vi.fn(), interceptors: { request: { use: vi.fn() } } }));
vi.mock('axios', () => ({ default: { create: () => http } }));
const unopened = { rewardId: 7, amount: 9, chestType: 'epic', distributed: false, openedAt: null };
const opened = { ...unopened, openedAt: '2026-10-16T10:00:00Z', choices: [{ id: 'assign', effect: 'assign', amount: 9, unit: 'sips' }] };
const enemies = [{ championId: 10, championName: 'Garen', player: { playerId: 50, playerName: 'Sam' } }];
beforeEach(() => {
  vi.clearAllMocks();
  http.post.mockResolvedValue({ data: opened });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

test('six distinct chest categories display their own inventory and milestones', () => {
  render(<><ChestInventory rewards={[unopened]} enemyTeam={enemies} onRefresh={vi.fn()} /><ChestProgress /></>);
  expect(screen.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Baron / Elder chest, 0 available' })).toBeDisabled();
  expect(screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-valuemax'))).toEqual(['1', '2', '3', '1', '1', '1']);
});

test('reveal is server-owned, opening survives polling, and resolution refreshes before releasing controls', async () => {
  const refresh = vi.fn().mockResolvedValue();
  const view = render(<ChestInventory rewards={[unopened]} enemyTeam={enemies} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  await screen.findByRole('button', { name: '9 Assign sips' });
  expect(http.post).toHaveBeenCalledWith('openChest', { id: 7 });
  view.rerender(<ChestInventory rewards={[opened]} enemyTeam={enemies} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: '9 Assign sips' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sam Garen' }));
  view.rerender(<ChestInventory rewards={[{ ...opened }]} enemyTeam={[...enemies]} onRefresh={refresh} />);
  expect(screen.getByRole('button', { name: 'Sam Garen' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByText('Assigned');
  expect(http.post).toHaveBeenLastCalledWith('confirmReward', { id: 7, choiceId: 'assign', punishment: { recipient: { playerId: 50 } } });
  expect(refresh).toHaveBeenCalledTimes(2);
});

test('a previously opened chest restores the same offer without another opening request', async () => {
  render(<ChestInventory rewards={[opened]} enemyTeam={enemies} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' }));
  expect(screen.getByRole('button', { name: '9 Assign sips' })).toBeInTheDocument();
  expect(http.post).not.toHaveBeenCalled();
});

test('opening failures are retryable and do not consume or hide the chest', async () => {
  http.post.mockRejectedValueOnce(new Error('offline'));
  render(<ChestInventory rewards={[unopened]} enemyTeam={enemies} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(screen.getByRole('button', { name: 'Open', exact: true })).toBeEnabled();
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
