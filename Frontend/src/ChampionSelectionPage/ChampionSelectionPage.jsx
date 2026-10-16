import ChampionCard from "./ChampionCard";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getGameId, getPlayerId } from "../api";
import { usePolling } from "../useRequest";
import title from "../PickYourChampion.png";
import SelectionTitle from "../components/SelectionTitle";
import { formatRotationTime, rotationAvailable } from "../rotation";

const ChampionSelectionPage = () => {
  const [champions, setChampions] = useState([]);
  const [ended, setEnded] = useState(false);
  const [previousChampionId, setPreviousChampionId] = useState(null);
  const [selectionRemainingSeconds, setSelectionRemainingSeconds] = useState(null);
  const navigate = useNavigate();
  const { error, retry } = usePolling(async signal => {
    const { data: status } = await api.get("Status", { params: { playerId: Number(getPlayerId()) }, signal });
    if (signal.aborted) return;
    if (!status.team) { navigate("/team", { replace: true }); return; }
    setEnded(status.gameState === "ended");
    setPreviousChampionId(status.player?.previousChampionId || null);
    setSelectionRemainingSeconds(status.championSelectionRemainingSeconds ?? null);
    if (status.champion && !rotationAvailable(status)) { navigate("/status", { replace: true }); return; }
    const { data } = await api.get("getAllChampions", { params: { id: getGameId() }, signal });
    if (signal.aborted) return;
    const own = status.team.teamName === 0 ? data.blue : data.red;
    if (!Array.isArray(own)) throw new Error("Invalid champion roster");
    setChampions(own);
  });
  return <>
    <SelectionTitle src={title} alt="pick your champion" />
    {error && <p role="alert">{error} <button onClick={retry}>Retry</button></p>}
    {champions.length === 0 && <p>Waiting for the host&apos;s game feed…</p>}
    {ended ? <p role="status">Game ended</p> : previousChampionId && <p role="status">Your champion time is over. Select a different champion.</p>}
    {!ended && Number.isFinite(selectionRemainingSeconds) && <p role="timer" aria-label="Automatic champion assignment countdown">
      {selectionRemainingSeconds > 0
        ? <>Automatic champion assignment in <strong>{formatRotationTime(selectionRemainingSeconds)}</strong> (game time).</>
        : 'Automatic assignment pending. Waiting for an available champion.'}
    </p>}
    {champions.length > 0 && !champions.some(champion => !champion.player && champion.championId !== previousChampionId) && <p>Waiting for another champion to become available.</p>}
    <div className="champion-grid flex justify-center flex-wrap h-min border p-2">
      {champions.map(champion => <ChampionCard key={champion.championId} champion={champion} ended={ended} excluded={champion.championId === previousChampionId} />)}
    </div>
  </>;
};
export default ChampionSelectionPage;
