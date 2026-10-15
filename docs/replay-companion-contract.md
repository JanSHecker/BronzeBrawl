# Replay + Live Companion v1 — integration contract

## Scope

One Windows-oriented Python 3.11+ companion (stdlib-only), providing the existing localhost:3002 health/lol-data proxy and independent background feed submission. The companion obtains replay candidates/downloads via the logged-in local League Client API, caches actual .rofl files and uploads completed files to the backend. No client/RSO credentials leave the PC. The server stores replay files durably and scores matches from Riot Match-V5 details/timeline; never accept scores supplied by the companion. Existing game feed capability/idempotency semantics remain unchanged.

The public route `/replays` is a protected operational dashboard (token entered in browser session only), not a public catalogue with result spoilers. Missing/expired Riot key leaves real files saved with explicit unanalysed/failed status, never fabricated scores.

## Backend API (relative to /api)

All replay API calls require `X-Replay-Token` matching server env `REPLAY_ADMIN_TOKEN` (constant-time comparison, fail closed if unset). No token in URLs. IDs strictly match allowed Riot platform + positive numeric game ID (e.g. EUW1_123). JSON errors use Nest message.

- `GET /replays` returns `{items: ReplayItem[], riotConfigured: boolean}`. Optional `patch=16.20` and `sort=overall|balance|carry|momentum`. Null scores sort last.
- `PUT /replays/:matchId/file` raw application/octet-stream, `X-Replay-Version: 16.20.123.456`. Stream bounded file (max 150 MiB), validate replay signature/header, store atomically under REPLAY_STORAGE_DIR. Returns ReplayItem. Idempotent same bytes; reject mismatched duplicate rather than overwrite/reserved identity. New item status pending. Analysis triggered asynchronously outside upload response (and restart-resumed bounded worker).
- `GET /replays/:matchId/file` binary streamed response with file SHA256 available in item. Do not expose filesystem paths.
- `POST /replays/:matchId/analyze` queues analysis/retry and returns ReplayItem (pending). Requests coalesce. Riot errors sanitized and persisted. Timeout, rate limit/backoff, no unhandled promise rejection.
- `DELETE /replays/:matchId` removes unreserved item and file; conflict for reserved.
- `POST /replays/reserve` JSON `{gameId: positive integer, gameVersion: full version, sortBy?: overall|balance|carry|momentum}` returns `{item: ReplayItem}`. Atomically choose current matching major.minor patch, ready analysis, nonreserved; repeated same game id idempotent, no API/download at selection. Conflict when no suitable replay. Explicit reservations are managed by authenticated host/operator, not automatic unrelated live-game assignment.
- `POST /replays/:matchId/release` JSON `{gameId}` removes reservation only when matching. Keeps consumed/reused semantics explicit in docs.

ReplayItem:
```
{
 matchId, gameVersion, patch, sizeBytes, sha256, createdAt,
 analysisStatus: 'pending'|'ready'|'failed', analysisError: string|null,
 scores: null | {
   version: 1, balance: number, carry: number, momentum: number|null,
   overall: number, metrics: object
 },
 reservedGameId: number|null
}
```
Scores are clamped 0–100. Higher balance = closer teams (kill and time-weighted gold parity). Higher carry = stronger kill concentration/player dominance (not necessarily closer match). Higher momentum = meaningful gold swings/lead changes/comeback recovery (deadband prevents zero-noise inflation). Missing timeline => momentum null and explicit partial metrics, no invented gold values. Include duration, total/team/player kill spread, carry player/team identity without player PUUIDs, gold swing/lead-change metrics, formula/version. Final totals must not hide a stomp; transparent default overall weighting, duration/kill-density as context. Non-Summoner's-Rift/nonvalid 2x5 rosters rejected for scoring. Server fetches match IDs against fixed allowlisted Riot region hosts, with Riot key only in headers.

## Companion integration

Backend URL default `https://bronze-brawl.janhec.de/api`. Pool auth token is distinct from per-game `X-Game-Token`. The latter sends `{gameId, input}` to `POST /sendLoLInput` every ~3s while feed enabled, without an open browser tab; serialize requests, bounded backoff, halt/report terminal 401/403/409 errors rather than relabel or replay events. Keep legacy `/health` and `/lol-data` on loopback port 3002. Avoid concurrent browser relay/direct feeding; dashboard must indicate mode.

Local app has trusted loopback-only management UI for server settings, game pairing, local LoL connection, discovery/download, saved replay list, cached server files, playback and status. Secrets are never returned by status/config APIs or logged. Management writes require unpredictable per-process token and origin/Host validation. Only approved production/local origins may read legacy proxy. No arbitrary shell commands, path injection or remote TLS disable. Local self-signed LoL certificate exception only on fixed loopback addresses.

Discovery uses current account history, current patch and bounded candidate/request counts. Background refill polls pool and obtains candidates without blocking feeding. Downloads must wait for actual local completion and validate file before upload. Use readonly local replay metadata/current patch to prevent old files counted as playable. Historical ROFL1 and current ROFL2 support must be explicit; unsupported headers fail honestly. Starting a replay via local client does not prove replay liveclientdata availability: show clear unavailable status when no game data API is provided, never synthesize events.

## Delivery / verification

Backend Jest regression suite, frontend Vitest/lint/build, companion unittest with localhost fake transports and real HTTP routes plus no-LoL offline behavior. Verify upload/list/scoring failure/reservation/auth/duplicate/download with isolated real file fixture; avoid production test replays or invented ranked matches. Build downloadable source ZIP with Windows start script and clear Python requirement; optional CI Windows PyInstaller build, not claim a tested Windows .exe without real build output. Public live UI and API smoke tests and regression gameflow, with scoped cleanup and durable Docker volume. Update deployment docs/project overview.
