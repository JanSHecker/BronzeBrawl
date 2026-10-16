# Mystery-box foundation

## Earning rules

Progress belongs to the BronzeBrawl player, not the selected champion. Champion
rotation never clears progress or inventory. Each completed milestone creates
one persistent chest and resets only that milestone's progress.

| Category | Milestone | Chest | Recipients |
| --- | --- | --- | --- |
| Kills | Each champion kill | Standard on spree 1–2, Epic on 3–7, Legendary on 8+ | Player controlling the killer |
| Assists | 2 champion assists | Support | Player controlling the assister |
| Revenge | 3 deaths, including environment deaths | Revenge | Player controlling the victim |
| Turret | 1 destroyed turret | Normal | Every joined player on the attacking team |
| Grubs / Herald / Dragon | 1 Herald/Dragon, or majority of a completed three-grub group | Epic | Every joined player on the winning team |
| Baron / Elder | 1 objective event | Legendary | Every joined player on the killer's team |

Team rewards include players who joined a team but have not selected a champion.
Unassigned players, opponents, and players joining after ingestion receive no
retroactive objective rewards. Event replay cannot duplicate progress or chests.
Grubs (`HordeKill` / `VoidGrubKill`) are accumulated in groups of three. No chest
is issued until all three are dead; only the team with two or three kills wins.
The third grub's event triggers one Epic chest per joined winning teammate.
Only the final `TurretKilled` event counts, not the supplementary `FirstBrick`.
Elder uses `DragonKill` with `DragonType: Elder`; other dragons use the epic group.
Objective attribution uses the killer's roster team. For minion turret last hits,
the destroyed turret's `T1`/`T100` or `T2`/`T200` identifier determines the opposing
team. An unresolvable objective team fails ingestion atomically instead of guessing.

Kill sprees follow the LoL participant, including kills before a BronzeBrawl player
takes over. Credited champion deaths reset the spree; environment executions do not.
Each reported multikill milestone grants an additional chest: Double = Standard,
Triple = Epic, Quadra = Legendary, Penta = Pentakill. Bonuses accumulate for every
reached milestone and are separate from the kill's normal/upgraded chest.

Replay neutral objectives can come from a verified LCU match timeline, because
the Live Client API omits these events in some spectator/replay sessions. See
[replay timeline events](replay-timeline-events.md). Raw live captures stay unmodified.

## Lifecycle and content boundary

Chests reuse persisted rewards. Migration maps existing rewards to standard
chests without discarding their amounts, ownership, or consumed status.
`POST /openChest` accepts `{ id }` with the player's capability. It persists the
offer once; reopening, polling, reloads, and service restarts do not reroll it.
`POST /confirmReward` accepts `{ id, choiceId, punishment: { recipient: { playerId } } }`.
The server validates the saved choice, owner, game, opposing team, and one-time
consumption under the existing game transaction lock.

The foundation's original single assignment offer is retained only for historical
opened rewards. New chests use the [unique reward catalogue](unique-rewards.md):
eight entries per pool, two persisted offers, native-unit difficulty scaling,
shields, time effects, and guarded tap-to-distribute actions. Support chests share
the Standard pool. The old full-assignment endpoint cannot bypass catalogue choices.

Pentakill is a separate one-offer pool: break every enemy player's entire shield,
assign one chug to each enemy, and grant the owner ten shield points at baseline
difficulty. Drinking quantities and the grant scale normally; allied shields are
never broken. Choosing resolves the whole effect atomically.

Without opposing BronzeBrawl players, distributed rewards instead expose an
**Assign to dummy** sink, including random/team effects and Pentakill. No fake
players or punishments are created. Chests and punishments remain resolvable
after game end; champion-time effects no longer apply. See the
[settlement rules](unique-rewards.md#offers-and-commitment).

## Punishments

Punishments retain their original `amount` and separately store `remainingAmount`
and `unit` (`sips`, `shots`, `chugs`). A tap submits
`POST /consumePunishment` with `{ id, expectedRemaining }`, decrementing one unit.
Stale/replayed requests conflict instead of consuming another unit. The original
full-confirm endpoint remains for old clients. No countdown or reward uses taps
as an earning trigger, avoiding punishment/revenge loops.

Rotation uses the existing persisted deadline, now with forced release on expiry
and explicit catalogue adjustments. See [champion rotation](champion-rotation.md).

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
square portraits, rarity-labelled chests in one row, centered dialogs, reload
recovery, solo dummy assignments, post-game settlement, and single-unit punishment
taps. `npm run test:e2e` additionally needs the disposable
PostgreSQL database and built backend to exercise the real HTTP gameflow.
