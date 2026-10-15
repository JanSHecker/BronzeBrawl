# BronzeBrawl reliability remediation plan

## Scope / execution
All audited problems and live blockers are authorized for remediation, GitHub tracking, regression tests and deployment. No secrets or `.env` files in commits/issues. Work branch `fix/gameflow-reliability`. Preserve existing UI, no marketing redesign. Deploy only after test/build/review gates.

## Workstreams and ownership
1. **Backend** owns `Backend/src/**` and backend test files. Implement supervised/awaited operations, game-scoped persistent ingestion, transactionally idempotent events/rewards, environmental kills, player/host capabilities, authoritative rules/status, settings and complete KDA. No filesystem feed polling/background runGame task; POST snapshots process synchronously under a game transaction lock. Game restart recovery is persisted, not process-local.
2. **Frontend** owns `Frontend/**`. Recoverable polling/actions, explicit IDs/team semantics, canonical status, response validation, valid links, capabilities sent in headers, scoped host feed uploads. Add component regressions. Preserve restrained existing UI.
3. **Deployment** owns `Backend/ormconfig.ts`, `Backend/package.json` and lock, migrations/DataSource outside src if needed, Docker/Compose, scripts, CI, docs. Explicit initial migration with migration ledger, schema/readiness checks, true JSON public API health, durable records. Host Nginx change handled by parent after backup.

## Shared REST contract
- `GET /runGame` remains creation compatibility; settings integer positive <=100, mode Kills/Deaths. Creates Game + blue/red teams immediately, returns `{gameId,hostToken,punishmentAmount,rewardAmount,rotationMode,defaultRotationCounter,state:'waiting_for_feed'}`. No feed needed to create lobby.
- `POST /sendLoLInput` body `{gameId,input}` header `X-Game-Token` hostToken. Input is explicit real LoL snapshot shape `{allPlayers:[{championName,riotIdGameName,riotIdTagLine?,summonerName?,riotId?,team:'ORDER'|'CHAOS'}],events:{Events:[...]},gameData?...}`. First valid feed creates champions. `Game` persists last snapshot/progress/state. Replays idempotent; roster/session change rejects controlled 409. Nonplayer tower/minion killers are environment kills, victim death still recorded, no champion reward.
- `POST /createPlayer` body `{playerName,game:gameId}` returns `{playerId,playerName,game,...,playerToken}`. Token only in create response; public roster/status/settings omit token/hash/hostTokenHash/lastInput.
- Player mutations use `X-Player-Token`; require ownership. Axios helper attaches current player token. `joinTeam`, `chooseChampion`, `confirmPunishment`, `confirmReward`, `deletePlayer` all await completion and respond controlled 400/403/404/409. Counter/budget values ignored from client and derived from Game.
- `chooseChampion` body `{player,champion}`. Validate same game/team/unoccupied, first selection or permitted rotation, don't allow same-champion counter reset. 409 on occupied champion. Team changes reject if already chosen champion, or explicitly keep consistent by clearing (backend choose one document).
- `getTeams?id=gameId` returns `{players:{blue:[...],red:[...]},teams:[{teamId,teamName:0|1,...}]}`. Color/opponent are explicit teamName values, never parity/index.
- `getAllChampions?id=gameId` returns `{blue:[...],red:[...]}`, champions include team and public player.
- `Status?playerId=id` requires `X-Player-Token`, derives selected champion/enemy from player. Return existing arrays + `gameState`, `feedStale`, `champion` object/null, `team`, `enemyTeamId`, `rotationMode`. Counter always `[n,n]`, KDA always `[k,d,a]`; missing player controlled 404. No champion selected -> champion null, counters zero; frontend routes to selection only when appropriate.
- `confirmReward` body `{id,punishment:{recipient:{playerId},...}}`; server derives amount/type/distributor from owned reward and authenticated player, checks opposing same-game recipient, consumes atomically. No open unauthenticated createPunishment/Dummygame mutation; remove or disable controlled 404.
- `health` readiness includes actual required tables/database; returns 503 on absent schema, 200 JSON on ready. Separate liveness optional. Main async errors controlled, do not swallow to fake success.

## Verification gates
- Write/run failing tests before fixes. Preserve RED output and GREEN summaries.
- Run all backend/frontend tests, builds, PostgreSQL integration and multitab browser smoke before deployment.
- Two-stage independent review: spec compliance then code quality/security; fix significant findings.
- Deploy explicit migrations before app starts, backup database/Nginx; never enable blanket production synchronize/dropSchema.
- Public live synthetic *test fixtures clearly labelled* exercise lobby/team/champion, combat/environment kill/assists, reward duplicate submission, rotation, feed replay, invalid auth/crossgame, reload/restart and polling recovery. Tests never represent generated fixtures as real LoL data.
- Clean only audit-labelled game records and dependencies, keep preexisting data.
- Publish commits/PR, CI gates, verified issue comments/closure, update projects.janhec.de generator.
