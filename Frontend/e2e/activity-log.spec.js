import { test, expect } from "@playwright/test";

test("/log displays durable history, polls new activity and recovers after reload (synthetic fixtures)", async ({ page }) => {
  const token = "a".repeat(64);
  await page.addInitScript(token => {
    sessionStorage.setItem("bb:active", JSON.stringify({ gameId: 42 }));
    sessionStorage.setItem("bb:host:42", token);
  }, token);
  const entry = (activityId, type, data = {}) => ({
    activityId, gameId: 42, type, data, gameTime: 90, recordedAt: "2026-10-16T12:00:00Z",
  });
  const entries = [entry(1, "game_created"), entry(2, "player_joined", { player: { playerId: 7, playerName: "Synthetic Alice" } })];
  await page.route("**/api/companion/status?*", route => route.fulfill({
    json: { gameId: 42, paired: false, connected: false, feedFresh: false },
  }));
  await page.route("**/api/gameActivity?*", route => {
    expect(route.request().headers()["x-game-token"]).toBe(token);
    const after = Number(new URL(route.request().url()).searchParams.get("after"));
    return route.fulfill({ json: { items: after ? entries.filter(item => item.activityId > after) : [...entries].reverse(), nextCursor: null } });
  });
  await page.goto("/log");
  await expect(page.getByRole("heading", { name: "Game event log" })).toBeVisible();
  await expect(page.getByText("Synthetic Alice joined the game.", { exact: true })).toBeVisible();
  entries.push(entry(3, "game_ended"));
  await expect(page.getByText("Game ended.", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(3);
  await page.reload();
  await expect(page.getByText("Game ended.", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(3);
});
