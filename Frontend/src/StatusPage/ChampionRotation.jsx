import { useEffect } from "react";

const ChampionRotation = ({ changeCounter, rotationMode, navigate, ended, gameState }) => {
  const counter = changeCounter[rotationMode === "Kills" ? 0 : 1];
  useEffect(() => {
    if (!ended && gameState !== "ended" && Number.isFinite(counter) && counter <= 0) navigate("/champion", { replace: true });
  }, [counter, ended, gameState, navigate]);
  return <div className="flex flex-col text-center justify-evenly border border-black rounded p-1 bg-slate-300">
    <h1 className="text-3xl">{counter}</h1>
    <h3 className="text-sm">{rotationMode} until you have to pick a new Champion!</h3>
  </div>;
};
export default ChampionRotation;
