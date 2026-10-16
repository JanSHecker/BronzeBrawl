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

After a rotation expires or a reward forces a switch, the player has **30 game
seconds** to choose a different champion. The selection screen displays a
server-owned countdown. On the first accepted feed update at or after the
deadline, the backend randomly assigns an unoccupied champion on the player's
team, excluding their previous champion. The new ownership gets a full 180 seconds.
Initial champion selection has no automatic-assignment timeout.

Selection remains exclusive: automatic assignments never displace another player.
If every alternative is occupied, the deadline stays expired and assignment is
retried on subsequent feeds until an eligible champion becomes available.
Single-champion teams cannot rotate to a different champion. Simultaneous
expirations release all champions before automatic assignments are considered.

The clock only advances with accepted LoL snapshots. Pauses, disconnected feeds,
browser reloads and backend restarts do not consume wall-clock time or reset the
deadline. Selection requires a known game clock, and GameEnd blocks rotation.
The displayed time updates with the feed rather than guessing between snapshots.
The 30-second selection deadline is persisted on the player, so reloads and
backend restarts cannot reset it. Natural expiry starts the grace period at the
champion's actual deadline, even when the next snapshot arrives late. Forced
switches start it at the latest accepted game time. Automatic assignments are
logged and run under the same game lock as manual selection and feed ingestion.

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

`ChampionAutoSelection1792900000000` adds the persisted selection deadline and
gives already-waiting rotated players 30 seconds from the last accepted game time.
Status exposes `championSelectionRemainingSeconds` (null when not selecting or
after GameEnd); clients do not submit or control this deadline.

Obsolete mode/counter columns remain in the database solely to preserve data
and rollback compatibility, but are not mapped, exposed, or used by the app.
New inserts use a database default for the legacy NOT NULL mode column.
`runGame` only needs punishment/reward amounts. Old mode/counter parameters are
ignored and cannot enable another rule. Status no longer returns `counter` or
`rotationMode`, and the obsolete `getChangeCounters` endpoint is removed.
