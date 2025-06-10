import { useEffect, useState } from "react";

import processChampionName from "../nameAdjuster";
import axios from "axios";
import { BACKEND_PORT, DISTRIBUTED_PUNISHMENT, REWARD_KEY, GAME_VERSION_KEY } from "../constants";

const DistributionCard = ({ champion, rewardStack, hasRewards }) => {
  console.log('DistributionCard component rendering with champion:', champion);
  const [loading, setLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const name = processChampionName(champion.championName);
  const championUrl = `https://static.bigbrain.gg/assets/lol/riot_static/${localStorage.getItem(GAME_VERSION_KEY)}/img/champion/${name}.png`;
  // if the image is not found use placeholder image
  const placeholderUrl = '../Champion_Placeholder.png';
  
  console.log('Trying to load champion image:', championUrl);
  console.log('Placeholder path:', placeholderUrl);
  console.log('Current imgError state:', imgError);

  const handleImageError = () => {
    console.log('Image failed to load, switching to placeholder');
    setImgError(true);
  };

  const handleDistribution = async () => {
    console.log(localStorage.getItem("playerId"));
    setLoading(true);
    console.log(champion);
    await axios.post(
      localStorage.getItem("baseURL") + BACKEND_PORT + "confirmReward",
      {
        id: rewardStack[0].rewardId,
        punishment: {
          distributor: parseInt(localStorage.getItem("playerId")),
          punishmentType: DISTRIBUTED_PUNISHMENT,
          amount: localStorage.getItem(REWARD_KEY),
          recipient: champion.player,
        },
      }
    );
    setLoading(false);
  };
  const imageStyle = {
    filter:
      champion.player === null || !hasRewards ? "grayscale(100%)" : "none",
  };
  useEffect(() => {});
  return (
    <div className="flex flex-col w-1/6 m-1">
      <button
        onClick={handleDistribution}
        disabled={champion.player === null || !hasRewards || loading}
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
        <div className="text-xs">
          {champion.player?.playerName || "No Player"}
        </div>
      </button>
    </div>
  );
};
export default DistributionCard;
