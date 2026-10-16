# Gameflow remediation verification

## Scope

PR #14 supplies the API-routing and explicit migration/readiness baseline (#1, #2).
PR #15 supplies the secured, awaited transactional backend (#3, #10, #11), and much
of the backend functionality below. The follow-up completes its frontend contract
and adds PostgreSQL and browser regression coverage.

| Issues | Resolution / regression coverage |
| --- | --- |
| #4 | Environment deaths record the victim without requiring a champion killer or inventing a reward. Unknown/ambiguous participants fail atomically. Punishment rendering is null-safe. |
| #5 | Host-scoped snapshots, roster/source validation and lifecycle/progress persist in PostgreSQL; no shared-file worker is used by the secured endpoints. A new service reads the same state. Host monitor sends the game ID and host capability. |
| #6 | Events and consequences commit together under a PostgreSQL game advisory lock. Replays use durable `(game, EventID)` identity, including EventID 0, and property-order-independent JSONB comparison. Injected transaction failure rolls back records before retry without changing champion timers. |
| #7 | Reward ownership, enemy/same-game validation and server-derived amounts are enforced in one locked transaction. Parallel submissions produce one penalty. Legacy public punishment creation is disabled. |
| #8 | Three-minute champion timers and champion selection share the game lock; selection is awaited; occupied/same-champion selections conflict. The frontend does not submit timing and restores state from authenticated Status. See [champion-rotation.md](champion-rotation.md). |
| #9 | Requests have timeouts. Polling schedules after completion, recovers from failures, and cancels on cleanup. Mutations release loading state in finally and display retryable failures. |
| #10 | Frontend membership uses playerId, colors use teamName and selections use explicit teamId, never names/parity/adjacency. |
| #12 | Configured amounts 7/9 and a complete K/D/A tuple, including persisted assists, are checked against real PostgreSQL. |
| #13 | Creation validates an internal positive integer gameId, four-letter gameCode and host capability before storing/showing an invite. Submission is guarded; cosmetic version-service failure does not block creation. Invite URLs use the origin and `/name/{code}`, ignoring query/hash. |
| #21 | Invitations and manual joins use a form-bound four-letter code, never shared localStorage. Settings lookup and player creation use the same code; the validated returned gameId scopes the tab's session/token. Component and same-browser-context two-tab regressions cover storage changes before submit. |

## Repeatable checks

1. `npm ci` in `Backend` and `Frontend`.
2. In `Backend`, run `npm run build` and `npm run test:unit`.
3. Against a **dedicated disposable PostgreSQL database**, set `NODE_ENV=test` and
   `TEST_DATABASE_URL`; run `npm run migration:run` (including a repeated run),
   then `npm run test:integration`.
4. In `Frontend`, run `npm test` and `npm run build`.
5. With the same test database environment, run `npx playwright install chromium`
   and `npm run test:e2e` in `Frontend`. An installed browser can be selected using
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The config starts local backend/frontend
   servers on ports 3107/5178. It never targets the public service.
6. At the repository root run `node --test scripts/deployment.test.cjs` and
   `git diff --check`.

For code-entry/UI regressions without PostgreSQL, run `npm run test:e2e:codes`
in `Frontend` (same browser installation/override as above). These tests exercise
the real UI and shared browser storage with a synthetic mocked API. The full
`test:e2e` suite also checks two tabs against the real backend/test database.

CI runs all of these gates, including the two-isolated-player browser test.
PostgreSQL integration checks create synthetic audit-labelled games in the
dedicated test database; dispose of that database afterward, not production data.

## Lifecycle / compatibility

- The first valid snapshot processes all supplied historical events. Rewards and
  punishments are assigned only to players owning those champions at ingestion.
- A final snapshot can be replayed after GameEnd; new events, joins or champion
  changes are rejected after the game ends. Outstanding rewards/punishments can
  still be settled.
- New player/host capabilities are kept in per-tab sessionStorage; host capabilities
  are keyed by game ID and never included in invite URLs. Legacy localStorage
  capabilities remain readable, but never override an active per-tab session.
  Pre-security sessions without a
  capability must create a new session; authorization never falls back to a name.
- Four-letter invitation codes and their API/deployment compatibility are documented
  in [game-codes.md](game-codes.md). Numeric invitation links no longer allow joining.
- Existing migration conflict detection remains fail-closed. Conflicting legacy
  event identities require operator review, never automatic record deletion.
- These are local/CI checks with synthetic fixtures, not proof of a live LoL
  session or production deployment. The existing main-branch workflow deploys
  automatically only after successful CI. Deployments are serialized and check
  out the tested revision before invoking its reviewed deployment script;
  superseded revisions are skipped and local operator changes are never reset.
- The public JSON health probe runs from the reviewed backend image with Linux
  host networking. The server needs Docker and curl, not a host Node.js install.

## Replay/companion merge verification

- The replay pool, protected `/replays` UI and downloadable companion are included.
  `REPLAY_ADMIN_TOKEN` and optional `RIOT_API_KEY` remain operator configuration;
  missing credentials fail closed, and opening the replay UI does not start a feed.
- Both regression suites remain enabled. Browser coverage checks the real replay
  route, companion ZIP, unauthenticated API rejection, and secured gameflow.
- `python -m unittest discover -s Companion/tests -v` exercises the companion;
  CI uses `python3` on Linux.
- Graceful Nest shutdown cancels Riot requests/rate-limit waits and releases the
  replay writer lock. File sync uses a writable handle; directory fsync remains
  enabled on POSIX and is omitted on Windows, where Node does not support it.
