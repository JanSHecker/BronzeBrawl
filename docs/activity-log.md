# Game activity log

Open **`/log`** in the browser tab where you created or joined a game. This is a
test page only; the log is not placed in the normal game screens. Hosts can also
open `/log?gameId=123` for a game whose host capability is saved in that browser.
No capability is passed in the URL.

## Setup

Deploy/run backend migrations before using the updated backend. For a local
backend configured with its database, run `npm run build` then
`npm run migration:run` from `Backend/`. Migration `ActivityLog1792500000000`
creates the history table and its game/cursor index. Readiness checks require it.

History starts when this feature is installed; existing activity is not backfilled.

## Reuse

- `Frontend/src/ActivityLog/useGameActivity.js` handles requests, live polling,
  deduplication, cancellation, and loading older entries.
- `Frontend/src/ActivityLog/EventLog.jsx` only renders structured entries. It can
  be embedded anywhere without the test page, routing, or data-fetching logic.
- `LogPage.jsx` supplies the current tab's game/session and the test-page controls.

## API and guarantees

`GET /gameActivity?gameId=123&limit=50` returns `{items, nextCursor}`.
Use `X-Game-Token` for a host, or `playerId` with `X-Player-Token` for a player in
that game. Ended-game history remains readable. Unauthenticated/cross-game reads
are forbidden. Responses never include tokens, hashes, or complete feed snapshots.

The default page is newest-first. `before=<activityId>` loads older entries.
`after=<activityId>` returns newer entries in ascending order for live catch-up.
These cursors are exclusive and cannot be combined. The default limit is 50,
maximum 100. A non-null `nextCursor` means another page exists in that direction.
The hook drains forward pages to avoid gaps during bursts of activity.

Entries contain `activityId`, `gameId`, `type`, `recordedAt`, nullable `gameTime`,
and structured `data`. They are ordered by append ID, not the LoL clock: a first
snapshot may contain older combat events. Game start means the first accepted
live snapshot. Player/team/champion changes, kills with assists (including
environment kills), earned/distributed rewards, assigned/confirmed punishments,
and game end are logged. Names and amounts are snapshots; later changes or a
lobby player's deletion do not rewrite history.

History is append-only in application code and written in the same transaction
as the corresponding action. Rollbacks cannot leave false entries. Existing game
locks and feed deduplication prevent replayed combat entries; unchanged team joins
and repeated punishment confirmations do not create additional entries. Deleting
a game cascades its log; no separate retention policy is added.

## Tests

- Backend: `npm run test:unit` (PostgreSQL integration cases require the existing
  opt-in `TEST_DATABASE_URL` test setup and applied migrations).
- Frontend: `npm test`.
- Browser smoke with a synthetic API, no database:
  `npx playwright test --config playwright.log.config.js` from `Frontend/`.
