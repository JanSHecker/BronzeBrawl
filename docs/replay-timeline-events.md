# Replay objective sources and combat chests

## Companion availability check

Replay rankings include an **Objectives** column. `ready` / `✓ N` means the
Companion obtained a complete, validated historical objective source; `unavailable`
means it could not, and `unchecked` means it has not yet been checked. This is
separate from gold-timeline validity: a timeline containing gold samples but no
event arrays is not an objective source.

The Companion loads the exact match summary and
`/lol-match-history/v1/game-timelines/<gameId>` through the local League Client.
It validates region/game ID, map, ten unique Riot IDs and team assignments,
timeline coverage, objective killers, dragon types, and available summary counters.
Supported `ELITE_MONSTER_KILL` types are `HORDE`, `DRAGON`, `RIFTHERALD`, and
`BARON_NASHOR`. Unknown monster types are not guessed or renamed.

Validated sources are cached locally in
`%LOCALAPPDATA%\BronzeBrawl\companion\timeline-sources\<matchId>.json`. They contain
Riot IDs, participant teams, objective events and kill anchors, not client tokens,
PUUIDs or HTTP headers. These files contain player identities: review before sharing.

Start the replay from the list after its check completes. The selected match is
remembered in `active-replay.json`. If a replay is launched externally, a unique
matching cached roster/team and compatible kill history can identify the source.
Ambiguous sources are rejected, never guessed. Selecting a replay with no source
is allowed with a warning, but neutral-objective rewards may then be incomplete.

## Delivery and safety

The feed worker performs no timeline network calls; ranking/launch preparation
does them separately. It verifies the live roster/team and available kill anchors,
then adds `input.replayTimeline = { matchId, events }` to the **outbound** snapshot.
Only objectives at or before the accepted LoL game clock are included. Raw fetch
recordings are unchanged. Pauses cannot reveal future events.

The backend uses one authoritative neutral-objective source for a game, ignoring
Live API copies when a timeline is selected. The match ID/source mode is pinned
by the first snapshot; changing it requires a new BronzeBrawl game. Timeline IDs
use a reserved integer namespace starting at 1,000,000,000, independent of Live
API EventIDs. Payload mismatches, duplicate source indices, future timestamps,
wrong killer teams, and changed sources are rejected. Events are merged by game
time before processing, including before `GameEnd`, under the existing game lock.
Retries/restarts do not duplicate rewards. Rewinding the replay still conflicts:
it must not rewind a BronzeBrawl game's already-applied consequences.

Objective log entries identify the source, winning team and completed grub score.
Three grub kills award just one team outcome, even on a 2–1 split; the losing
team receives nothing. The final grub triggers rewards for currently joined
winning teammates, including those without a champion.

Viego's temporary `championName`/`rawChampionName` changes are normalized using
his stable `rawSkinName` in both Companion and backend. Actual participant/team
changes, clock resets and non-Viego champion changes still fail source checks.

## Combat rewards

Spree counters are rebuilt from durable kill history, independently of the
current BronzeBrawl owner. Kills 1–2 earn Standard, 3–7 Epic, and 8+ Legendary.
An environment execution does not reset the spree; a credited champion death does.
Kills before takeover still count toward the LoL participant's spree.

Live `Multikill` events award cumulative extra milestone chests: 2 Standard,
3 Epic, 4 Legendary, 5 Pentakill. They must correspond to a captured kill in the
chain. Existing kill rewards are not counted again. Tier deduplication survives
service restarts, and the corresponding takedown stores its multikill count.

Pentakill opening offers only its fixed effect. Choosing applies difficulty-scaled
one-chug-per-enemy punishments and +10 owner shield (baseline), breaking only enemy
shields before assignment. Every joined enemy is included, even without a selected
champion. The whole action is transactional and idempotent; it never breaks allies'
shields or changes old punishments.

No new database columns are required; history/provenance uses existing JSON event
payloads and reward/chest fields. These rules are not a claim that every patch or
match has an available LCU timeline. Missing sources are explicitly reported.
