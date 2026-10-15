import { useEffect } from "react";

const ChampionRotation = ({ changeCounter, rotationMode, navigate, gameState }) => {
  useEffect(() => {
    if (!Array.isArray(changeCounter) || changeCounter.length < 2 || !gameState || gameState === "ended") return;
    const index = rotationMode === "Kills" ? 0 : rotationMode === "Deaths" ? 1 : -1;
    if (index >= 0 && Number.isFinite(changeCounter[index]) && changeCounter[index] <= 0) {
      localStorage.setItem("changeAllowed", "championOnly");
      navigate("/champion");
    }
  }, [changeCounter, gameState, navigate, rotationMode]);

  if (rotationMode === "Deaths") {
    return (
      <div className="flex flex-col text-center justify-evenly bg-slate-300 border border-black p-1">
        <h1 className="text-5xl">{changeCounter[1] ?? 0}</h1>
        <div><h3>{rotationMode} until you have to</h3><h3>pick a new Champion!</h3></div>
      </div>
    );
  }
  return (
    <div className="flex flex-col text-center justify-evenly border border-black rounded p-1 bg-slate-300">
      <h1 className="text-3xl">{changeCounter[0] ?? 0}</h1>
      <div><h3 className="text-sm">{rotationMode || "Kills"} until you have to pick a new Champion!</h3></div>
    </div>
  );
};

export default ChampionRotation;
