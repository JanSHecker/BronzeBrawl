import ChampionCard from "./ChampionCard";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getGameId, getPlayerId } from "../api";
import { usePolling } from "../useRequest";
import title from "../PickYourChampion.png";
import { rotationAvailable } from "../rotation";

const ChampionSelectionPage = () => {
  const [champions, setChampions] = useState([]);
  const [ended, setEnded] = useState(false);
  const navigate = useNavigate();
  const { error, retry } = usePolling(async signal => {
    const { data: status } = await api.get("Status", { params: { playerId: Number(getPlayerId()) }, signal });
    if (signal.aborted) return;
    if (!status.team) { navigate("/team", { replace: true }); return; }
    setEnded(status.gameState === "ended");
    if (status.champion && !rotationAvailable(status)) { navigate("/status", { replace: true }); return; }
    const { data } = await api.get("getAllChampions", { params: { id: getGameId() }, signal });
    if (signal.aborted) return;
    const own = status.team.teamName === 0 ? data.blue : data.red;
    if (!Array.isArray(own)) throw new Error("Invalid champion roster");
    setChampions(own);
  });
  return <>
    <img src={title} alt="pick your champion" />
    {error && <p role="alert">{error} <button onClick={retry}>Retry</button></p>}
    {champions.length === 0 && <p>Waiting for the host&apos;s game feed…</p>}
    <div className="flex justify-center flex-wrap h-min border border-black bg-slate-300 p-2">
      {champions.map(champion => <ChampionCard key={champion.championId} champion={champion} ended={ended} />)}
    </div>
  </>;
};
export default ChampionSelectionPage;
