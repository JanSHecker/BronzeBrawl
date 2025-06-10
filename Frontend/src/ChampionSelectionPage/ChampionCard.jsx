import axios from "axios";
import { useNavigate } from "react-router-dom";
import processChampionName from "../nameAdjuster";
import { BACKEND_PORT , GAME_VERSION_KEY} from "../constants";
import { useState } from "react";

const ChampionCard = ({ champion }) => {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  // console.log(champion.championName);

  const name = processChampionName(champion.championName);

  const handleChampionSelection = async () => {
    const body = {
      player: localStorage.getItem("playerId"),
      champion: champion.championId,
      counter: localStorage.getItem("defaultRotationCounter"),
    };
    await axios.post(
      localStorage.getItem("baseURL") + BACKEND_PORT + "chooseChampion",
      body
    );
    localStorage.setItem("activeChampionId", champion.championId);
    localStorage.setItem("activeChampionName", name);
    localStorage.setItem("changeAllowed", false);
    navigate("/status");
  };

  const championUrl = `https://static.bigbrain.gg/assets/lol/riot_static/${localStorage.getItem(GAME_VERSION_KEY)}/img/champion/${name}.png`;
  const placeholderUrl = '../Champion_Placeholder.png';
  const imageStyle = {
    filter: champion.player !== null ? "grayscale(100%)" : "none",
  };

  const handleImageError = () => {
    setImgError(true);
  };

  return (
    <button
      className="flex flex-column justify-center w-1/4 m-1"
      onClick={handleChampionSelection}
      disabled={champion.player !== null}
    >
      <div className="relative">
        <img 
          src={imgError ? placeholderUrl : championUrl} 
          onError={handleImageError}
          alt={champion.name} 
          style={imageStyle} 
        />
        {imgError && (
          <div className="absolute top-0 right-0 bg-red-500 text-white text-xs px-1 rounded">!</div>
        )}
      </div>
    </button>
  );
};

export default ChampionCard;
