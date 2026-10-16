import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import CreationPage from '../CreationPage/CreationPage';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
vi.mock('axios', () => { const client = { get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } }; client.create = () => client; return { default: client }; });

test('creation links only to the companion, not replay management', () => {
  render(<MemoryRouter><CreationPage /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Companion verbinden' })).toHaveAttribute('href', '/companion');
  expect(screen.queryByText(/Replay/)).not.toBeInTheDocument();
});

test('old replay URL redirects to companion with no replay UI or requests', async () => {
  window.history.replaceState({}, '', '/replays');
  const { default: Router } = await import('../Router');
  render(<Router />); await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Companion', level: 1 })).toBeInTheDocument();
  expect(screen.queryByText(/Replay/)).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/companion');
  expect(axios.get).not.toHaveBeenCalled();
});
