import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import axios from "axios";
import { hostTokenKey, writeActiveSession } from "../api";
import { LiveFeedProvider } from "../LoLApi/LiveFeed";
import LoLApiFeed from "../LoLApi/LolApi";

vi.mock("axios", () => {
  const client = { get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } };
  client.create = vi.fn(() => client);
  return { default: client };
});
const input = { gameData: { gameTime: 12, mapNumber: 11 }, allPlayers: [] };
const host = id => {
  sessionStorage.setItem(hostTokenKey(id), `host-${id}`);
  writeActiveSession({ gameId: id });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  axios.get.mockResolvedValue({ data: input });
  axios.post.mockResolvedValue({ data: { ok: true } });
});

test("restored host session automatically relays without a monitor or pairing step", async () => {
  host(5);
  render(<LiveFeedProvider><div>Haupt-App</div></LiveFeedProvider>);
  await act(async () => {});
  expect(axios.get).toHaveBeenCalledWith("http://localhost:3002/lol-data", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(axios.post).toHaveBeenCalledWith("sendLoLInput", { gameId: 5, input }, expect.objectContaining({ headers: { "X-Game-Token": "host-5" } }));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("automatisch weitergegeben");
});

test("creating a host session starts the feed immediately and player sessions do not", async () => {
  writeActiveSession({ gameId: 5, playerId: 42 });
  render(<LiveFeedProvider><LoLApiFeed /></LiveFeedProvider>);
  await act(async () => {});
  expect(axios.get).not.toHaveBeenCalled();
  await act(async () => host(8));
  expect(axios.post).toHaveBeenCalledWith("sendLoLInput", { gameId: 8, input }, expect.anything());
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("missing Companion and missing LoL game recover automatically", async () => {
  host(5);
  axios.get.mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce({ response: { status: 503 } });
  render(<LiveFeedProvider />);
  await act(async () => {});
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Warte auf den Companion");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.getByTestId("live-feed-status")).toHaveTextContent("Warte auf ein laufendes LoL-Spiel");
  expect(axios.post).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test("switching host games cancels old input and never posts it to the new game", async () => {
  host(5);
  let finish;
  axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<LiveFeedProvider />);
  const oldSignal = axios.get.mock.calls[0][1].signal;
  await act(async () => host(8));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => finish({ data: { old: true } }));
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).toEqual({ gameId: 8, input });
  const newSignal = axios.get.mock.calls[1][1].signal;
  view.unmount();
  expect(newSignal.aborted).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).toHaveBeenCalledTimes(1);
});
