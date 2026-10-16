# Unique rewards

## Catalogue and configuration

`Backend/src/reward-catalog.json` is the declarative 1× catalogue: eight Standard,
eight Revenge (four small/four risky), eight Turret, eight Epic, eight Legendary.
Pentakill adds a separate single-entry pool with no random alternative: one chug
per enemy, break each enemy's full shield, and grant ten shield points to the owner
at baseline difficulty. Its quantities scale normally; allied shields are untouched.
Support uses Standard's pool and weights. Nobody delegates actions to another
player. There are no cleansing, reduction, transfer, or outstanding-debt rewards.

The catalogue specifies native `amounts` (`sips`, `shots`, `chugs`), targeting
mode, minimum/maximum recipients, optional per-recipient budgets, random bonuses,
shield grants, champion time changes, forced switching, odds and failure costs.
Reward-handling code does not embed per-reward quantities.

Backend environment settings (also shown in `.env.prod.example`):

```dotenv
SIPS_PER_SHOT=5
SIPS_PER_CHUG=15
DIFFICULTY_EASY=0.5
DIFFICULTY_BASELINE=1
DIFFICULTY_HARD=1.5
DIFFICULTY_TERROR=2
REWARD_CATALOG_OVERRIDES={}
```

Overrides are a JSON object keyed by reward ID. Example:

```json
{"marked":{"amounts":{"sips":3}},"encore":{"timeSeconds":90},"loaded-coin":{"successChance":0.4,"weight":2}}
```

Difficulty is selected when creating a game and persisted with it. The host's old
`rewardAmount` is retained for historical compatibility; catalogue quantities
come from the catalogue/overrides. Drinking quantities and shield grants scale
with difficulty; champion-time adjustments do not.

Whole shots/chugs remain their native units. Only fractional portions turn into
sips, and resulting fractional sips always round up. Sips never turn into shots
or chugs. At the default conversions, Easy's one-shot reward becomes three sips;
Hard's one-chug reward becomes one chug plus eight sips. Fixed-total splits scale
and round once before allocation; explicit per-target rewards scale each target's
budget. Offers that cannot satisfy their recipient count are excluded.

## Offers and commitment

Opening saves two distinct eligible choices once (Pentakill saves its one fixed offer). Revenge always presents one
small option and one risky option. Offers include their scaled quantities and
conversion snapshot, so server restarts, configuration changes, reloads, and
polling do not reroll or rescale an opened offer. Pools filter impossible target
counts and champion-time effects when the owner has no champion.

Choosing commits immediately, discards the alternative, applies personal costs,
shield grants and champion-time effects exactly once, and resolves any gamble.
Random outcomes are not revealed before commitment. Repeating the same choice
returns the saved result; submitting the other choice conflicts. Random-target,
scatter and even-team rewards resolve automatically. Shields never change old
punishments, and consuming punishments never earns chests.

## Shields

Player shields are persistent whole sip-equivalent points. A five-point shield
absorbs one shot at the default conversion, regardless of the incoming unit.
Only new punishments can consume shields, including death and personal reward
costs. Partial native-unit leftovers are represented as whole sips (rounded up).
Shield grants add points; there is no punishment banking mechanic.

Exactly one Epic (`dragons-breath`) and every Legendary have **Breaks Shields**.
Every positive assignment with that effect sets the recipient's **entire shield
to zero first**, then applies the full punishment. One sip destroys 100 shield
points and still assigns one sip. Each recipient of a multi-target reward is
handled independently. No damage-budget calculation limits shield destruction.

## Mobile distribution

After choosing a manual reward, tap large player tiles to distribute one active
unit per tap, in this order: **sips → shots → chugs**. Each tile visibly carries a
shield icon and its current numeric point count. Shield-breaking rewards are
clearly labelled. There is no distribution confirmation or review step; the
last accepted tap completes the reward. Players without a currently selected
champion can still receive punishments.

Rapid taps are queued in order with locally reserved budgets. Failed requests
retain the exact versioned request for retry; a lost response cannot duplicate
an assignment. Recipient constraints are enforced on both client and server.
Closing/reloading an unfinished distribution resumes its persisted remainder.

## API and storage

- `POST /openChest { id }`: persist and return the offer.
- `POST /chooseReward { id, choiceId }`: commit a saved choice once.
- `POST /distributeReward { id, recipientId, unit, expectedVersion }`: assign one
  unit, returning the updated reward, recipients/shields and latest feedback.
- All three require `X-Player-Token` and authorize the reward owner. Game mutations
  share the existing PostgreSQL advisory transaction lock across processes.
- Repeated older distribution versions return canonical progress without applying
  another punishment, including retries of the last tap. Future versions conflict.
- `confirmReward` remains only for historical foundation offers and cannot consume
  newly earned catalogue rewards.

Migration `UniqueRewards1792700000000` adds game difficulty, player shield and
previous-champion fields, and reward distribution JSON. It does not rewrite old
rewards or punishments. Apply reviewed migrations before deploying the backend.
Champion expiry releases ownership; immediate switches and time adjustments use
the existing game-clock deadline. See [rotation rules](champion-rotation.md).

## Verification

```text
cd Backend
npm run build
npm run migration:run
npm run test:unit
npm run test:integration

cd ../Frontend
npm test
npm run build
npm run test:status
npm run test:rewards
```

Migration/integration/real-browser commands require an explicitly supplied
**disposable** PostgreSQL `TEST_DATABASE_URL` with `NODE_ENV=test`. Browser tests
also require installed Playwright Chromium, or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing to a compatible executable.

Unit tests cover every catalogue entry at every difficulty, conversions, offer
persistence, recipient constraints, retries, transactional rollback, backfires,
time and forced rotation. Real browser tests exercise all 40 entries plus the
eight shared Support entries against HTTP/PostgreSQL, mixed-unit ordering,
shield breaking/absorption, rapid taps, lost-response recovery, reloads, forced
switches, and four difficulties. Compact-layout tests cover 320×480 to 390×844.
All fixtures are synthetic; these checks do not claim current live LoL API coverage.
