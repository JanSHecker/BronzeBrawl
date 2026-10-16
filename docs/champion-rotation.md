# Champion rotation

Champion rotation always uses a fixed base duration of 180 game seconds.
There is no mode selector or kill/death rotation setting. Kill rewards and
death penalties are unchanged; combat events never change rotation time.

Each takeover sets the champion's persisted
`rotationEndsAtGameTime` to the latest accepted LoL game time plus 180 seconds.
The previous champion's deadline is cleared. Every new owner starts with a full
three minutes; champions do not share a team-wide or player-wide timer.

Status returns `rotationRemainingSeconds` and `rotationAvailable`. The backend
checks the same deadline when selecting a different champion. Expiry opens the
existing manual selection flow; it does not automatically assign or release a
champion. Occupied champions remain unavailable (including full-team deadlocks,
which are intentionally not addressed yet).

The clock only advances with accepted LoL snapshots. Pauses, disconnected feeds,
browser reloads and backend restarts do not consume wall-clock time or reset the
deadline. Selection requires a known game clock, and GameEnd blocks rotation.
The displayed time updates with the feed rather than guessing between snapshots.

## Future effects

Effects can add or subtract game seconds from the affected champion's persisted
deadline in a game-scoped transaction under the existing game lock. Both status
and selection read that value, so no duration formula or client counter needs
changing. Remaining time is clamped at zero, but not at 180 seconds, allowing
extensions beyond the base duration. A new takeover discards prior adjustments.
There is intentionally no public timer-editing endpoint yet.

## Migration and API

Deploy both `ChampionRotationTimer1792300000000` and
`TimeOnlyRotation1792400000000` before starting the updated backend (production
startup runs pending migrations). Active legacy champion owners receive a new
three-minute timer from the last recorded game clock. Existing deadlines are
preserved. If a legacy game has no clock yet, the first timed snapshot starts
its missing timers.

Obsolete mode/counter columns remain in the database solely to preserve data
and rollback compatibility, but are not mapped, exposed, or used by the app.
New inserts use a database default for the legacy NOT NULL mode column.
`runGame` only needs punishment/reward amounts. Old mode/counter parameters are
ignored and cannot enable another rule. Status no longer returns `counter` or
`rotationMode`, and the obsolete `getChangeCounters` endpoint is removed.
