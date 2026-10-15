import { useState } from "react";
import DistributionCard, { distributeReward } from "./DistributionCard";

const RewardDisplay = ({ rewardStack = [], enemyTeam = [], onRefresh }) => {
  const [pendingRewardId, setPendingRewardId] = useState(null);
  const [error, setError] = useState(null);
  const remainingRewards = rewardStack.length;
  const reward = rewardStack[0];
  const message = reward ? `Kill! Distribute ${reward.amount}!` : "You currently have no Rewards!";

  const handleDistribution = async (champion) => {
    if (!reward || pendingRewardId !== null || !champion.player?.playerId) return;
    setPendingRewardId(reward.rewardId);
    setError(null);
    try {
      await distributeReward(reward.rewardId, champion.player.playerId);
      if (onRefresh) await onRefresh();
    } catch (requestError) {
      setError(requestError?.message || "Could not distribute the reward.");
    } finally {
      setPendingRewardId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 bg-slate-300 h-auto items-center border border-black rounded p-1">
      <h1 className="text-center text-sm">{message}</h1>
      {error && <div role="alert" className="text-red-700">{error}</div>}
      <div className="flex justify-evenly flex-wrap h-min">
        {enemyTeam.map((enemy, index) => (
          <DistributionCard
            key={enemy.championId || index}
            champion={enemy}
            hasRewards={rewardStack.length > 0}
            disabled={pendingRewardId !== null}
            onClick={() => handleDistribution(enemy)}
          />
        ))}
      </div>
      <div className="self-end text-center border border-black p-3 m-1 bg-secondary"><h1 className="text-white text-xs">{remainingRewards}</h1><h3 className="text-white text-xs">Remaining</h3></div>
    </div>
  );
};

export default RewardDisplay;

import axios from "axios";
import { BACKEND_PORT } from "../constants";
import { errorMessage, playerAuth } from "../api";

const distribute = async (rewardId, playerId) => {
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

DistributionCard.distribute = distribute;
