import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import FrontPage from "../FrontPage/FrontPage";
import NameForm from "../FrontPage/NameForm";
import CreationPage from "../CreationPage/CreationPage";
import Player from "../TeamSelectionPage/Player";
import { readActiveSession, playerTokenKey, hostTokenKey, writeActiveSession } from "../api";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } }));
vi.mock("axios", () => ({ default: { ...http, create: () => http } }));
const settings = { gameId: 7, gameCode: "KFRW", punishmentAmount: 3, rewardAmount: 5 };
const player = { playerId: 42, game: 7, playerToken: "a".repeat(64) };
const mount = (element, route = "/") => render(<MemoryRouter initialEntries={[route]}>
  <Routes>
    <Route path="/" element={element} />
    <Route path="/name/:parameter" element={<><FrontPage /><Link to="/name/ABCD">Other invitation</Link></>} />
    <Route path="/team" element={<p>Team selection</p>} />
  </Routes>
</MemoryRouter>);
const submitName = (name = "Alice") => {
  fireEvent.change(screen.getByLabelText("What is your name?"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "START" }));
};
beforeEach(() => {
  vi.resetAllMocks();
  http.get.mockResolvedValue({ data: settings });
  http.post.mockResolvedValue({ data: player });
});

test("an invitation ignores changes to shared storage between rendering and submitting (#21)", async () => {
  localStorage.setItem("GameID", "99");
  writeActiveSession({ gameId: 99, playerId: 100 });
  mount(null, "/name/KFRW");
  expect(localStorage.getItem("GameID")).toBe("99");
  expect(screen.getByLabelText("Game code")).toHaveValue("KFRW");
  expect(screen.getByLabelText("Game code")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("What is your name?"), { target: { value: " Alice " } });
  localStorage.setItem("GameID", "8");
  localStorage.setItem("gameCode", "ABCD");
  fireEvent.click(screen.getByRole("button", { name: "START" }));
  await screen.findByText("Team selection");
  expect(http.get).toHaveBeenCalledWith("getSettings", { params: { gameCode: "KFRW" } });
  expect(http.post).toHaveBeenCalledWith("createPlayer", { playerName: "Alice", gameCode: "KFRW" });
  expect(readActiveSession()).toEqual({ gameId: 7, gameCode: "KFRW", playerId: 42, playerName: "Alice" });
  expect(sessionStorage.getItem(playerTokenKey(7, 42))).toBe(player.playerToken);
  expect(sessionStorage.getItem(playerTokenKey(8, 42))).toBeNull();
  expect(localStorage.getItem("playerToken")).toBeNull();
});

test("manual entry normalizes whitespace/case without needing a link", async () => {
  mount(<NameForm />);
  fireEvent.change(screen.getByLabelText("Game code"), { target: { value: " kfrw " } });
  submitName();
  await screen.findByText("Team selection");
  expect(http.post).toHaveBeenCalledWith("createPlayer", { playerName: "Alice", gameCode: "KFRW" });
});

test("lowercase invitation codes are normalized", async () => {
  mount(null, "/name/kfrw");
  submitName();
  await screen.findByText("Team selection");
  expect(http.get).toHaveBeenCalledWith("getSettings", { params: { gameCode: "KFRW" } });
});

test.each(["7", "undefined", "ABC", "ABCDE", "AB1D", "-1", "1.5"])("invalid link %s is rejected without any API request", code => {
  mount(null, `/name/${code}`);
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid invitation");
  expect(screen.queryByRole("button", { name: "START" })).not.toBeInTheDocument();
  expect(http.get).not.toHaveBeenCalled();
  expect(http.post).not.toHaveBeenCalled();
});

test("manual invalid codes are blocked even if the form is submitted programmatically", async () => {
  mount(<NameForm />);
  fireEvent.change(screen.getByLabelText("Game code"), { target: { value: "AB1D" } });
  fireEvent.change(screen.getByLabelText("What is your name?"), { target: { value: "Alice" } });
  const button = screen.getByRole("button", { name: "START" });
  expect(button).toBeDisabled();
  fireEvent.submit(button.closest("form"));
  await screen.findByRole("alert");
  expect(http.get).not.toHaveBeenCalled();
  expect(http.post).not.toHaveBeenCalled();
});

test("a route change resets the form to the new invitation", () => {
  mount(null, "/name/KFRW");
  fireEvent.change(screen.getByLabelText("What is your name?"), { target: { value: "Alice" } });
  fireEvent.click(screen.getByRole("link", { name: "Other invitation" }));
  expect(screen.getByLabelText("Game code")).toHaveValue("ABCD");
  expect(screen.getByLabelText("What is your name?")).toHaveValue("");
});

test("pending submission keeps its code and prevents duplicate joins", async () => {
  let resolve;
  http.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(<NameForm gameCode="KFRW" />);
  submitName();
  expect(screen.getByLabelText("Game code")).toBeDisabled();
  const form = screen.getByRole("button", { name: "START" }).closest("form");
  fireEvent.submit(form);
  localStorage.setItem("gameCode", "ABCD");
  await act(async () => resolve({ data: settings }));
  await screen.findByText("Team selection");
  expect(http.get).toHaveBeenCalledTimes(1);
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.post).toHaveBeenCalledWith("createPlayer", { playerName: "Alice", gameCode: "KFRW" });
});

test.each(["unknown code", "game has ended", "Too many join attempts"])("lookup failure '%s' is visible and creates no player", async message => {
  http.get.mockRejectedValueOnce(new Error(message));
  mount(<NameForm gameCode="KFRW" />);
  submitName();
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  await waitFor(() => expect(screen.getByRole("button", { name: "START" })).toBeEnabled());
  expect(http.post).not.toHaveBeenCalled();
  expect(readActiveSession()).toBeNull();
});

test("mismatched settings are rejected before player creation", async () => {
  http.get.mockResolvedValueOnce({ data: { ...settings, gameCode: "ABCD" } });
  mount(<NameForm gameCode="KFRW" />);
  submitName();
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid game response");
  expect(http.post).not.toHaveBeenCalled();
});

test("a player response for another game cannot replace the active session", async () => {
  writeActiveSession({ gameId: 99, playerId: 100 });
  http.post.mockResolvedValueOnce({ data: { ...player, game: 8 } });
  mount(<NameForm gameCode="KFRW" />);
  submitName();
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid player response");
  expect(readActiveSession()).toEqual({ gameId: 99, playerId: 100 });
});

test("home offers manual join and preserves a host's code across reloads", () => {
  writeActiveSession({ gameId: 7, gameCode: "KFRW" });
  sessionStorage.setItem(hostTokenKey(7), "b".repeat(64));
  mount(<CreationPage />);
  expect(screen.getByRole("heading", { name: "Join a game" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Host a game" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: `${window.location.origin}/name/KFRW` })).toHaveAttribute("href", `${window.location.origin}/name/KFRW`);
  expect(http.get).not.toHaveBeenCalled();
});

test("host sessions from before the migration recover their code with host authorization", async () => {
  writeActiveSession({ gameId: 7 });
  sessionStorage.setItem(hostTokenKey(7), "b".repeat(64));
  mount(<CreationPage />);
  await screen.findByText("KFRW");
  expect(http.get).toHaveBeenCalledWith("getInvitation", expect.objectContaining({ params: { gameId: 7 }, headers: { "X-Game-Token": "b".repeat(64) } }));
  expect(readActiveSession()).toEqual({ gameId: 7, gameCode: "KFRW" });
});

test("legacy localStorage host capabilities can recover a code into a per-tab session", async () => {
  localStorage.setItem("GameID", "7");
  localStorage.setItem("hostToken:7", "b".repeat(64));
  mount(<CreationPage />);
  await screen.findByText("KFRW");
  expect(http.get).toHaveBeenCalledWith("getInvitation", expect.objectContaining({ headers: { "X-Game-Token": "b".repeat(64) } }));
  expect(readActiveSession()).toEqual({ gameId: 7, gameCode: "KFRW" });
});

test("leaving a game returns to its code invitation, not an obsolete numeric link", async () => {
  writeActiveSession({ gameId: 7, gameCode: "KFRW", playerId: 42, playerName: "Alice" });
  sessionStorage.setItem(playerTokenKey(7, 42), player.playerToken);
  mount(<Player playerName="Alice" id={42} editModeOn />);
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  await screen.findByLabelText("Game code");
  expect(screen.getByLabelText("Game code")).toHaveValue("KFRW");
  expect(http.post).toHaveBeenCalledWith("deletePlayer", { id: 42 });
  expect(readActiveSession()).toEqual({ gameId: 7, gameCode: "KFRW" });
  expect(sessionStorage.getItem(playerTokenKey(7, 42))).toBeNull();
});
