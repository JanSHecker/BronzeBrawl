import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import ReplaysPage from '../ReplaysPage/ReplaysPage';

vi.mock('axios', () => { const client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), interceptors: { request: { use: vi.fn() } } }; client.create = () => client; return { default: client }; });
const item = (matchId = 'EUW1_123', scores = { version: 1, balance: 71, carry: 92, momentum: null, overall: 80, metrics: { timelineAvailable: false, goldSwings: null, leadChanges: null, killSpread: [1, 2, 20] } }) => ({ matchId, gameVersion: '16.20.123.456', patch: '16.20', sizeBytes: 1024, sha256: 'abcdef', createdAt: '2026-10-15T10:00:00Z', analysisStatus: scores ? 'ready' : 'pending', analysisError: null, scores, reservedGameId: null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => act(async () => {});
const unlock = async () => { fireEvent.change(screen.getByLabelText('Replay-Token'), { target: { value: 'replay-secret' } }); fireEvent.click(screen.getByRole('button', { name: 'Entsperren' })); await flush(); };
beforeEach(() => {
  vi.clearAllMocks();
  axios.get.mockResolvedValue({ data: { items: [], riotConfigured: false } });
  axios.post.mockResolvedValue({ data: { item: item() } });
  axios.put.mockResolvedValue({ data: item() });
  axios.delete.mockResolvedValue({ data: {} });
});

test('public entry has explicit companion links but no requests or results before authentication', async () => {
  render(<ReplaysPage />); await flush();
  expect(axios.get).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Replay-Token')).toHaveAttribute('type', 'password');
  expect(screen.getByRole('link', { name: /Companion-Quellcode/ })).toHaveAttribute('href', '/downloads/bronze-brawl-companion.zip');
  expect(screen.getByRole('link', { name: /Lokale Verwaltung/ })).toHaveAttribute('href', 'http://localhost:3002');
  expect(screen.queryByRole('button', { name: 'Reservieren' })).not.toBeInTheDocument();
});

test('unlock uses only session token header, distinguishes loading and empty, logout clears session', async () => {
  const req = deferred(); axios.get.mockReturnValueOnce(req.promise);
  render(<ReplaysPage />); await unlock();
  expect(screen.getByRole('status')).toHaveTextContent(/Lade/);
  expect(screen.queryByText(/Keine Replays/)).not.toBeInTheDocument();
  const [url, config] = axios.get.mock.calls[0];
  expect(url).toBe('/api/replays'); expect(config.headers).toEqual({ 'X-Replay-Token': 'replay-secret' }); expect(config.signal).toBeInstanceOf(AbortSignal);
  expect(sessionStorage.getItem('bb:replay-admin')).toBe('replay-secret'); expect(localStorage.getItem('bb:replay-admin')).toBeNull();
  await act(async () => req.resolve({ data: { items: [], riotConfigured: false } }));
  expect(screen.getByText(/Keine Replays vorhanden/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sperren' }));
  expect(sessionStorage.getItem('bb:replay-admin')).toBeNull(); expect(config.signal.aborted).toBe(true);
});

test.each([401, 403])('auth failure %s is explicit and removes all protected content', async status => {
  sessionStorage.setItem('bb:replay-admin', 'replay-secret');
  axios.get.mockRejectedValueOnce({ response: { status } }); render(<ReplaysPage />); await flush();
  expect(screen.getByRole('alert')).toHaveTextContent(/Token.*abgelehnt/);
  expect(sessionStorage.getItem('bb:replay-admin')).toBeNull(); expect(screen.queryByText(/Keine Replays/)).not.toBeInTheDocument();
});

test('network and malformed response errors are accessible, never mistaken for empty', async () => {
  axios.get.mockRejectedValueOnce(new Error('offline')); render(<ReplaysPage />); await unlock();
  expect(screen.getByRole('alert')).toHaveTextContent(/Verbindung/); expect(screen.queryByText(/Keine Replays/)).not.toBeInTheDocument();
  axios.get.mockResolvedValueOnce({ data: '<!doctype html>' }); fireEvent.click(screen.getByRole('button', { name: 'Erneut laden' })); await flush();
  expect(screen.getByRole('alert')).toHaveTextContent(/Ungültige/);
});

test('separate scores, null semantics, metrics, patch filtering and each score ordering', async () => {
  const a = item(); const b = item('EUW1_456', { version: 1, balance: 99, carry: 10, momentum: 70, overall: 60, metrics: {} }); const c = { ...item('NA1_789', null), patch: '16.19' };
  axios.get.mockResolvedValue({ data: { items: [c, b, a], riotConfigured: true } }); render(<ReplaysPage />); await unlock();
  const rows = () => screen.getAllByRole('article');
  expect(rows().map(r => r.dataset.matchId)).toEqual(['EUW1_123', 'EUW1_456', 'NA1_789']);
  expect(within(rows()[0]).getByText('Balance')).toBeInTheDocument(); expect(within(rows()[0]).getByText('71')).toBeInTheDocument();
  expect(within(rows()[0]).getByText('Carry')).toBeInTheDocument(); expect(within(rows()[0]).getByText('92')).toBeInTheDocument();
  expect(within(rows()[0]).getByText('Momentum')).toBeInTheDocument(); expect(within(rows()[0].querySelector('.replay-scores')).getByText('Nicht verfügbar')).toBeInTheDocument();
  expect(within(rows()[2].querySelector('.replay-scores')).getAllByText('Nicht verfügbar')).toHaveLength(4);
  expect(screen.getByText(/konfiguriert, nicht validiert/)).toBeInTheDocument(); expect(screen.getByText(/konzentrierte Spieler-Kills/)).toBeInTheDocument(); expect(screen.getByText(/Teilbewertung/)).toBeInTheDocument();
  fireEvent.click(within(rows()[0]).getByText(/Metriken/)); expect(within(rows()[0]).getByText(/goldSwings/)).toBeInTheDocument();
  for (const [sort, first] of [['balance', 'EUW1_456'], ['carry', 'EUW1_123'], ['momentum', 'EUW1_456'], ['overall', 'EUW1_123']]) {
    fireEvent.change(screen.getByLabelText('Sortierung'), { target: { value: sort } }); expect(rows()[0].dataset.matchId).toBe(first); expect(rows()[2].dataset.matchId).toBe('NA1_789');
  }
  fireEvent.change(screen.getByLabelText('Patch'), { target: { value: '16.19' } }); expect(rows()).toHaveLength(1); expect(rows()[0].dataset.matchId).toBe('NA1_789');
});

test('manual ROFL upload sends raw file, full match ID and version headers; validates ID', async () => {
  render(<ReplaysPage />); await unlock();
  fireEvent.change(screen.getByLabelText('Match-ID'), { target: { value: '123' } });
  fireEvent.change(screen.getByLabelText('Upload-Version'), { target: { value: '16.20.123.456' } });
  const file = new File(['ROFL2 bytes'], 'match.rofl'); fireEvent.change(screen.getByLabelText('Replay-Datei (.rofl)'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Hochladen' })); await flush(); expect(axios.put).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent(/Match-ID/);
  fireEvent.change(screen.getByLabelText('Match-ID'), { target: { value: 'EUW1_123' } }); fireEvent.click(screen.getByRole('button', { name: 'Hochladen' })); await flush();
  expect(axios.put).toHaveBeenCalledWith('/api/replays/EUW1_123/file', file, expect.objectContaining({ headers: { 'X-Replay-Token': 'replay-secret', 'Content-Type': 'application/octet-stream', 'X-Replay-Version': '16.20.123.456' }, signal: expect.any(AbortSignal) }));
});

test('retry, binary authenticated download and confirmed unreserved deletion use exact contract', async () => {
  axios.get.mockResolvedValue({ data: { items: [{ ...item(), analysisStatus: 'failed', analysisError: 'Riot nicht erreichbar' }], riotConfigured: false } });
  const view = render(<ReplaysPage />); await unlock();
  expect(screen.getByText('Riot nicht erreichbar')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Analyse wiederholen' })); await flush();
  expect(axios.post).toHaveBeenCalledWith('/api/replays/EUW1_123/analyze', {}, expect.objectContaining({ headers: { 'X-Replay-Token': 'replay-secret' } }));
  const create = vi.fn(() => 'blob:replay'); const revoke = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  axios.get.mockResolvedValueOnce({ data: new Blob(['real mocked bytes']) }); fireEvent.click(screen.getByRole('button', { name: 'Datei herunterladen' })); await flush();
  expect(axios.get).toHaveBeenCalledWith('/api/replays/EUW1_123/file', expect.objectContaining({ responseType: 'blob', headers: { 'X-Replay-Token': 'replay-secret' } })); expect(create).toHaveBeenCalled(); expect(click).toHaveBeenCalled();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' })); expect(axios.delete).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Löschen' })); await flush();
  expect(confirm).toHaveBeenCalled(); expect(axios.delete).toHaveBeenCalledWith('/api/replays/EUW1_123', expect.objectContaining({ headers: { 'X-Replay-Token': 'replay-secret' } }));
  view.unmount(); expect(revoke).toHaveBeenCalledWith('blob:replay'); vi.unstubAllGlobals();
});

test('reserve uses existing game without creation and release sends reserved game ID', async () => {
  sessionStorage.setItem('bb:active', JSON.stringify({ gameId: 17 }));
  axios.get.mockResolvedValue({ data: { items: [{ ...item(), reservedGameId: 17 }], riotConfigured: false } }); render(<ReplaysPage />); await unlock();
  expect(screen.getByLabelText('Spiel-ID')).toHaveValue(17); expect(screen.getByRole('button', { name: 'Löschen' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Spielversion'), { target: { value: '16.20.123.456' } }); fireEvent.change(screen.getByLabelText('Sortierung'), { target: { value: 'carry' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reservieren' })); await flush();
  expect(axios.post).toHaveBeenCalledWith('/api/replays/reserve', { gameId: 17, gameVersion: '16.20.123.456', sortBy: 'carry' }, expect.objectContaining({ headers: { 'X-Replay-Token': 'replay-secret' } }));
  expect(screen.getByRole('status')).toHaveTextContent(/EUW1_123/);
  fireEvent.click(screen.getByRole('button', { name: 'Freigeben' })); await flush();
  expect(axios.post).toHaveBeenCalledWith('/api/replays/EUW1_123/release', { gameId: 17 }, expect.objectContaining({ headers: { 'X-Replay-Token': 'replay-secret' } }));
  expect(axios.post.mock.calls.every(([url]) => url.includes('/replays/'))).toBe(true);
});

test('polling is serial and aborts in-flight request on unmount without rescheduling', async () => {
  vi.useFakeTimers(); const req = deferred(); axios.get.mockReturnValueOnce(req.promise); const view = render(<ReplaysPage />); await unlock();
  await act(async () => vi.advanceTimersByTime(15000)); expect(axios.get).toHaveBeenCalledTimes(1);
  await act(async () => req.resolve({ data: { items: [], riotConfigured: false } }));
  const next = deferred(); axios.get.mockReturnValueOnce(next.promise); await act(async () => vi.advanceTimersByTime(5000)); expect(axios.get).toHaveBeenCalledTimes(2);
  const signal = axios.get.mock.calls[1][1].signal; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => next.resolve({ data: { items: [item()], riotConfigured: true } })); await act(async () => vi.advanceTimersByTime(20000)); expect(axios.get).toHaveBeenCalledTimes(2);
});

test('zero scores stay zero and expandable metrics expose backend gold/kill structure', async () => {
  axios.get.mockResolvedValue({ data: { riotConfigured: true, items: [item('EUW1_123', { version: 1, balance: 0, carry: 0, momentum: 0, overall: 0, metrics: { gold: { swing: 4321, leadChanges: 2 }, teams: [{ teamId: 100, kills: 12, players: [{ participantId: 1, kills: 4 }] }] } })] } });
  render(<ReplaysPage />); await unlock();
  expect(screen.getAllByText('0', { selector: '.replay-scores dd' })).toHaveLength(4);
  fireEvent.click(screen.getByText('Metriken und Datei-Details'));
  expect(screen.getByText('Gold-Schwankung')).toBeInTheDocument(); expect(screen.getByText('4321', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('Führungswechsel')).toBeInTheDocument(); expect(screen.getByText('2', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('Kill-Verteilung (Teams / Spieler)')).toBeInTheDocument();
});

test('malformed list item produces an accessible response error instead of rendering unsafe data', async () => {
  axios.get.mockResolvedValue({ data: { items: [null], riotConfigured: true } });
  render(<ReplaysPage />); await unlock(); expect(screen.getByRole('alert')).toHaveTextContent(/Ungültige/); expect(screen.queryByRole('article')).not.toBeInTheDocument();
});

test('action conflict is visible, duplicate submission is blocked, and auth failure aborts actions', async () => {
  const req = deferred(); axios.post.mockReturnValueOnce(req.promise);
  axios.get.mockResolvedValue({ data: { items: [item()], riotConfigured: false } });
  render(<ReplaysPage />); await unlock();
  fireEvent.click(screen.getByRole('button', { name: 'Analyse wiederholen' })); fireEvent.click(screen.getByRole('button', { name: 'Analyse wiederholen' })); expect(axios.post).toHaveBeenCalledTimes(1);
  await act(async () => req.resolve(Promise.reject({ response: { status: 409 } })));
  expect(screen.getByRole('alert')).toHaveTextContent(/Konflikt/); expect(screen.getByRole('button', { name: 'Analyse wiederholen' })).toBeEnabled();
  axios.post.mockRejectedValueOnce({ response: { status: 403 } }); fireEvent.click(screen.getByRole('button', { name: 'Analyse wiederholen' })); await flush();
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent(/abgelehnt/); expect(axios.post.mock.calls[1][2].signal.aborted).toBe(true);
});

test('auth expiry during polling clears previous results and stops polling', async () => {
  vi.useFakeTimers(); axios.get.mockResolvedValueOnce({ data: { items: [item()], riotConfigured: true } }).mockRejectedValue({ response: { status: 401 } });
  render(<ReplaysPage />); await unlock(); expect(screen.getByRole('article')).toBeInTheDocument(); await act(async () => vi.advanceTimersByTime(5000));
  expect(screen.queryByRole('article')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent(/abgelehnt/); await act(async () => vi.advanceTimersByTime(15000)); expect(axios.get).toHaveBeenCalledTimes(2);
});
