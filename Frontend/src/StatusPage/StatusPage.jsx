import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getPlayerId } from "../api";
import { usePolling } from "../useRequest";
import { GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import processChampionName from "../nameAdjuster";
import placeholder from "../Champion_Placeholder.png";
import PunishmentCounters from './PunishmentCounters';
import ChestInventory from './ChestInventory';
import ChestProgress from './ChestProgress';
import StatusIcon from './StatusIcon';
import ChampionRotation from "./ChampionRotation";
import './status.css';

const StatusPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const fetchStatus = async signal => {
    const { data } = await api.get("Status", { params: { playerId: Number(getPlayerId()) }, signal });
    if (signal?.aborted) return;
    if (!data || !Array.isArray(data.kda) || data.kda.length !== 3
      || !Array.isArray(data.punishments) || !Array.isArray(data.rewards) || !Array.isArray(data.enemyTeam)) throw new Error("Invalid status response");
    if (!data.team) { navigate("/team", { replace: true }); return; }
    if (!data.champion) { navigate("/champion", { replace: true }); return; }
    setStatus(data);
    localStorage.setItem("teamId", data.team.teamId);
    localStorage.setItem("activeChampionId", data.champion.championId);
    localStorage.setItem("activeChampionName", data.champion.championName);
  };
  const { error, retry, refresh } = usePolling(fetchStatus);
  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  return <div className="game-status">
    <header className="status-header"><h1><StatusIcon name="kills" />BronzeBrawl</h1>
      {status && <p role="status" className="status-live">{status.gameState === 'ended' ? 'Game ended' : status.feedStale ? 'Waiting for data…' : 'Live'}</p>}
    </header>
    {error && <p className="status-poll-error" role="alert">{error} <button onClick={retry}>Retry</button></p>}
    {!status ? <p>Loading game status…</p> : <>
      <div className="status-match">
        <div className="status-panel status-player">
          <img src={`https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${processChampionName(status.champion.championName)}.png`}
            onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = placeholder; }} alt={status.champion.championName} />
          <div><p>{status.player?.playerName}</p><strong>{status.champion.championName}</strong><p className="status-kda" aria-label={`${status.kda[0]} kills, ${status.kda[1]} deaths, ${status.kda[2]} assists`}>{status.kda.join("/")}</p></div>
        </div>
        <ChampionRotation rotationRemainingSeconds={status.rotationRemainingSeconds} rotationAvailable={status.rotationAvailable}
          navigate={navigate} ended={status.gameState === "ended"} />
      </div>
      <PunishmentCounters punishments={status.punishments} onRefresh={refresh} />
      <ChestInventory rewards={status.rewards} enemyTeam={status.enemyTeam} onRefresh={refresh} />
      <ChestProgress progress={status.chestProgress} />
    </>}
  </div>;
};
export default StatusPage;
