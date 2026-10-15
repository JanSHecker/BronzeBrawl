import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import axios from "axios";
import { hostTokenKey, writeActiveSession } from "../api";
import { LiveFeedProvider } from "../LoLApi/LiveFeed";
import CompanionPage from "../CompanionPage/CompanionPage";

vi.mock("axios", () => {
  const client = { get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } };
  client.create = vi.fn(() => client);
  return { default: client };
});
const host = id => {
  sessionStorage.setItem(hostTokenKey(id), `host-${id}`);
  writeActiveSession({ gameId: id });
};
const status = (gameId = 5, changes = {}) => ({ gameId, paired: true, connected: true, availability: "live", feedFresh: true, ...changes });
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  axios.get.mockImplementation((_url, config) => Promise.resolve({ data: status(config.params.gameId) }));
  axios.post.mockResolvedValue({ data: { gameId: 5, token: "a".repeat(64) } });
});

test("host polls only backend connection status and never reads localhost or relays inputs", async () => {
  host(5);
  render(<LiveFeedProvider />);
  await act(async () => {});
  expect(axios.get).toHaveBeenCalledWith("companion/status", expect.objectContaining({ params: { gameId: 5 }, headers: { "X-Game-Token": "host-5" }, signal: expect.any(AbortSignal) }));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Live-Daten kommen direkt am Server an");
  expect(axios.post).not.toHaveBeenCalled();
  expect(axios.get.mock.calls.every(([url]) => !url.includes("localhost") && !url.includes("127.0.0.1"))).toBe(true);
});

test("player sessions never poll host status; creating a host session starts polling", async () => {
  writeActiveSession({ gameId: 5, playerId: 42 });
  render(<LiveFeedProvider />);
  await act(async () => {});
  expect(axios.get).not.toHaveBeenCalled();
  await act(async () => host(8));
  expect(axios.get).toHaveBeenCalledWith("companion/status", expect.objectContaining({ params: { gameId: 8 } }));
});

test("connection, missing game, stale feed, conflict and outage are distinct and recover", async () => {
  host(5);
  axios.get.mockResolvedValueOnce({ data: status(5, { paired: false, connected: false, feedFresh: false }) })
    .mockResolvedValueOnce({ data: status(5, { connected: false, feedFresh: false }) })
    .mockResolvedValueOnce({ data: status(5, { availability: "waiting", feedFresh: false }) })
    .mockResolvedValueOnce({ data: status(5, { availability: "conflict", feedFresh: false }) })
    .mockRejectedValueOnce(new Error("Backend offline"));
  render(<LiveFeedProvider />);
  await act(async () => {});
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("nicht eingerichtet");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("nicht verbunden");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("verbunden – warte auf LoL");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Feed abgelehnt");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Backend offline");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Live-Daten kommen direkt");
});

test("switching host games cancels the old request and ignores its result", async () => {
  host(5);
  let finish;
  axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<LiveFeedProvider />);
  const oldSignal = axios.get.mock.calls[0][1].signal;
  await act(async () => host(8));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finish({ data: status(5, { connected: false }) }));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Live-Daten kommen direkt");
  const newSignal = axios.get.mock.calls[1][1].signal;
  view.unmount();
  expect(newSignal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
});

test("companion page mints a restricted connection code without host token and can revoke access", async () => {
  host(5);
  render(<LiveFeedProvider><CompanionPage /></LiveFeedProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Neuen Verbindungscode erstellen" }));
  await act(async () => {});
  const code = screen.getByLabelText("Verbindungscode").value;
  const encoded = code.slice(4).replace(/-/g, "+").replace(/_/g, "/");
  expect(JSON.parse(atob(encoded))).toEqual({ backendUrl: new URL("/api", window.location.origin).href, gameId: 5, token: "a".repeat(64) });
  expect(code).not.toContain("host-5");
  expect(axios.post).toHaveBeenCalledWith("companion/connect", { gameId: 5 }, expect.objectContaining({ headers: { "X-Game-Token": "host-5" } }));
  fireEvent.click(screen.getByRole("button", { name: "Companion-Zugriff widerrufen" }));
  await act(async () => {});
  expect(screen.queryByLabelText("Verbindungscode")).not.toBeInTheDocument();
  expect(axios.post).toHaveBeenCalledWith("companion/disconnect", { gameId: 5 }, expect.anything());
  expect(screen.queryByText(/Replay/)).not.toBeInTheDocument();
});

test("invalid status is never shown as connected and invalid codes are not exposed", async () => {
  host(5);
  axios.get.mockResolvedValue({ data: "<html>not an API</html>" });
  axios.post.mockResolvedValue({ data: { gameId: 5, token: "invalid" } });
  render(<LiveFeedProvider><CompanionPage /></LiveFeedProvider>);
  await act(async () => {});
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Ungültiger Companion-Status");
  fireEvent.click(screen.getByRole("button", { name: "Neuen Verbindungscode erstellen" }));
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent("Ungültiger Verbindungscode");
  expect(screen.queryByLabelText("Verbindungscode")).not.toBeInTheDocument();
});
