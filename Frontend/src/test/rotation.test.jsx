import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import axios from "axios";
import ChampionRotation from "../StatusPage/ChampionRotation";
import ChampionSelectionPage from "../ChampionSelectionPage/ChampionSelectionPage";
import StatusPage from "../StatusPage/StatusPage";
import { formatRotationTime, rotationAvailable } from "../rotation";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("axios", () => {
  const client = { get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } };
  client.create = () => client;
  return { default: client };
});
const champion = { championId: 9, championName: "Ahri", player: null };
const status = {
  champion, team: { teamId: 2, teamName: 0 }, gameState: "live",
  punishments: [], rewards: [], kda: [0, 0, 0], enemyTeam: [],
  rotationRemainingSeconds: 180, rotationAvailable: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("GameID", "5");
  localStorage.setItem("playerId", "42");
});

test("formats game seconds, including extended timers, without rounding down early", () => {
  expect(formatRotationTime(180)).toBe("3:00");
  expect(formatRotationTime(61.1)).toBe("1:02");
  expect(formatRotationTime(0.1)).toBe("0:01");
  expect(formatRotationTime(-10)).toBe("0:00");
  expect(formatRotationTime(240)).toBe("4:00");
  expect(formatRotationTime(null)).toBe("—");
});

test("status renders the champion timer without any mode or counter fields", async () => {
  axios.get.mockResolvedValue({ data: status });
  render(<StatusPage />);
  await act(async () => {});
  expect(screen.getByText("3:00")).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

test.each([0, 2, 10])('status displays %s shield out of ten', async shield => {
  axios.get.mockResolvedValue({ data: { ...status, player: { playerName: 'Alex', shield } } });
  render(<StatusPage />);
  expect(await screen.findByLabelText(`Shield ${shield}/10`)).toHaveTextContent(`${shield}/10`);
});

test("timer follows server updates and redirects at expiry", () => {
  const props = { navigate };
  const view = render(<ChampionRotation {...props} rotationRemainingSeconds={180} rotationAvailable={false} />);
  expect(screen.getByText("3:00")).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  view.rerender(<ChampionRotation {...props} rotationRemainingSeconds={240} rotationAvailable={false} />);
  expect(screen.getByText("4:00")).toBeInTheDocument();
  view.rerender(<ChampionRotation {...props} rotationRemainingSeconds={0} rotationAvailable />);
  expect(navigate).toHaveBeenCalledWith("/champion", { replace: true });
});

test("missing timer data and ended games never cause a rotation redirect", () => {
  const props = { navigate };
  const view = render(<ChampionRotation {...props} rotationRemainingSeconds={null} />);
  expect(screen.getByText("—")).toBeInTheDocument();
  view.rerender(<ChampionRotation {...props} rotationRemainingSeconds={0} rotationAvailable ended />);
  expect(navigate).not.toHaveBeenCalled();
  expect(rotationAvailable({ ...status, rotationRemainingSeconds: 0, rotationAvailable: true, gameState: "ended" })).toBe(false);
});

test("obsolete combat counters cannot unlock rotation", () => {
  expect(rotationAvailable({ ...status, rotationAvailable: undefined, counter: [0, 0], rotationMode: "Kills" })).toBe(false);
  expect(rotationAvailable({ rotationRemainingSeconds: 0, gameState: "live" })).toBe(true);
});

test("champion selection cannot open before the timer expires", async () => {
  axios.get.mockResolvedValue({ data: status });
  render(<ChampionSelectionPage />);
  await act(async () => {});
  expect(navigate).toHaveBeenCalledWith("/status", { replace: true });
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("an expired timer opens manual selection", async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url === "getAllChampions"
    ? { blue: [champion], red: [] }
    : { ...status, rotationRemainingSeconds: 0, rotationAvailable: true } }));
  render(<ChampionSelectionPage />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Ahri" })).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

test.each([[30, '0:30'], [12.5, '0:13']])('selection displays the server countdown at %s game seconds', async (remaining, text) => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url === 'getAllChampions'
    ? { blue: [champion], red: [] }
    : { ...status, champion: null, player: { previousChampionId: 8 }, championSelectionRemainingSeconds: remaining } }));
  render(<ChampionSelectionPage />);
  const countdown = await screen.findByRole('timer', { name: 'Automatic champion assignment countdown' });
  expect(countdown).toHaveTextContent(`Automatic champion assignment in ${text} (game time).`);
  expect(navigate).not.toHaveBeenCalled();
});

test('an expired selection countdown explains waiting for a free champion', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url === 'getAllChampions'
    ? { blue: [], red: [] }
    : { ...status, champion: null, player: { previousChampionId: 8 }, championSelectionRemainingSeconds: 0 } }));
  render(<ChampionSelectionPage />);
  expect(await screen.findByRole('timer')).toHaveTextContent('Automatic assignment pending. Waiting for an available champion.');
});

test('selection countdown follows polling and redirects after server assignment', async () => {
  vi.useFakeTimers();
  let current = { ...status, champion: null, player: { previousChampionId: 8 }, championSelectionRemainingSeconds: 30 };
  axios.get.mockImplementation(url => Promise.resolve({ data: url === 'getAllChampions'
    ? { blue: [champion], red: [] } : current }));
  const view = render(<ChampionSelectionPage />);
  try {
    await act(async () => {});
    expect(screen.getByRole('timer')).toHaveTextContent('0:30');
    // Wall time alone cannot consume game seconds.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('timer')).toHaveTextContent('0:30');
    current = { ...current, championSelectionRemainingSeconds: 12 };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('timer')).toHaveTextContent('0:12');
    current = { ...current, champion, championSelectionRemainingSeconds: null, rotationAvailable: false };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(navigate).toHaveBeenCalledWith('/status', { replace: true });
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

test('initial selection and ended games do not show an automatic countdown', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url === 'getAllChampions'
    ? { blue: [], red: [] }
    : { ...status, champion: null, championSelectionRemainingSeconds: null } }));
  const view = render(<ChampionSelectionPage />);
  await act(async () => {});
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  view.unmount();
  axios.get.mockImplementation(url => Promise.resolve({ data: url === 'getAllChampions'
    ? { blue: [], red: [] }
    : { ...status, champion: null, gameState: 'ended', championSelectionRemainingSeconds: 10 } }));
  render(<ChampionSelectionPage />);
  await act(async () => {});
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
});
