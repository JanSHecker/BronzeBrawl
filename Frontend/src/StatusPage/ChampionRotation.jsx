import { useEffect } from "react";
import { formatRotationTime, rotationAvailable as canRotate } from "../rotation";

const ChampionRotation = ({ rotationRemainingSeconds, rotationAvailable, navigate, ended, gameState }) => {
  const available = canRotate({ rotationRemainingSeconds, rotationAvailable, gameState });
  useEffect(() => {
    if (!ended && available) navigate("/champion", { replace: true });
  }, [available, ended, navigate]);
  return <div className="flex flex-col text-center justify-evenly border border-black rounded p-1 bg-slate-300">
    <h1 className="text-3xl">{formatRotationTime(rotationRemainingSeconds)}</h1>
    <h3 className="text-sm">Time until you have to pick a new Champion!</h3>
  </div>;
};
export default ChampionRotation;
