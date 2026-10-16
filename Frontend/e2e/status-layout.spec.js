import { test, expect } from '@playwright/test';

for (const ended of [false, true]) {
  test(`solo chests and punishments can be resolved ${ended ? 'after game end' : 'during the game'}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const chest = { rewardId: 7, chestType: 'epic', amount: 2, distributed: false, openedAt: null };
    const punishment = { punishmentId: 8, amount: 1, remainingAmount: 1, unit: 'sips', recieved: false };
    const status = { player: { playerName: 'Solo' }, team: { teamId: 1, teamName: 0 },
      champion: ended ? null : { championId: 1, championName: 'Ahri' },
      gameState: ended ? 'ended' : 'live', feedStale: false, kda: [0, 0, 0],
      rotationRemainingSeconds: ended ? null : 180, rotationAvailable: false,
      rewards: [chest], punishments: [punishment], recipients: [], enemyTeam: [] };
    await page.addInitScript(() => {
      sessionStorage.setItem('bb:active', JSON.stringify({ gameId: 1, playerId: 1 }));
      sessionStorage.setItem('bb:player:1:1', 'a'.repeat(64));
    });
    await page.route('**/api/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const request = route.request().postDataJSON();
      if (name === 'openChest') {
        chest.openedAt = new Date().toISOString();
        chest.choices = [{ id: 'split', name: 'Split', mode: 'split', amounts: { sips: 1 }, perTarget: true, minTargets: 2, maxTargets: 2 }];
      } else if (name === 'chooseReward') {
        chest.distribution = { choiceId: 'split', remaining: { sips: 2, shots: 0, chugs: 0 }, targets: {}, version: 0 };
      } else if (name === 'distributeReward') {
        expect(request).toEqual({ id: 7, recipientId: 'dummy', unit: 'sips', expectedVersion: chest.distribution.version });
        chest.distribution.remaining.sips--;
        chest.distribution.version++;
        chest.distribution.targets = { dummy: { sips: chest.distribution.version, shots: 0, chugs: 0 } };
        chest.distribution.lastResult = { dummy: true, assigned: { sips: 1 } };
        chest.distributed = chest.distribution.remaining.sips === 0;
      } else if (name === 'consumePunishment') {
        expect(request).toEqual({ id: 8, expectedRemaining: 1 });
        punishment.remainingAmount = 0;
        punishment.recieved = true;
      }
      await route.fulfill({ json: name === 'Status' ? status : chest });
    });
    await page.goto('/status');
    await page.getByRole('button', { name: '1 sips remaining. Tap to subtract one.' }).click();
    await expect(page.getByRole('button', { name: '0 sips remaining. Tap to subtract one.' })).toBeDisabled();
    await page.getByRole('button', { name: 'Epic chest, 1 available' }).click();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await page.getByRole('button', { name: 'Assign to dummy' }).click();
    await expect(page.getByText('Distribute sips · 1 remaining')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Epic chest, 1 available' }).click();
    await page.getByRole('button', { name: 'Assign to dummy' }).click();
    await expect(page.getByText('Complete', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Epic chest, 0 available' })).toBeDisabled();
    await expect(page).toHaveURL(/\/status$/);
  });
}

for (const [width, height] of [[320, 480], [320, 568], [360, 640], [390, 844]]) {
  test(`compact status and popup interactions at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const chest = { rewardId: 7, amount: 2, chestType: 'epic', distributed: false, openedAt: null, choices: null };
    const punishment = { punishmentId: 8, amount: 2, remainingAmount: 2, unit: 'sips', recieved: false };
    const status = {
      player: { playerName: 'Alex' }, champion: { championId: 1, championName: 'Yasuo' },
      team: { teamId: 1, teamName: 0 }, rotationRemainingSeconds: 138, rotationAvailable: false,
      gameState: 'live', feedStale: false, kda: [8, 5, 12],
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
        chest.choices = [{ id: 'marked', name: 'Marked', mode: 'single', amounts: { sips: 2, shots: 0, chugs: 0 } }, { id: 'shield', name: 'Shield', mode: 'self', amounts: {}, shieldPoints: 2 }];
      } else if (name === 'chooseReward') {
        chest.distribution = { choiceId: 'marked', remaining: { sips: 2, shots: 0, chugs: 0 }, targets: {}, version: 0, outcome: 'success' };
      } else if (name === 'distributeReward') {
        chest.distribution.remaining.sips--;
        chest.distribution.version++;
        chest.distribution.targets = { 2: { sips: chest.distribution.version, shots: 0, chugs: 0 } };
        chest.distributed = chest.distribution.remaining.sips === 0;
      }
      else if (name === 'consumePunishment') {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ id: 8, expectedRemaining: punishment.remainingAmount });
        punishment.remainingAmount--;
        punishment.recieved = punishment.remainingAmount === 0;
      }
      await route.fulfill({ json: name === 'Status' ? status : ['openChest', 'chooseReward', 'distributeReward'].includes(name) ? chest : {} });
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
    await page.getByRole('button', { name: 'Epic chest, 1 available' }).click();
    const popup = page.getByRole('dialog');
    await expect(popup).toBeVisible();
    const rect = await popup.boundingBox();
    expect(Math.abs(rect.y + rect.height / 2 - height / 2)).toBeLessThan(2);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByRole('button', { name: 'Close chest' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Epic chest, 1 available' }).click();
    await page.getByRole('button', { name: 'Marked', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Give 1 sips to Sam. Shield 0/10.' }).click();
    await page.getByRole('button', { name: 'Give 1 sips to Sam. Shield 0/10.' }).click();
    await expect(page.getByText('Complete', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Epic chest, 0 available' })).toBeDisabled();
    await fits();
    expect(errors).toEqual([]);
  });
}
