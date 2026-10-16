import { test, expect } from "@playwright/test";

// Clearly synthetic audit fixtures, never uploaded to the public service.
const roster = [
  { championName: "Ahri", riotIdGameName: "AuditAlice", riotIdTagLine: "TEST", team: "ORDER" },
  { championName: "Lux", riotIdGameName: "AuditAssist", riotIdTagLine: "TEST", team: "ORDER" },
  { championName: "Garen", riotIdGameName: "AuditBob", riotIdTagLine: "TEST", team: "CHAOS" },
];
const kill = (id, killer = "AuditAlice#TEST") => ({ EventID: id, EventName: "ChampionKill", EventTime: id, KillerName: killer, VictimName: "AuditBob#TEST", Assisters: ["AuditAssist#TEST"] });

test("old replay entry redirects to companion without replay UI or localhost access", async ({ page }) => {
  const feedRequests = [];
   page.on("request", request => { if (/localhost:3002|127\.0\.0\.1:3002|sendLoLInput/.test(request.url())) feedRequests.push(request.url()); });
  await page.goto("/replays");
  await expect(page).toHaveURL(/\/companion$/);
  await expect(page.getByRole("heading", { name: "Companion", exact: true })).toBeVisible();
  await expect(page.getByLabel("Replay-Token")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  const response = await page.request.get("/downloads/bronze-brawl-companion.zip");
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 2).toString()).toBe("PK");
  const unauthorized = await page.request.get("/api/replays");
  expect(unauthorized.status()).toBe(404);
  expect(feedRequests).toEqual([]);
});

test("two tabs join different games in the same browser context", async ({ context, page }) => {
  const create = async () => {
    const response = await page.request.get("/api/runGame", { params: { punishmentAmount: 3, rewardAmount: 5 } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const first = await create();
  const second = await create();
  expect(first.gameCode).toMatch(/^[A-Z]{4}$/);
  expect(second.gameCode).not.toBe(first.gameCode);
  const other = await context.newPage();
  try {
    await page.goto(`/name/${first.gameCode}`);
    await page.getByLabel("What is your name?").fill("Audit Alice");
    await other.goto(`/name/${second.gameCode}`);
    await other.getByLabel("What is your name?").fill("Audit Bob");
    await other.evaluate(id => localStorage.setItem("GameID", id), String(second.gameId));
    for (const [tab, game] of [[page, first], [other, second]]) {
      const response = tab.waitForResponse(response => response.url().endsWith("/api/createPlayer") && response.request().method() === "POST");
      await tab.getByRole("button", { name: "START", exact: true }).click();
      expect((await (await response).json()).game).toBe(game.gameId);
      await expect(tab).toHaveURL(/\/team$/);
      const active = await tab.evaluate(() => JSON.parse(sessionStorage.getItem("bb:active")));
      expect(active).toMatchObject({ gameId: game.gameId, gameCode: game.gameCode });
    }
  } finally { await other.close(); }
});

test("two isolated players complete the secured gameflow and recover after failure/reload", async ({ browser, page }) => {
  const errors = [];
  const watch = async tab => {
    tab.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await tab.route(/^https:\/\/(static\.bigbrain\.gg|ddragon\.leagueoflegends\.com)\//, route => route.abort());
  };
  await watch(page);
  await page.goto("/");
  const inputs = page.locator("form").filter({ has: page.getByRole("button", { name: "CREATE", exact: true }) }).getByRole("textbox");
  await inputs.nth(0).fill("7");
  await inputs.nth(1).fill("9");
  await page.getByRole("button", { name: "CREATE", exact: true }).click();
  const invite = page.locator('a[href*="/name/"]');
  await expect(invite).toBeVisible();
  const url = await invite.getAttribute("href");
  const host = await page.evaluate(() => {
    const { gameId } = JSON.parse(sessionStorage.getItem("bb:active"));
    return { gameId, token: sessionStorage.getItem(`bb:host:${gameId}`) };
  });
  const events = [{ EventID: 0, EventName: "GameStart", EventTime: 0 }];
  await page.goto('/companion');
  await page.getByRole('button', { name: 'Neuen Verbindungscode erstellen' }).click();
  const code = await page.getByLabel('Verbindungscode').inputValue();
  const connection = JSON.parse(Buffer.from(code.slice(4), 'base64url').toString());
  expect(connection.gameId).toBe(host.gameId);
  expect(connection.token).not.toBe(host.token);
  const heartbeat = await page.request.post('/api/companion/heartbeat', {
    headers: { 'X-Companion-Token': connection.token }, data: { gameId: host.gameId, availability: 'waiting' },
  });
  expect(heartbeat.ok()).toBe(true);
  await expect(page.getByTestId('live-feed-status')).toContainText('verbunden – warte auf LoL');
  const upload = async (gameTime = 20) => {
    const response = await page.request.post("/api/companion/input", {
      headers: { "X-Companion-Token": connection.token },
      data: { gameId: host.gameId, input: { allPlayers: roster, events: { Events: events }, gameData: { gameTime, mapNumber: 11 } } },
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  await upload();
  await expect(page.getByTestId('live-feed-status')).toContainText('Live-Daten kommen direkt');
  // The host page is not the transport. Simulated companion posts continue
  // through the independent request client while no host app is open.
  await page.goto('about:blank');
  const blueContext = await browser.newContext();
  const redContext = await browser.newContext();
  try {
    const blue = await blueContext.newPage();
    const red = await redContext.newPage();
    for (const tab of [blue, red]) {
      await watch(tab);
      await tab.goto(url);
      await tab.getByLabel("What is your name?").fill("Audit Alex");
      await tab.getByRole("button", { name: "START", exact: true }).click();
      await expect(tab).toHaveURL(/\/team$/);
      await expect(tab.getByRole("button", { name: "READY" })).toBeDisabled();
    }
    await blue.locator("section").filter({ has: blue.getByText("Team Blue", { exact: true }) }).getByRole("button", { name: "Join" }).click();
    await red.locator("section").filter({ has: red.getByText("Team Red", { exact: true }) }).getByRole("button", { name: "Join" }).click();
    for (const tab of [blue, red]) {
      await expect(tab.getByRole("button", { name: "READY" })).toBeEnabled();
      await tab.getByRole("button", { name: "READY" }).click();
    }
    await blue.getByRole("img", { name: "Ahri", exact: true }).click();
    await red.getByRole("img", { name: "Garen", exact: true }).click();
    await expect(blue).toHaveURL(/\/status$/);
    await expect(red).toHaveURL(/\/status$/);
    events.push(kill(1));
    await upload();
    await upload(); // JSONB replay through HTTP must not duplicate consequences.
    await expect(blue.getByText("1/0/0", { exact: true })).toBeVisible();
    await expect(red.getByRole('button', { name: '7 sips remaining. Tap to subtract one.' })).toBeVisible();
    await blue.route("**/api/Status?*", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"synthetic transient failure"}' }), { times: 1 });
    await expect(blue.getByRole("alert")).toContainText("synthetic transient failure");
    await expect(blue.getByRole("alert")).toHaveCount(0);
    await blue.getByRole('button', { name: 'Kills chest, 1 available' }).click();
    await blue.getByRole('button', { name: 'Open', exact: true }).click();
    await blue.getByRole('button', { name: '9 Assign sips' }).click();
    await blue.getByRole('button', { name: /Audit Alex Garen/ }).click();
    await blue.getByRole('button', { name: 'Confirm', exact: true }).click();
    await blue.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(blue.getByRole('button', { name: 'Kills chest, 0 available' })).toBeDisabled();
    for (let remaining = 16; remaining > 0; remaining--) {
      const counter = red.getByRole('button', { name: `${remaining} sips remaining. Tap to subtract one.` });
      await expect(counter).toBeEnabled();
      await counter.click();
    }
    await expect(red.getByRole('button', { name: '0 sips remaining. Tap to subtract one.' })).toBeDisabled();
    events.push(kill(2));
    await upload();
    await expect(blue).toHaveURL(/\/status$/);
    await expect(blue.getByText("3:00", { exact: true })).toBeVisible();
    await upload(200);
    await expect(blue).toHaveURL(/\/champion$/);
    await blue.getByRole("img", { name: "Lux", exact: true }).click();
    await expect(blue).toHaveURL(/\/status$/);
    await expect(blue.getByText("3:00", { exact: true })).toBeVisible();
    await blue.reload();
    await expect(blue.getByText("0/0/2", { exact: true })).toBeVisible();
    events.push(kill(3, "Turret_T200_L0_P3"));
    await upload(200);
    events.push({ EventID: 4, EventName: "GameEnd", EventTime: 200 });
    await upload(200);
    await upload(200);
    await expect(blue.getByRole("status")).toHaveText("Game ended");
    await expect(red.getByRole("status")).toHaveText("Game ended");
    expect(errors).toEqual([]);
  } finally {
    await blueContext.close();
    await redContext.close();
  }
});
