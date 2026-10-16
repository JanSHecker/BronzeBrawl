import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, vi, test, expect } from "vitest";
import CreationForm from "../CreationPage/CreationForm";
import Linkbox from "../CreationPage/Linkbox";
import PunishmentDisplay from "../StatusPage/PunishmentDisplay";
import StatusPage from "../StatusPage/StatusPage";
import DistributionCard from "../StatusPage/DistributionCard";
import TeamSelectionPage from "../TeamSelectionPage/TeamSelectionPage";
import ChampionCard from "../ChampionSelectionPage/ChampionCard";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } }));
vi.mock("axios", () => ({ default: { ...http, create: () => http, isCancel: () => false } }));
const mount = (element) => render(<MemoryRouter>{element}</MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem("playerId", "42");
  localStorage.setItem("playerToken", "a".repeat(64));
  localStorage.setItem("GameID", "7");
});

test("creation rejects HTML success without publishing an undefined invite", async () => {
  http.get.mockResolvedValue({ data: "<!doctype html>SPA" });
  const setGame = vi.fn();
  mount(<CreationForm setGame={setGame} />);
  const inputs = screen.getAllByRole("textbox");
  inputs.forEach(input => fireEvent.change(input, { target: { value: "3" } }));
  fireEvent.click(screen.getByRole("button", { name: "CREATE" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(setGame).not.toHaveBeenCalled();
  expect(localStorage.getItem("GameID")).toBe("7");
});

test("invite URLs use an origin-based route, never the current query/hash", () => {
  window.history.replaceState({}, "", "/?source=test#section");
  mount(<Linkbox gameCode="KFRW" />);
  expect(screen.getByText(`${window.location.origin}/name/KFRW`)).toBeInTheDocument();
  expect(screen.getByText("KFRW")).toBeInTheDocument();
  window.history.replaceState({}, "", "/");
});

test("environment punishment renders without a killer and confirmation recovers", async () => {
  http.post.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ data: {} });
  mount(<PunishmentDisplay punishmentStack={[{ punishmentId: 1, punishmentType: 1, amount: 7, takedown: { killer: null } }]} />);
  expect(screen.getByText(/Drink 7/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(http.post).toHaveBeenCalledTimes(2));
});

test("status polling recovers after a transient failure and uses canonical state", async () => {
  http.get.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue({ data: {
    punishments: [], rewards: [], counter: [2, 2], kda: [1, 2, 3], enemyTeam: [],
    champion: { championId: 5, championName: "Ahri" }, team: { teamId: 20, teamName: 0 },
    rotationMode: "Deaths", gameState: "live", feedStale: false,
  } });
  mount(<StatusPage />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("1/2/3")).toBeInTheDocument(), { timeout: 4000 });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(http.get.mock.calls[0][1].params).toEqual({ playerId: 42 });
});

test("reward distribution recovers from a failure without trusting client amounts", async () => {
  http.post.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({ data: {} });
  mount(<DistributionCard champion={{ championName: "Garen", player: { playerId: 9, playerName: "Opponent" } }} rewardStack={[{ rewardId: 8 }]} hasRewards />);
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.getByRole("button")).toBeEnabled();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(http.post).toHaveBeenCalledTimes(2));
  expect(http.post.mock.calls[1][1]).toEqual({ id: 8, punishment: { recipient: { playerId: 9 } } });
});

test("duplicate names do not grant team membership and semantic IDs determine color", async () => {
  localStorage.setItem("playerName", "Alex");
  http.get.mockResolvedValue({ data: { teams: [{ teamId: 20, teamName: 0 }, { teamId: 35, teamName: 1 }], players: { blue: [{ playerId: 99, playerName: "Alex" }], red: [] } } });
  mount(<TeamSelectionPage />);
  await screen.findByText("Alex");
  expect(screen.getByRole("button", { name: "READY" })).toBeDisabled();
  expect(screen.getByText("Team Blue").closest("section")).toHaveClass("bg-cyan-500");
});

test("champion selection awaits the commit and recovers after an occupied conflict", async () => {
  http.post.mockRejectedValueOnce({ response: { status: 409, data: { message: "champion is occupied" } } }).mockResolvedValueOnce({ data: {} });
  mount(<ChampionCard champion={{ championId: 3, championName: "Ahri", player: null }} />);
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("champion is occupied"));
  expect(localStorage.getItem("activeChampionId")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(localStorage.getItem("activeChampionId")).toBe("3"));
  expect(http.post.mock.calls[1][1]).toEqual({ player: 42, champion: 3 });
});

test("creation ignores duplicate submissions and version-service outages", async () => {
  let resolve;
  http.get.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error("version service offline"));
  const setGame = vi.fn();
  mount(<CreationForm setGame={setGame} />);
  screen.getAllByRole("textbox").forEach(input => fireEvent.change(input, { target: { value: "3" } }));
  const button = screen.getByRole("button", { name: "CREATE" });
  fireEvent.submit(button.closest("form"));
  fireEvent.submit(button.closest("form"));
  expect(http.get).toHaveBeenCalledTimes(1);
  resolve({ data: { gameId: 8, gameCode: "KFRW", hostToken: "b".repeat(64) } });
  await waitFor(() => expect(setGame).toHaveBeenCalledWith({ gameId: 8, gameCode: "KFRW" }));
  expect(sessionStorage.getItem("bb:host:8")).toBe("b".repeat(64));
  expect(localStorage.getItem("hostToken:8")).toBeNull();
});
