# Four-letter game codes

Players enter the host's code and their name on `/`. Hosts can also share
`/name/KFRW`-style links. Codes are four random ASCII letters; entry is
case-insensitive and surrounding whitespace is ignored. Internal numeric game IDs
and the separate host/player capability tokens are unchanged.

## API

- `GET /runGame` adds `gameCode` to its existing creation response.
- `GET /getSettings?gameCode=KFRW` resolves an open invitation and returns settings,
  `gameCode` and internal `gameId`, but no host/player capabilities.
- `POST /createPlayer` takes `{playerName, gameCode}` (not `{playerName, game}`).
  It returns `{playerId, playerName, game: gameId, playerToken}` as before. The
  backend resolves the code and checks the game's state again inside its game lock.
- `GET /getInvitation?gameId=7` requires the host's `X-Game-Token` and returns
  `{gameId, gameCode}`. This recovers codes for pre-migration host sessions.
- Unknown codes return 404, malformed codes 400, ended games 409. Both settings
  lookup and player creation share a budget of 60 requests per minute per
  connection IP, per API process; excess requests return 429 and `Retry-After`.
  Forwarded client headers are not trusted. Behind a reverse proxy, clients can
  share this budget. A multi-instance deployment would need a shared limiter.

Four letters are a convenience for casual rounds, **not a strong secret**.
Possessing a code never grants host privileges or access to another player's
capability. Existing read-only numeric game endpoints are not made private by
this feature.

## Storage and deployment

- Apply the new `GameCodes1792200000000` migration before starting the updated
  backend (`npm run build`, then `npm run migration:run` with the intended database
  environment). Deploy frontend and backend together: numeric invitation links
  and the old join request shape are intentionally no longer accepted.
- The migration adds a unique, format-checked `gameCode` column and assigns codes
  to existing unfinished games. No game/player data is removed. Finished legacy
  games may retain a null code.
- Game creation serializes code allocation across PostgreSQL API processes, retries
  random collisions and is also protected by the database unique constraint.
  Codes remain reserved after a game ends, preventing old links from silently
  pointing at a later round. No joins are allowed after GameEnd.
- Before joining, the source of truth is the current form or URL, never a shared
  localStorage value. After joining, validated internal IDs and player tokens are
  stored in the tab's existing sessionStorage session. A host's code is retained
  there as well, so refreshing does not lose the invitation.

## Checks

- Backend: `npm run test:unit` (code allocation/collisions, normalization, invalid
  and ended games, HTTP contract, rate limiting, migration/readiness).
- Frontend: `npm test` (form isolation, validation, response checks, host recovery).
- Browser without PostgreSQL: `npm run test:e2e:codes` (real UI, synthetic API,
  two tabs in the **same** context, manual join and host refresh).
- Disposable PostgreSQL: apply migrations, then run `npm run test:integration` in
  Backend and `npm run test:e2e` in Frontend with the test database environment.
