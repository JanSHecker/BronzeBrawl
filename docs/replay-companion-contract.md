# Companion direct-feed contract (v2)

## Responsibilities

- Python 3.11+ Companion: fetch real LoL Liveclient snapshots, send them directly
  to the deployed HTTPS API, manage local replay discovery/download/rankings.
- Backend: authorize each game feed, ingest snapshots transactionally and
  idempotently, persist heartbeat timestamps, expose host-only connection status.
- Website: create/revoke a restricted game connection and display backend status.
  It never reads localhost, relays game data, or handles replays.
- `/companion` replaces the old `/replays` and `/lolApi` pages (redirects).
  The legacy ReplayModule is not mounted. Existing stored files are not removed.

## Pairing

The authenticated host creates a connection code in the website. `BB1.` plus
base64url-encoded JSON `{backendUrl, gameId, token}` is a transport envelope, not
encryption. It contains a random 256-bit **feed-only capability**, never the host
token. The user pastes it at the Companion's `v` prompt (hidden input).

Only the SHA-256 token hash is stored server-side. Token checks are constant-time.
Minting a new code revokes the previous code; revocation is serialized with feed
ingestion by the same PostgreSQL game advisory lock. The capability cannot read
host status, mint more capabilities, modify settings, or perform player actions.
There is no shared/global destination game or unauthenticated global feed.

The Companion stores the restricted credential in the current user's local
`connection.json` so restarts reconnect automatically. Never log or publish this
file. The code is never put in URLs or browser storage. The HTTPS destination
comes from the actual website API base, avoiding public-domain redirect aliases.
Public TLS validation remains mandatory and authenticated requests never redirect.

## API (relative to `/api`, responses `Cache-Control: no-store`)

Host-only, `X-Game-Token`:

- `POST /companion/connect` `{gameId}` → `{gameId, token}` (rotates credential).
- `POST /companion/disconnect` `{gameId}` → `{ok:true}` (revokes credential).
- `GET /companion/status?gameId=…` → `{gameId, paired, connected, availability,
  lastSeenAt, lastInputAt, feedFresh, gameState, serverTime}`. Never returns tokens
  or full LoL data. `connected` expires after 15 seconds without a heartbeat or
  accepted input. `feedFresh` additionally requires recent accepted input and a
  `live` availability report; connectivity alone does not imply a running game.

Companion-only, `X-Companion-Token`:

- `POST /companion/heartbeat` `{gameId, availability:'waiting'|'live'|'conflict'}`
  → `{ok:true, gameId, serverTime}`.
- `POST /companion/input` `{gameId,input:<real Liveclient snapshot>}` → public game
  response. Uses the existing transactional ingest, roster/clock validation and
  event idempotency. The legacy host-authenticated `/sendLoLInput` endpoint remains
  compatible but the website never uses it as a relay.

### Snapshot size limit

The backend accepts JSON request bodies up to **4 MiB (4,194,304 bytes)**,
including the `{gameId,input}` envelope, on both snapshot endpoints (and other
JSON routes). This accommodates full Liveclient snapshots with event history
without allowing unbounded uploads. Larger bodies receive HTTP 413 before
controller/ingest processing; no partial snapshot is applied. Non-JSON parser
limits are unchanged. Both host-nginx examples set `client_max_body_size 4m`
for `/api/`; deployed HTTPS vhosts and any additional proxy must allow the same
size. Updating the backend container alone does not update host-nginx config.

## Sender and status

An independent worker fetches `https://127.0.0.1:2999/liveclientdata/allgamedata`,
sends a heartbeat, and posts the real snapshot every approximately three seconds.
No snapshot buffering/replaying on network retry; each retry fetches fresh data.
Even unchanged clocks are safe and submitted, preserving freshness during pauses.
Replay search/download/ranking never blocks this worker. The default terminal
mode does not start a localhost web server.

No LoL data is normal: heartbeat continues with `waiting`. Once LoL supplies data,
input resumes automatically. Transient failures use bounded backoff (up to 12s).
HTTP 413 is a size error, not a credential error: the sender stays enabled,
reports that the backend/proxy size limit must be checked, and retries with fresh
data using bounded backoff. It never truncates event history or advances its
saved session/last successful send for a rejected snapshot. A successful
heartbeat still counts as connected, but not as a successful input. Recovery
after correcting the limit or receiving a smaller snapshot needs no new code
or manual restart. The legacy host-token sender also retries size errors
(backoff up to 60s).
401/403 and other non-retryable client errors stop the sender and request a new
code. A changed source/clock or HTTP 409 reports `conflict` without relabeling
events or assigning another game's input. Both terminal and website distinguish
connection, missing LoL data, conflict, and lost connectivity. Closing the browser
does not affect sending; closing the Companion expires website connectivity in 15s.

The explicit `--web` switch retains the legacy local compatibility UI for
development only; it is not the production connection flow.

## Verification

Companion unittest: fresh/direct sends, unavailable LoL, restart recovery,
revocation, bounded retries, changed game, simultaneous replay work, secret safety.
Backend Jest: restricted credentials, cross-game rejection, token rotation,
heartbeat expiry, idempotent ingest, persisted connection across service restart.
HTTP regression tests cover event-history snapshots above 100 KiB, the 4 MiB
boundary, oversized/malformed requests, and unchanged authorization. Companion
tests cover input-only 413s, continuing heartbeats, and automatic recovery.
Frontend Vitest: backend-only polling, status transitions/recovery, host-session
switch cancellation, connection-code generation, revocation, old-route redirects.
Browser e2e uses synthetic API inputs on an isolated local test database only.
