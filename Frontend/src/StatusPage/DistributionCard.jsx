import { useState } from "react";
import processChampionName from "../nameAdjuster";
import api from "../api";
import { useAction } from "../useRequest";
import { GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import placeholder from "../Champion_Placeholder.png";

export const distributeReward = (rewardId, playerId) => api.post("confirmReward", { id: rewardId, punishment: { recipient: { playerId } } });
const DistributionCard = ({ champion, rewardStack = [], hasRewards, onSuccess, disabled, onClick }) => {
  const { run, loading, error } = useAction();
  const [imgError, setImgError] = useState(false);
  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  const name = processChampionName(champion.championName);
  return <div className="flex flex-col w-1/6 m-1">
    <button disabled={!champion.player || !hasRewards || loading || disabled} onClick={onClick || (() => run(async () => {
      await distributeReward(rewardStack[0].rewardId, champion.player.playerId);
      await onSuccess?.();
    }))}>
      <img src={imgError ? placeholder : `https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${name}.png`}
        onError={() => setImgError(true)} alt={champion.championName} />
      <span className="text-xs">{champion.player?.playerName || "No Player"}</span>
    </button>
    {error && <p role="alert">{error}</p>}
  </div>;
};
export default DistributionCard;
