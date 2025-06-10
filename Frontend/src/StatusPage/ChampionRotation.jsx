import React, { useEffect } from "react";

const ChampionRotation = ({ changeCounter, rotationMode, navigate }) => {
  useEffect(() => {
    handleChampionRotation(changeCounter, navigate);
  }, [changeCounter]);
  if (rotationMode === "Kills") {
    return (
      <div className="flex flex-col text-center justify-evenly border border-black rounded p-1 bg-slate-300">
        <h1 className="text-3xl">{changeCounter[0]}</h1>
        <div>
          <h3 className="text-sm">
            {rotationMode} until you have to pick a new Champion!
          </h3>
        </div>
      </div>
    );
  }
  if (rotationMode === "Deaths") {
    return (
      <div className="flex flex-col text-center justify-evenly bg-slate-300 border border-black p-1">
        <h1 className="text-5xl">{changeCounter[1]}</h1>
        <div>
          <h3>{rotationMode} until you have to</h3>
          <h3>pick a new Champion!</h3>
        </div>
      </div>
    );
  }
};

export default ChampionRotation;
const handleChampionRotation = (changeCounter, navigate) => {
  const rotationMode = localStorage.getItem("rotationMode");
  console.log(changeCounter);
  if (changeCounter === "∞") navigate("/");
  let i;
  if (rotationMode === "Kills") i = 0;
  if (rotationMode === "Deaths") i = 1;
  if (changeCounter[i] <= 0) {
    console.log({ navigating: true, changeCounter });
    localStorage.setItem("changeAllowed", "championOnly");
    navigate("/champion");
  }
};
