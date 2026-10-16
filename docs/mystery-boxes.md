# Mystery-box foundation

## Earning rules

Progress belongs to the BronzeBrawl player, not the selected champion. Champion
rotation never clears progress or inventory. Each completed milestone creates
one persistent chest and resets only that milestone's progress.

| Category | Milestone | Chest | Recipients |
| --- | --- | --- | --- |
| Kills | 1 champion kill | Standard | Player controlling the killer |
| Assists | 2 champion assists | Support | Player controlling the assister |
| Revenge | 3 deaths, including environment deaths | Revenge | Player controlling the victim |
| Turret | 1 destroyed turret | Turret | Every joined player on the attacking team |
| Grubs / Herald / Dragon | 1 objective event | Epic | Every joined player on the killer's team |
| Baron / Elder | 1 objective event | Legendary | Every joined player on the killer's team |

Team rewards include players who joined a team but have not selected a champion.
Unassigned players, opponents, and players joining after ingestion receive no
retroactive objective rewards. Event replay cannot duplicate progress or chests.
Grubs are counted per reported event (`HordeKill` / `VoidGrubKill`), not per camp.
Only the final `TurretKilled` event counts, not the supplementary `FirstBrick`.
Elder uses `DragonKill` with `DragonType: Elder`; other dragons use the epic group.
Objective attribution uses the killer's roster team. For minion turret last hits,
the destroyed turret's `T1`/`T100` or `T2`/`T200` identifier determines the opposing
team. An unresolvable objective team fails ingestion atomically instead of guessing.

The supported objective event names must still be checked against a current live
client session, especially grubs. Synthetic tests do not prove live API coverage.

## Lifecycle and content boundary

Chests reuse persisted rewards. Migration maps existing rewards to standard
chests without discarding their amounts, ownership, or consumed status.
`POST /openChest` accepts `{ id }` with the player's capability. It persists the
offer once; reopening, polling, reloads, and service restarts do not reroll it.
`POST /confirmReward` accepts `{ id, choiceId, punishment: { recipient: { playerId } } }`.
The server validates the saved choice, owner, game, opposing team, and one-time
consumption under the existing game transaction lock.

There is deliberately **one initial choice**: the existing configured reward
amount, assigned as sips to an opponent. No new content catalog, rarity rules,
random odds, split payouts, or type-specific effects are introduced. The popup
renders a list of saved choices so later content is not coupled to its layout.
Shots and chugs have counters and persistence support, but no new effects that
generate them are invented in this branch.

## Punishments

Punishments retain their original `amount` and separately store `remainingAmount`
and `unit` (`sips`, `shots`, `chugs`). A tap submits
`POST /consumePunishment` with `{ id, expectedRemaining }`, decrementing one unit.
Stale/replayed requests conflict instead of consuming another unit. The original
full-confirm endpoint remains for old clients. No countdown or reward uses taps
as an earning trigger, avoiding punishment/revenge loops.

Rotation is outside this branch's scope. Its existing component, configuration,
server rules, and database fields are not changed here. The timer implementation
already on `main` must not be duplicated in this feature.

## Validation

Before starting an upgraded backend, build and apply the reviewed migration:

```text
cd Backend
npm run build
npm run migration:run
npm run test:unit
```

Use only a dedicated disposable PostgreSQL database for migration/integration tests:
set `NODE_ENV=test` and `TEST_DATABASE_URL`, then run `npm run migration:run` twice
and `npm run test:integration`. The integration suite includes independent-service
objective rewards, persisted offers, and partial punishment consumption.

```text
cd Frontend
npm test
npm run build
npm run test:status
```

`test:status` uses synthetic HTTP fixtures, starts only Vite, and needs a Playwright
browser (`npx playwright install chromium`, or set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`). It checks 320×480 through 390×844 layouts,
square portraits, six chests in one row, centered dialogs, reload recovery, and
single-unit punishment taps. `npm run test:e2e` additionally needs the disposable
PostgreSQL database and built backend to exercise the real HTTP gameflow.
