import axios from "axios";
import processChampionName from "../nameAdjuster";
import { BACKEND_PORT, GAME_VERSION_KEY } from "../constants";
import { errorMessage, playerAuth } from "../api";

export const distributeReward = async (rewardId, playerId) => {
  try {
    return await axios.post(
      `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}confirmReward`,
      { id: rewardId, punishment: { recipient: { playerId } } },
      { timeout: 5000, headers: playerAuth() },
    );
  } catch (requestError) {
    throw new Error(errorMessage(requestError, "Could not distribute the reward."));
  }
};

const DistributionCard = ({ champion, hasRewards, disabled, onClick }) => {
  const name = processChampionName(champion.championName);
  const championUrl = `https://static.bigbrain.gg/assets/lol/riot_static/${localStorage.getItem(GAME_VERSION_KEY)}/img/champion/${name}.png`;
  const imageStyle = { filter: champion.player === null || !hasRewards ? "grayscale(100%)" : "none" };
  const available = champion.player !== null && hasRewards && !disabled;
  return (
    <div className="flex flex-col w-1/6 m-1">
      <button onClick={onClick} disabled={!available} aria-label={champion.player?.playerName || "No Player"}>
        <img src={championUrl} alt={champion.championName || "champion"} style={imageStyle} />
        <div className="text-xs">{champion.player?.playerName || "No Player"}</div>
      </button>
    </div>
  );
};

export default DistributionCard;
