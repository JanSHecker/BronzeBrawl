import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getPlayerId } from "../api";
import { usePolling } from "../useRequest";
import { GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import processChampionName from "../nameAdjuster";
import placeholder from "../Champion_Placeholder.png";
import PunishmentDisplay from "./PunishmentDisplay";
import RewardDisplay from "./RewardDisplay";
import ChampionRotation from "./ChampionRotation";

const StatusPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const fetchStatus = async signal => {
    const { data } = await api.get("Status", { params: { playerId: Number(getPlayerId()) }, signal });
    if (signal?.aborted) return;
    if (!data || !Array.isArray(data.kda) || data.kda.length !== 3 || !Array.isArray(data.counter)
      || !Array.isArray(data.punishments) || !Array.isArray(data.rewards) || !Array.isArray(data.enemyTeam)) throw new Error("Invalid status response");
    if (!data.team) { navigate("/team", { replace: true }); return; }
    if (!data.champion) { navigate("/champion", { replace: true }); return; }
    setStatus(data);
    localStorage.setItem("teamId", data.team.teamId);
    localStorage.setItem("rotationMode", data.rotationMode);
    localStorage.setItem("activeChampionId", data.champion.championId);
    localStorage.setItem("activeChampionName", data.champion.championName);
  };
  const { error, retry, refresh } = usePolling(fetchStatus);
  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  return <div className="flex flex-col justify-start gap-2 min-h-screen">
    {error && <p role="alert">{error} <button onClick={retry}>Retry</button></p>}
    {!status ? <p>Loading game status…</p> : <>
      <p role="status">{status.gameState === "ended" ? "Game ended" : status.feedStale ? "Waiting for fresh game data…" : "Live"}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col text-center justify-center bg-slate-300 border border-black rounded p-1">
          <img src={`https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${processChampionName(status.champion.championName)}.png`}
            onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = placeholder; }} alt={status.champion.championName} />
          <h1>{status.kda.join("/")}</h1>
        </div>
        <ChampionRotation changeCounter={status.counter} rotationMode={status.rotationMode} navigate={navigate} ended={status.gameState === "ended"} />
      </div>
      <PunishmentDisplay punishmentStack={status.punishments.filter(item => !item.recieved)} onSuccess={retry} />
      <RewardDisplay rewardStack={status.rewards.filter(item => !item.distributed)} enemyTeam={status.enemyTeam} onRefresh={refresh} />
    </>}
  </div>;
};
export default StatusPage;
