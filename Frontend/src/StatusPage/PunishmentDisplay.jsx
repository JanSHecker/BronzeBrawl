import { useEffect, useState } from "react";
import { Button } from "react-daisyui";
import processChampionName from "../nameAdjuster";
import axios from "axios";
import { BACKEND_PORT } from "../constants";

const PunishmentDisplay = ({ punishmentStack }) => {
  const hourglassUrl = "item/3157";
  let urlEnd;
  let message;
  if (punishmentStack.length === 0) {
    urlEnd = hourglassUrl;
    message = `You haven't recieved any punishments.`;
  } else if (punishmentStack[0].punishmentType === 1) {
    urlEnd =
      "champion/" +
      processChampionName(punishmentStack[0].takedown.killer.championName);
    message = `You were Killed! Drink ${punishmentStack[0].amount}.`;
  } else if (punishmentStack[0].punishmentType === 2) {
    urlEnd = "item/3134";
    message = `You recieved a punishment from ${punishmentStack[0].distributor.playerName}. Drink ${punishmentStack[0].amount}!`;
  }
  const baseUrl =
    "https://static.bigbrain.gg/assets/lol/riot_static/13.23.1/img/";

  const imgURL = baseUrl + `${urlEnd}.png`;

  return (
    <div>
      <div className="flex flex-col bg-slate-300 gap-1 border rounded border-black p-1">
        <div className="text-center text-sm">{message}</div>
        <img
          src={imgURL}
          alt="champion icon"
          className="m-1 w-1/5 border border-black self-center"
        ></img>

        <PunishmentButton
          isActive={punishmentStack.length > 0}
          punishmentStack={punishmentStack}
        />
      </div>
    </div>
  );
};
export default PunishmentDisplay;

const PunishmentButton = ({ isActive, punishmentStack }) => {
  const remainingPunishments = punishmentStack.length;
  const handleDone = () => {
    axios.post(
      localStorage.getItem("baseURL") + BACKEND_PORT + "confirmPunishment",
      {
        id: punishmentStack[0].punishmentId,
      }
    );
  };
  if (isActive) {
    return (
      <div className="grid grid-cols-3 w-full">
        <div></div>
        <Button
          className="m-2 justify-self-center "
          color="primary"
          size="xm"
          onClick={handleDone}
        >
          Done
        </Button>
        <div className="justify-self-end text-center border border-black p-3 m-1 bg-secondary">
          <h1 className="text-white text-xs">{remainingPunishments}</h1>
          <h3 className="text-white text-xs">Remaining</h3>
        </div>
      </div>
    );
  } else
    return (
      <div className="grid grid-cols-5">
        <div></div>
        <div className="text-center text-sm col-span-3 ">
          Count yourself lucky!
        </div>
        <div className="justify-self-end border border-black p-3 m-1 bg-secondary text-center">
          <h1 className="text-white text-xs">{remainingPunishments}</h1>
          <h3 className="text-white text-xs">Remaining</h3>
        </div>
      </div>
    );
};
