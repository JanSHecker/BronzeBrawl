import api from "../api";
import { useAction } from "../useRequest";
import { useNavigate } from "react-router-dom";
import processChampionName from "../nameAdjuster";
import { GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import placeholderUrl from "../Champion_Placeholder.png";
import { useState } from "react";

const ChampionCard = ({ champion, ended }) => {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const { run, loading, error } = useAction();
  // console.log(champion.championName);

  const name = processChampionName(champion.championName);

  const handleChampionSelection = async () => {
    await run(async () => {
    const body = {
      player: Number(localStorage.getItem("playerId")),
      champion: champion.championId,
    };
    await api.post(
      "chooseChampion",
      body
    );
    localStorage.setItem("activeChampionId", champion.championId);
    localStorage.setItem("activeChampionName", name);
    localStorage.setItem("changeAllowed", false);
    navigate("/status");
    });
  };

  const championUrl = `https://static.bigbrain.gg/assets/lol/riot_static/${localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION}/img/champion/${name}.png`;
  const imageStyle = {
    filter: champion.player !== null ? "grayscale(100%)" : "none",
  };

  const handleImageError = () => {
    setImgError(true);
  };

  return (
    <div className="w-1/4 m-1"><button
      className="flex flex-col justify-center w-full"
      onClick={handleChampionSelection}
      disabled={Boolean(champion.player) || loading || ended}
    >
      <div className="relative">
        <img 
          src={imgError ? placeholderUrl : championUrl} 
          onError={handleImageError}
          alt={champion.championName}
          style={imageStyle} 
        />
        {imgError && (
          <div className="absolute top-0 right-0 bg-red-500 text-white text-xs px-1 rounded">!</div>
        )}
      </div>
    </button>{error && <p role="alert">{error}</p>}</div>
  );
};

export default ChampionCard;
