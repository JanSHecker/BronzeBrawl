import { useRef, useState } from "react";
import DistributionCard, { distributeReward } from "./DistributionCard";
import { errorMessage } from "../api";

const RewardDisplay = ({ rewardStack = [], enemyTeam = [], onRefresh, onSuccess }) => {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const reward = rewardStack[0];
  const distribute = async champion => {
    if (running.current || !reward || !champion.player) return;
    running.current = true; setPending(true); setError("");
    try {
      await distributeReward(reward.rewardId, champion.player.playerId);
      await (onRefresh || onSuccess)?.();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { running.current = false; setPending(false); }
  };
  return <div className="flex flex-col gap-2 bg-slate-300 h-auto items-center border border-black rounded p-1">
    <h1>{reward ? `Kill! Distribute ${reward.amount}!` : "You currently have no Rewards!"}</h1>
    {error && <p role="alert">{error}</p>}
    <div className="flex justify-evenly flex-wrap h-min">
      {enemyTeam.map(enemy => <DistributionCard key={enemy.championId} champion={enemy} hasRewards={Boolean(reward)} disabled={pending} onClick={() => distribute(enemy)} />)}
    </div>
    <p>{rewardStack.length} Remaining</p>
  </div>;
};
export default RewardDisplay;
