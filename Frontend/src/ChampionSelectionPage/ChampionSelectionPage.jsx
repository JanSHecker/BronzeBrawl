import axios from "axios";
import ChampionCard from "./ChampionCard";
import { useEffect, useState } from "react";
import { BACKEND_PORT, GAME_ID_KEY } from "../constants";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "../api";

const ChampionSelectionPage = () => {
  const navigate = useNavigate();
  const [currentTeamChampions, setCurrentTeamChampions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (localStorage.getItem("changeAllowed") === "false") {
      navigate("/status");
      return undefined;
    }
    let mounted = true;
    let running = false;
    const fetchChampions = async () => {
      if (running) return;
      running = true;
      try {
        const response = await axios.get(
          `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}getAllChampions`,
          { timeout: 5000, params: { id: localStorage.getItem(GAME_ID_KEY) } },
        );
        if (!mounted) return;
        const data = response.data || {};
        const teamId = Number(localStorage.getItem("teamId"));
        const blue = Array.isArray(data.blue) ? data.blue : [];
        const red = Array.isArray(data.red) ? data.red : [];
        const all = [...blue, ...red];
        const current = all.filter((champion) => Number(champion.team?.teamId ?? champion.teamId) === teamId);
        const enemy = all.filter((champion) => Number(champion.team?.teamId ?? champion.teamId) !== teamId);
        setCurrentTeamChampions(current);
        localStorage.setItem("enemyTeam", JSON.stringify(enemy));
        const enemyTeamId = enemy[0]?.team?.teamId;
        if (enemyTeamId !== undefined) localStorage.setItem("enemyTeamId", String(enemyTeamId));
        setError(null);
      } catch (requestError) {
        if (mounted) setError(errorMessage(requestError, "Champion list update failed; retrying."));
      } finally {
        running = false;
      }
    };
    fetchChampions();
    const intervalId = window.setInterval(fetchChampions, 1000);
    return () => { mounted = false; window.clearInterval(intervalId); };
  }, [navigate]);

  return (
    <>
      {error && <div role="alert" className="m-2 text-red-700">{error}</div>}
      <img src="./PickYourChampion.png" alt="pick your champion" />
      <div className="flex justify-center flex-wrap h-min border border-black bg-slate-300 p-2">
        {currentTeamChampions.map((champion, index) => <ChampionCard key={champion.championId || index} champion={champion} />)}
      </div>
    </>
  );
};

export default ChampionSelectionPage;
