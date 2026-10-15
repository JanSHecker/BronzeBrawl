import { expect, test } from "vitest";
import api, { validateGame, inviteUrl } from "../api";

test("API requests use a bounded timeout and read the current player's capability", async () => {
  localStorage.setItem("playerToken", "a".repeat(64));
  const headers = [];
  const adapter = async config => {
    expect(config.baseURL).toBe("/api/");
    expect(config.timeout).toBe(10000);
    headers.push(config.headers.get("X-Player-Token"));
    return { status: 200, statusText: "OK", headers: {}, config, data: {} };
  };
  await api.get("Status", { adapter });
  localStorage.setItem("playerToken", "b".repeat(64));
  await api.post("joinTeam", { player: 42, team: 20 }, { adapter });
  expect(headers).toEqual(["a".repeat(64), "b".repeat(64)]);
});

test.each([undefined, "<html>SPA</html>", { gameId: "7" }, { gameId: 0 }, { gameId: 7 }])("invalid creation response never produces an invite: %j", game => {
  expect(() => validateGame(game)).toThrow();
});

test("only integer IDs and a host capability form a valid creation response", () => {
  const game = { gameId: 7, hostToken: "a".repeat(64) };
  expect(validateGame(game)).toBe(game);
  expect(inviteUrl(undefined)).toBe("");
  expect(inviteUrl("undefined")).toBe("");
  expect(inviteUrl(7)).toBe(`${window.location.origin}/name/7`);
});
