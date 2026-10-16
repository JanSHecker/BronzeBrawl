import { test, expect } from '@playwright/test';
import { catalog, labels, fixtureDatabase, setupRewardGame, seedReward, enterGame, Player, Reward, Punishment } from './reward-fixtures';

let database;
test.beforeAll(async () => { database = await fixtureDatabase(); });
test.afterAll(async () => { await database?.destroy(); });

for (const pool of ['standard', 'support', 'revenge', 'turret', 'epic', 'legendary', 'pentakill']) {
  for (const entry of catalog.pools[pool === 'support' ? 'standard' : pool]) {
    test(`${pool}: ${entry.name} resolves through the real mobile UI`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const context = await setupRewardGame(database);
      const { reward, choice } = await seedReward(database, context, pool, entry.id, entry.successChance !== undefined ? { successChance: 1 } : {});
      await enterGame(page, context);
      await page.getByRole('button', { name: `${labels[pool]} chest, 1 available` }).click();
      const chosen = page.waitForResponse(response => response.url().endsWith('/api/chooseReward'));
      await page.getByRole('button', { name: entry.name, exact: true }).click();
      const response = await chosen;
      expect(response.ok(), await response.text()).toBe(true);
      let result = await response.json();
      const status = await context.service.status(context.owner.playerId, context.owner.playerToken);
      if (!status.champion) {
        await expect(page).toHaveURL(/\/champion$/);
        await expect(page.getByRole('button', { name: 'Ahri', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Lux', exact: true }).click();
        await expect(page).toHaveURL(/\/status$/);
        if (!result.distributed) await page.getByRole('button', { name: `${labels[pool]} chest, 1 available` }).click();
      }
      let taps = 0;
      while (!result.distributed) {
        expect(await page.getByRole('button', { name: 'Confirm', exact: true }).count()).toBe(0);
        const delivered = page.waitForResponse(response => response.url().endsWith('/api/distributeReward'));
        await page.locator('.status-target:not(:disabled)').first().click();
        const response = await delivered;
        expect(response.ok(), await response.text()).toBe(true);
        result = await response.json();
        expect(++taps).toBeLessThan(100);
      }
      const persisted = await database.getRepository(Reward).findOneBy({ rewardId: reward.rewardId });
      expect(persisted.distributed).toBe(true);
      expect(persisted.distribution.remaining).toEqual({ sips: 0, shots: 0, chugs: 0 });
      const opponents = await Promise.all(context.opponents.map(player => context.service.status(player.playerId, player.playerToken)));
      for (const unit of ['sips', 'shots', 'chugs']) {
        const expected = (choice.amounts[unit] || 0) * (choice.mode === 'enemy_team' ? context.opponents.length : choice.perTarget ? choice.minTargets : 1) + (choice.randomBonus[unit] || 0);
        expect(opponents.reduce((sum, player) => sum + player.punishmentTotals[unit], 0)).toBe(expected);
      }
      const owner = await context.service.status(context.owner.playerId, context.owner.playerToken);
      expect(owner.player.shield).toBe(choice.shieldPoints || 0);
      expect(owner.rotationRemainingSeconds).toBe(entry.forceSwitch ? 180 : 180 + (entry.timeSeconds || 0));
      expect(owner.punishmentTotals).toEqual(choice.selfAmounts);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test('opening saves two choices, reload never rerolls, and revenge offers small versus risky', async ({ page }) => {
  const context = await setupRewardGame(database);
  const { reward } = await seedReward(database, context, 'revenge', 'parting-gift', {}, false);
  await enterGame(page, context);
  await page.getByRole('button', { name: 'Revenge chest, 1 available' }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.status-choice')).toHaveCount(2);
  await expect(page.getByText('Small reward', { exact: true })).toBeVisible();
  await expect(page.getByText('Big risk', { exact: true })).toBeVisible();
  const first = (await database.getRepository(Reward).findOneBy({ rewardId: reward.rewardId })).choices;
  await page.reload();
  await page.getByRole('button', { name: 'Revenge chest, 1 available' }).click();
  await expect(page.locator('.status-choice')).toHaveCount(2);
  expect((await database.getRepository(Reward).findOneBy({ rewardId: reward.rewardId })).choices).toEqual(first);
});

test('mixed rewards distribute sips then shots then chugs, survive reload, and break ALL shields', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 480 });
  const context = await setupRewardGame(database);
  await database.getRepository(Player).update(context.opponents[0].playerId, { shield: 100 });
  const { reward } = await seedReward(database, context, 'legendary', 'kings-decree', { amounts: { sips: 2, shots: 1, chugs: 1 } });
  await enterGame(page, context);
  await page.getByRole('button', { name: 'Baron / Elder chest, 1 available' }).click();
  await page.getByRole('button', { name: 'King’s Decree', exact: true }).click();
  const target = page.getByRole('button', { name: 'Give 1 sips to Garen. Shield 100.' });
  await expect(target.locator('.status-shield-badge')).toHaveText('100');
  await expect(page.getByText('Breaks target’s entire shield', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile-shield-before.png') });
  await target.click();
  await expect(page.getByRole('button', { name: 'Give 1 sips to Garen. Shield 0.' })).toBeEnabled();
  expect((await context.service.status(context.opponents[0].playerId, context.opponents[0].playerToken)).punishmentTotals.sips).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Baron / Elder chest, 1 available' }).click();
  await expect(page.getByText('Distribute sips · 1 remaining')).toBeVisible();
  for (const unit of ['sips', 'shots', 'chugs']) {
    await page.getByRole('button', { name: `Give 1 ${unit} to Garen. Shield 0.` }).click();
    if (unit !== 'chugs') await expect(page.getByText(`Distribute ${unit === 'sips' ? 'shots' : 'chugs'} · 1 remaining`)).toBeVisible();
  }
  await expect(page.getByText('Complete', { exact: true })).toBeVisible();
  const final = await context.service.status(context.opponents[0].playerId, context.opponents[0].playerToken);
  expect(final.punishmentTotals).toEqual({ sips: 2, shots: 1, chugs: 1 });
  expect((await database.getRepository(Reward).findOneBy({ rewardId: reward.rewardId })).distribution.version).toBe(4);
  await page.goto('/log');
  await expect(page.getByText(`Alex completed reward #${reward.rewardId}.`, { exact: true })).toBeVisible();
  await expect(page.getByText('Garen lost their entire shield.', { exact: true })).toBeVisible();
  await expect(page.getByText(/undefined/)).toHaveCount(0);
});

test('a lost tap response retries the same request without double assigning', async ({ page }) => {
  const context = await setupRewardGame(database);
  await seedReward(database, context, 'standard', 'marked');
  await enterGame(page, context);
  await page.getByRole('button', { name: 'Kills chest, 1 available' }).click();
  await page.getByRole('button', { name: 'Marked', exact: true }).click();
  await page.route('**/api/distributeReward', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  }, { times: 1 });
  await page.getByRole('button', { name: 'Give 1 sips to Garen. Shield 0.' }).click();
  await expect(page.getByRole('button', { name: 'Retry tap' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry tap' }).click();
  await expect(page.getByText('Distribute sips · 1 remaining')).toBeVisible();
  expect((await context.service.status(context.opponents[0].playerId, context.opponents[0].playerToken)).punishmentTotals.sips).toBe(1);
  await page.getByRole('button', { name: 'Give 1 sips to Garen. Shield 0.' }).click();
  await expect(page.getByText('Complete', { exact: true })).toBeVisible();
  expect((await context.service.status(context.opponents[0].playerId, context.opponents[0].playerToken)).punishmentTotals.sips).toBe(2);
});

test('rapid taps are queued, conserve the budget and require no confirmation', async ({ page }) => {
  const context = await setupRewardGame(database);
  const { reward } = await seedReward(database, context, 'standard', 'marked', { amounts: { sips: 3, shots: 0, chugs: 0 } });
  await enterGame(page, context);
  await page.getByRole('button', { name: 'Kills chest, 1 available' }).click();
  await page.getByRole('button', { name: 'Marked', exact: true }).click();
  await page.getByRole('button', { name: 'Give 1 sips to Garen. Shield 0.' }).evaluate(button => {
    button.click(); button.click(); button.click(); button.click();
  });
  await expect(page.getByText('Complete', { exact: true })).toBeVisible();
  expect((await context.service.status(context.opponents[0].playerId, context.opponents[0].playerToken)).punishmentTotals.sips).toBe(3);
  expect((await database.getRepository(Reward).findOneBy({ rewardId: reward.rewardId })).distribution.version).toBe(3);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
});

test('normal shields absorb new shots but never remove banked punishments', async ({ page }) => {
  const context = await setupRewardGame(database);
  const recipient = context.opponents[0];
  await database.getRepository(Player).update(recipient.playerId, { shield: 2 });
  const old = await database.getRepository(Punishment).save({ amount: 7, remainingAmount: 7, unit: 'sips', punishmentType: 0,
    recieved: false, player: { playerId: recipient.playerId } });
  await seedReward(database, context, 'epic', 'monster-trade');
  await enterGame(page, context);
  await page.getByRole('button', { name: 'Grubs / Herald / Dragon chest, 1 available' }).click();
  await page.getByRole('button', { name: 'Monster Trade', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Give 1 shots to Garen. Shield 2.' }).locator('.status-shield-badge')).toHaveText('2');
  await page.getByRole('button', { name: 'Give 1 shots to Garen. Shield 2.' }).click();
  await expect(page.getByText('Complete', { exact: true })).toBeVisible();
  expect((await database.getRepository(Punishment).findOneBy({ punishmentId: old.punishmentId })).remainingAmount).toBe(7);
  expect((await context.service.status(recipient.playerId, recipient.playerToken)).punishmentTotals).toEqual({ sips: 10, shots: 0, chugs: 0 });
});

test('revenge backfire is final, adds personal punishment and prolongs champion lifetime', async ({ page }) => {
  const context = await setupRewardGame(database);
  const { reward } = await seedReward(database, context, 'revenge', 'jackpot-or-disaster', { successChance: 0 });
  await enterGame(page, context);
  await page.getByRole('button', { name: 'Revenge chest, 1 available' }).click();
  await page.getByRole('button', { name: 'Jackpot or Disaster', exact: true }).click();
  await expect(page.getByText('Backfired', { exact: true })).toBeVisible();
  const status = await context.service.status(context.owner.playerId, context.owner.playerToken);
  expect(status.punishmentTotals.shots).toBe(1);
  expect(status.rotationRemainingSeconds).toBe(300);
  await page.reload();
  expect((await database.getRepository(Reward).findOneBy({ rewardId: reward.rewardId })).distribution.outcome).toBe('backfire');
  expect((await context.service.status(context.owner.playerId, context.owner.playerToken)).punishmentTotals.shots).toBe(1);
});

test('timer expiry forces release and different selection; immediate escape cannot retain champion', async ({ page }) => {
  const context = await setupRewardGame(database);
  await enterGame(page, context);
  await context.service.ingest({ gameId: context.game.gameId, input: context.feed(190) }, context.game.hostToken);
  await expect(page).toHaveURL(/\/champion$/);
  await expect(page.getByRole('button', { name: 'Ahri', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lux', exact: true }).click();
  await expect(page).toHaveURL(/\/status$/);
  await seedReward(database, context, 'revenge', 'escape-hatch');
  await page.getByRole('button', { name: 'Revenge chest, 1 available' }).click();
  await page.getByRole('button', { name: 'Escape Hatch', exact: true }).click();
  await expect(page).toHaveURL(/\/champion$/);
  await expect(page.getByRole('button', { name: 'Lux', exact: true })).toBeDisabled();
  const status = await context.service.status(context.owner.playerId, context.owner.playerToken);
  expect(status.champion).toBeNull();
  expect(status.punishmentTotals.sips).toBe(3);
});

for (const [difficulty, expected] of [['easy', { sips: 8, shots: 0, chugs: 0 }], ['baseline', { sips: 0, shots: 0, chugs: 1 }], ['hard', { sips: 8, shots: 0, chugs: 1 }], ['terror', { sips: 0, shots: 0, chugs: 2 }]]) {
  test(`${difficulty} preserves native chugs and rounds fractional sips up`, async ({ page }) => {
    const context = await setupRewardGame(database, difficulty);
    await seedReward(database, context, 'legendary', 'final-boss');
    await enterGame(page, context);
    await page.getByRole('button', { name: 'Baron / Elder chest, 1 available' }).click();
    await page.getByRole('button', { name: 'Final Boss', exact: true }).click();
    for (const unit of ['sips', 'shots', 'chugs']) {
      for (let count = 0; count < expected[unit]; count++) {
        const response = page.waitForResponse(response => response.url().endsWith('/api/distributeReward'));
        await page.getByRole('button', { name: `Give 1 ${unit} to Garen. Shield 0.` }).click();
        expect((await response).ok()).toBe(true);
      }
    }
    await expect(page.getByText('Complete', { exact: true })).toBeVisible();
    expect((await context.service.status(context.opponents[0].playerId, context.opponents[0].playerToken)).punishmentTotals).toEqual(expected);
  });
}
