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
