import axios from "axios";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import processChampionName from "../nameAdjuster";
import { BACKEND_PORT, GAME_VERSION_KEY } from "../constants";
import { errorMessage, playerAuth } from "../api";

const ChampionCard = ({ champion }) => {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pendingRef = useRef(false);
  const name = processChampionName(champion.championName);

  const handleChampionSelection = async () => {
    if (pendingRef.current || champion.player !== null) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const playerId = Number(localStorage.getItem("playerId"));
      await axios.post(
        `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}chooseChampion`,
        { player: playerId, champion: champion.championId },
        { timeout: 5000, headers: playerAuth() },
      );
      localStorage.setItem("activeChampionId", String(champion.championId));
      localStorage.setItem("activeChampionName", name);
      localStorage.setItem("changeAllowed", "false");
      navigate("/status");
    } catch (requestError) {
      setError(errorMessage(requestError, "That champion is no longer available."));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const championUrl = `https://static.bigbrain.gg/assets/lol/riot_static/${localStorage.getItem(GAME_VERSION_KEY)}/img/champion/${name}.png`;
  return (
    <>
      <button className="flex flex-column justify-center w-1/4 m-1" onClick={handleChampionSelection} disabled={champion.player !== null || pending} aria-label={champion.championName}>
        <div className="relative"><img src={imgError ? "../Champion_Placeholder.png" : championUrl} onError={() => setImgError(true)} alt={champion.championName} style={{ filter: champion.player !== null ? "grayscale(100%)" : "none" }} />{imgError && <div className="absolute top-0 right-0 bg-red-500 text-white text-xs px-1 rounded">!</div>}</div>
      </button>
      {error && <div role="alert" className="text-red-700">{error}</div>}
    </>
  );
};

export default ChampionCard;
