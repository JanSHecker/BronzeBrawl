# Champion rotation

Champion rotation always uses a fixed base duration of 180 game seconds.
There is no kill/death rotation counter. The reward catalogue can explicitly
extend, shorten, or immediately end the owner's champion lifetime.

Each takeover sets the champion's persisted
`rotationEndsAtGameTime` to the latest accepted LoL game time plus 180 seconds.
The previous champion's deadline is cleared. Every new owner starts with a full
three minutes; champions do not share a team-wide or player-wide timer.

Status returns `rotationRemainingSeconds` and `rotationAvailable`. The backend
checks the same deadline when selecting a different champion. Expiry forcibly
releases ownership and requires selecting a different champion. The previous
champion cannot be immediately reselected, even after reload or restart.
"Switch now" rewards perform that release immediately. They are not permission
to keep the old champion until a convenient time.

Selection is still manual and exclusive: rewards never displace another player.
When every alternative is occupied, the player has no active champion and sees
a waiting state until another alternative is released. Single-champion teams
cannot rotate to a different champion. A later coordinated-swap policy would be
a separate game-rule decision.

The clock only advances with accepted LoL snapshots. Pauses, disconnected feeds,
browser reloads and backend restarts do not consume wall-clock time or reset the
deadline. Selection requires a known game clock, and GameEnd blocks rotation.
The displayed time updates with the feed rather than guessing between snapshots.

## Reward effects

Effects can add or subtract game seconds from the affected champion's persisted
deadline in a game-scoped transaction under the existing game lock. Both status
and selection read that value, so no duration formula or client counter needs
changing. Remaining time is clamped at zero, but not at 180 seconds, allowing
extensions beyond the base duration. A new takeover discards prior adjustments.
There is no public timer-editing endpoint: only an authenticated, committed,
server-persisted reward can adjust its owner's deadline. Time costs are applied
once, independently of drinking difficulty. See [unique rewards](unique-rewards.md).

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
