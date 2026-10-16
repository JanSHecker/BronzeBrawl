const playerName = player => player?.playerName || "A player";
const championName = champion => champion?.championName || "a champion";
const teamName = team => team?.teamName === 0 ? "blue" : "red";

export function activityMessage({ type, data }) {
  switch (type) {
    case "game_created": return "Game created.";
    case "game_started": return "Game started receiving live data.";
    case "game_ended": return "Game ended.";
    case "player_joined": return `${playerName(data.player)} joined the game.`;
    case "player_left": return `${playerName(data.player)} left the game.`;
    case "team_changed": return `${playerName(data.player)} joined the ${teamName(data.team)} team.`;
    case "champion_selected": return `${playerName(data.player)} selected ${championName(data.champion)}.`;
    case "champion_rotated": return `${playerName(data.player)} rotated from ${championName(data.previousChampion)} to ${championName(data.champion)}.`;
    case "champion_expired": return `${playerName(data.player)} must switch away from ${championName(data.champion)}.`;
    case "champion_killed": {
      const assists = data.assisters?.length ? ` Assists: ${data.assisters.map(championName).join(", ")}.` : "";
      return `${data.killer ? championName(data.killer) : data.environment || "Environment"} killed ${championName(data.victim)}.${data.streakName ? ` ${data.streakName} (${data.killstreak}).` : ''}${assists}`;
    }
    case "multikill": return `${championName(data.killer)} scored a ${data.count === 5 ? 'Pentakill' : data.count === 4 ? 'Quadra Kill' : data.count === 3 ? 'Triple Kill' : 'Double Kill'}!`;
    case "objective_captured": return `${data.winningTeam === 0 ? 'Blue' : 'Red'} team secured ${data.objective}${data.grubScore ? ` (${data.grubScore[0]}–${data.grubScore[1]})` : ''}${data.source === 'match_timeline' ? ' [match timeline]' : ''}.`;
    case "reward_earned": return data.chestType ? `${playerName(data.player)} earned a ${data.chestType} chest.` : `${playerName(data.player)} earned a reward of ${data.amount}.`;
    case "reward_chosen": return `${playerName(data.player)} chose ${data.choiceId}${data.outcome === 'backfire' ? ' — it backfired' : ''}.`;
    case "reward_distributed": return data.amount === undefined ? `${playerName(data.player)} completed reward #${data.rewardId}.` : `${playerName(data.player)} distributed ${data.amount} to ${playerName(data.recipient)}.`;
    case "shield_changed": return data.broken ? `${playerName(data.player)} lost their entire shield.` : `${playerName(data.player)} now has ${data.shield} shield points.`;
    case "punishment_assigned": return `${playerName(data.player)} received a punishment of ${data.amount}${data.unit ? ` ${data.unit}` : ''}${data.reason === 'reward_cost' ? ' as a reward cost' : data.distributor ? ` from ${playerName(data.distributor)}` : " for a death"}.`;
    case "punishment_confirmed": return `${playerName(data.player)} confirmed a punishment of ${data.amount}.`;
    default: return `Game activity: ${type}.`;
  }
}

function gameClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Presentation only: no fetching, session storage, navigation or page placement.
export default function EventLog({ items = [] }) {
  if (!items.length) return <p>No activity yet.</p>;
  return <ol aria-label="Game activity" className="flex flex-col gap-2">
    {items.map(item => <li key={item.activityId} className="activity-event border rounded p-2">
      <p>{activityMessage(item)}</p>
      <div className="flex gap-3 text-sm text-muted">
        {item.gameTime !== null && <span aria-label="In-game time">{gameClock(item.gameTime)}</span>}
        <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time>
      </div>
    </li>)}
  </ol>;
}
