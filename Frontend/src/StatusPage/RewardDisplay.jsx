import { useEffect, useState } from "react";
import DistributionCard from "./DistributionCard";

const RewardDisplay = ({ rewardStack, enemyTeam }) => {
  // console.log(enemyTeam);
  const remainingRewards = rewardStack.length;
  let message;
  if (rewardStack[0] == null) {
    message = "You currently have no Rewards";
  } else {
    message = `Kill! Distribute ${rewardStack[0].amount}`;
  }
  return (
    <div className="flex flex-col gap-2 bg-slate-300 h-auto items-center border border-black rounded p-1">
      <h1 className="text-center text-sm">{message}!</h1>
      <div className="flex justify-evenly flex-wrap h-min">
        <EnemyTeam
          enemyTeam={enemyTeam}
          rewardStack={rewardStack}
          hasRewards={rewardStack.length > 0}
        />
      </div>
      <div className="self-end text-center border border-black p-3 m-1 bg-secondary">
        <h1 className="text-white text-xs">{remainingRewards}</h1>
        <h3 className="text-white text-xs">Remaining</h3>
      </div>
    </div>
  );
};
export default RewardDisplay;

const EnemyTeam = ({ enemyTeam, rewardStack, hasRewards }) => {
  console.log({ enemyTeam });
  return (
    <>
      {enemyTeam.map((enemy, index) => (
        <DistributionCard
          key={index}
          champion={enemy}
          rewardStack={rewardStack}
          hasRewards={hasRewards}
        />
      ))}
    </>
  );
};
