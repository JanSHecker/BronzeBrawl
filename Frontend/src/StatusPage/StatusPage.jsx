import { useEffect, useRef, useState } from "react";
import axios from "axios";
import PunishmentDisplay from "./PunishmentDisplay";
import RewardDisplay from "./RewardDisplay";
import { BACKEND_PORT, GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import ChampionRotation from "./ChampionRotation";
import { useNavigate } from "react-router-dom";
import { errorMessage, playerAuth } from "../api";

const StatusPage = () => {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const [status, setStatus] = useState(null);
  const [pollError, setPollError] = useState(null);
  const requestRunningRef = useRef(false);
  const mountedRef = useRef(true);

  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  const championName = status?.champion?.championName || localStorage.getItem("activeChampionName");
  const imgURL = `https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${championName || "Unknown"}.png`;
  const punishmentStack = Array.isArray(status?.punishments) ? status.punishments : [];
  const rewardStack = Array.isArray(status?.rewards) ? status.rewards : [];
  const enemyTeam = Array.isArray(status?.enemyTeam) ? status.enemyTeam : [];
  const kda = Array.isArray(status?.kda) ? status.kda : [0, 0, 0];
  const changeCounter = Array.isArray(status?.counter) ? status.counter : [0, 0];
  const rotationMode = status?.rotationMode || localStorage.getItem("rotationMode");

  useEffect(() => {
    mountedRef.current = true;
    const fetchStatus = async () => {
      if (requestRunningRef.current || !mountedRef.current) return;
      requestRunningRef.current = true;
      try {
        const response = await axios.get(
          `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}Status`,
          {
            timeout: 5000,
            params: { playerId: Number(localStorage.getItem("playerId")) },
            headers: playerAuth(),
          },
        );
        if (!mountedRef.current) return;
        const next = response.data;
        if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error("Invalid status response.");
        setStatus(next);
        setPollError(null);
        if (next.champion) {
          localStorage.setItem("activeChampionId", String(next.champion.championId));
          localStorage.setItem("activeChampionName", next.champion.championName);
        }
        if (next.team?.teamId !== undefined) localStorage.setItem("teamId", String(next.team.teamId));
        if (next.enemyTeamId !== undefined) localStorage.setItem("enemyTeamId", String(next.enemyTeamId));
        if (next.rotationMode) localStorage.setItem("rotationMode", next.rotationMode);
      } catch (requestError) {
        if (mountedRef.current) setPollError(errorMessage(requestError, "Status update failed; retrying."));
      } finally {
        requestRunningRef.current = false;
      }
    };

    fetchStatus();
    const intervalId = window.setInterval(fetchStatus, 1000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const unfulfilledPunishments = punishmentStack.filter((punishment) => !punishment.recieved);
  const unfulfilledRewards = rewardStack.filter((reward) => !reward.distributed);

  return (
    <>
      {pollError && <div role="alert" className="m-2 text-red-700">{pollError}</div>}
      {status?.gameState === "ended" && <div role="status" className="m-2 text-gray-700">Match ended.</div>}
      {status?.feedStale && <div role="status" className="m-2 text-yellow-700">Game feed is stale; waiting for the next update.</div>}
      <div className="flex flex-col justify-start gap-2 min-h-screen">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col text-center justify-center bg-slate-300 border border-black rounded p-1">
            <div className="relative">
              <img src={imgError ? "../Champion_Placeholder.png" : imgURL} onError={() => setImgError(true)} alt="champion icon" className="m-1" />
              {imgError && <div className="absolute top-0 right-0 bg-red-500 text-white text-xs px-1 rounded">!</div>}
            </div>
            <h1 className="m-0.5 border border-black text-sm">{`${kda[0] ?? 0}/${kda[1] ?? 0}/${kda[2] ?? 0}`}</h1>
          </div>
          <ChampionRotation changeCounter={changeCounter} rotationMode={rotationMode} navigate={navigate} gameState={status?.gameState} />
        </div>
        <PunishmentDisplay punishmentStack={unfulfilledPunishments} />
        <RewardDisplay rewardStack={unfulfilledRewards} enemyTeam={enemyTeam} />
      </div>
    </>
  );
};

export default StatusPage;
