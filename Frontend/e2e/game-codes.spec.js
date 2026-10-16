import { test, expect } from "@playwright/test";

// Exercise the real UI and browser storage with a synthetic, in-process API.
// No players are created on a public server; backend behavior has separate HTTP tests.
async function fixture(context) {
  const games = {
    KFRW: { gameId: 7, gameCode: "KFRW", punishmentAmount: 3, rewardAmount: 5, rotationMode: "Kills", defaultRotationCounter: 2 },
    ABCD: { gameId: 8, gameCode: "ABCD", punishmentAmount: 7, rewardAmount: 9, rotationMode: "Kills", defaultRotationCounter: 2 },
  };
  const joins = [], lookups = [];
  await context.route("https://ddragon.leagueoflegends.com/**", route => route.fulfill({ json: [] }));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const endpoint = url.pathname.replace("/api/", "");
    if (endpoint === "getSettings") {
      const gameCode = url.searchParams.get("gameCode");
      lookups.push(gameCode);
      return route.fulfill(games[gameCode] ? { json: games[gameCode] } : { status: 404, json: { message: "Game not found" } });
    }
    if (endpoint === "createPlayer") {
      const body = request.postDataJSON();
      joins.push(body);
      const game = games[body.gameCode];
      if (!game) return route.fulfill({ status: 400, json: { message: "Invalid game code" } });
      return route.fulfill({ status: 201, json: { playerId: 40 + joins.length, playerName: body.playerName, game: game.gameId, playerToken: (game.gameId === 7 ? "a" : "b").repeat(64) } });
    }
    if (endpoint === "getTeams") return route.fulfill({ json: { teams: [], players: { blue: [], red: [] } } });
    if (endpoint === "runGame") return route.fulfill({ json: { ...games.KFRW, hostToken: "c".repeat(64) } });
    if (endpoint === "companion/status") return route.fulfill({ json: { gameId: 7, connected: false, paired: false, feedFresh: false } });
    return route.fulfill({ status: 404, json: { message: "Unexpected test endpoint" } });
  });
  return { joins, lookups };
}

test("two tabs sharing localStorage join their own invitation and retain separate sessions (#21)", async ({ context, page }) => {
  const { joins, lookups } = await fixture(context);
  const other = await context.newPage();
  try {
    await page.goto("/name/KFRW");
    await page.getByLabel("What is your name?").fill("Alice");
    await other.goto("/name/ABCD");
    await other.getByLabel("What is your name?").fill("Bob");
    await other.evaluate(() => { localStorage.setItem("GameID", "8"); localStorage.setItem("gameCode", "ABCD"); });
    expect(await page.evaluate(() => localStorage.getItem("GameID"))).toBe("8");

    await page.getByRole("button", { name: "START", exact: true }).click();
    await expect(page).toHaveURL(/\/team$/);
    await other.getByRole("button", { name: "START", exact: true }).click();
    await expect(other).toHaveURL(/\/team$/);
    expect(lookups).toEqual(["KFRW", "ABCD"]);
    expect(joins).toEqual([{ playerName: "Alice", gameCode: "KFRW" }, { playerName: "Bob", gameCode: "ABCD" }]);

    for (const [tab, gameId, gameCode, playerName] of [[page, 7, "KFRW", "Alice"], [other, 8, "ABCD", "Bob"]]) {
      await tab.reload();
      await expect(tab.getByRole("button", { name: "READY", exact: true })).toBeDisabled();
      const session = await tab.evaluate(() => JSON.parse(sessionStorage.getItem("bb:active")));
      expect(session).toMatchObject({ gameId, gameCode, playerName });
      const token = await tab.evaluate(({ gameId, playerId }) => sessionStorage.getItem(`bb:player:${gameId}:${playerId}`), session);
      expect(token).toBe((gameId === 7 ? "a" : "b").repeat(64));
    }
  } finally { await other.close(); }
});

test("players can join from the home page using a spoken code", async ({ context, page }) => {
  const { joins } = await fixture(context);
  await page.goto("/");
  await page.getByLabel("Game code", { exact: true }).fill(" kfrw ");
  await page.getByLabel("What is your name?").fill("Alice");
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page).toHaveURL(/\/team$/);
  expect(joins).toEqual([{ playerName: "Alice", gameCode: "KFRW" }]);
});

test("hosts see a four-letter code and optional link, including after reload", async ({ context, page }) => {
  await fixture(context);
  await page.goto("/");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "CREATE", exact: true }) });
  for (const input of await form.getByRole("textbox").all()) await input.fill("3");
  await page.getByRole("button", { name: "CREATE", exact: true }).click();
  await expect(page.getByText("Game code: KFRW", { exact: true })).toBeVisible();
  await expect(page.locator('a[href$="/name/KFRW"]')).toBeVisible();
  await page.reload();
  await expect(page.getByText("Game code: KFRW", { exact: true })).toBeVisible();
});

test("numeric legacy invitation links cannot accidentally join a game", async ({ context, page }) => {
  const { joins, lookups } = await fixture(context);
  await page.goto("/name/7");
  await expect(page.getByRole("alert")).toContainText("Invalid invitation");
  await expect(page.getByRole("button", { name: "START", exact: true })).toHaveCount(0);
  expect(joins).toEqual([]);
  expect(lookups).toEqual([]);
});
