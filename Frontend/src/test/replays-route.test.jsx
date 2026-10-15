import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import CreationPage from '../CreationPage/CreationPage';
import axios from 'axios';
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

test('creation links to protected replay and companion entrypoint', () => {
  render(<CreationPage />);
  expect(screen.getByRole('link', { name: /Replays und Companion/ })).toHaveAttribute('href', '/replays');
  expect(screen.getByText(/Direktmodus/)).toBeInTheDocument();
});

test('real browser router serves /replays without fetching protected data', async () => {
  window.history.replaceState({}, '', '/replays');
  const { default: Router } = await import('../Router');
  render(<Router />); await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Replay-Verwaltung', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Entsperren' })).toBeInTheDocument();
  expect(axios.get).not.toHaveBeenCalled();
});
