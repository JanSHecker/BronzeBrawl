import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getPlayerId } from "../api";
import { useAction } from "../useRequest";
import processChampionName from "../nameAdjuster";
import { GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import placeholder from "../Champion_Placeholder.png";

const ChampionCard = ({ champion, ended, excluded }) => {
  const navigate = useNavigate();
  const { run, loading, error } = useAction();
  const [imgError, setImgError] = useState(false);
  const name = processChampionName(champion.championName);
  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  return <div className="w-1/4 m-1">
    <button className="champion-card-button flex flex-col justify-center w-full" disabled={Boolean(champion.player) || loading || ended || excluded} onClick={() => run(async () => {
      await api.post("chooseChampion", { player: Number(getPlayerId()), champion: champion.championId });
      localStorage.setItem("activeChampionId", champion.championId);
      localStorage.setItem("activeChampionName", name);
      navigate("/status");
    })}>
      <img src={imgError ? placeholder : `https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${name}.png`} onError={() => setImgError(true)} alt={champion.championName} />
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
};
export default ChampionCard;
