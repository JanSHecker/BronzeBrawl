import { test, expect } from '@playwright/test';

for (const [width, height] of [[320, 480], [320, 568], [360, 640], [390, 844]]) {
  test(`compact status and popup interactions at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const chest = { rewardId: 7, amount: 2, chestType: 'epic', distributed: false, openedAt: null, choices: null };
    const punishment = { punishmentId: 8, amount: 2, remainingAmount: 2, unit: 'sips', recieved: false };
    const status = {
      player: { playerName: 'Alex' }, champion: { championId: 1, championName: 'Yasuo' },
      team: { teamId: 1, teamName: 0 }, rotationMode: 'Kills',
      gameState: 'live', feedStale: false, counter: [3, 3], kda: [8, 5, 12],
      rewards: [chest], punishments: [punishment],
      enemyTeam: [{ championId: 2, championName: 'Garen', player: { playerId: 2, playerName: 'Sam' } }],
    };
    await page.addInitScript(() => {
      sessionStorage.setItem('bb:active', JSON.stringify({ gameId: 1, playerId: 1 }));
      sessionStorage.setItem('bb:player:1:1', 'a'.repeat(64));
    });
    await page.route('**/api/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      if (name === 'openChest') {
        chest.openedAt = new Date().toISOString();
        chest.choices = [{ id: 'assign', effect: 'assign', amount: 2, unit: 'sips' }];
      } else if (name === 'confirmReward') chest.distributed = true;
      else if (name === 'consumePunishment') {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ id: 8, expectedRemaining: punishment.remainingAmount });
        punishment.remainingAmount--;
        punishment.recieved = punishment.remainingAmount === 0;
      }
      await route.fulfill({ json: name === 'Status' ? status : name === 'openChest' ? chest : {} });
    });
    await page.goto('/status');
    await expect(page.getByText('8/5/12', { exact: true })).toBeVisible();
    const fits = async () => {
      expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width, height });
    };
    await fits();
    const portrait = await page.getByRole('img', { name: 'Yasuo' }).boundingBox();
    expect(portrait.width).toBe(portrait.height);
    const chestPositions = await page.locator('.status-chest').evaluateAll(items => items.map(item => item.getBoundingClientRect().y));
    expect(new Set(chestPositions).size).toBe(1);
    await expect(page.getByRole('progressbar')).toHaveCount(6);
    await page.getByRole('button', { name: '2 sips remaining. Tap to subtract one.' }).click();
    await expect(page.getByRole('button', { name: '1 sips remaining. Tap to subtract one.' })).toBeEnabled();
    await page.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' }).click();
    const popup = page.getByRole('dialog');
    await expect(popup).toBeVisible();
    const rect = await popup.boundingBox();
    expect(Math.abs(rect.y + rect.height / 2 - height / 2)).toBeLessThan(2);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('button', { name: 'Close chest' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' }).click();
    await page.getByRole('button', { name: '2 Assign sips' }).click();
    await page.getByRole('button', { name: 'Sam Garen' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 0 available' })).toBeDisabled();
    await fits();
    expect(errors).toEqual([]);
  });
}
