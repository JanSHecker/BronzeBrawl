import { useRef, useState } from "react";
import { Button } from "react-daisyui";
import processChampionName from "../nameAdjuster";
import axios from "axios";
import { BACKEND_PORT } from "../constants";
import { errorMessage, playerAuth } from "../api";

const PunishmentDisplay = ({ punishmentStack = [] }) => {
  const punishment = punishmentStack[0];
  let urlEnd = "item/3157";
  let message = "You haven't received any punishments.";
  if (punishment?.punishmentType === 1) {
    const killerName = punishment.takedown?.killer?.championName;
    urlEnd = killerName ? `champion/${processChampionName(killerName)}` : "item/3157";
    message = `You were Killed! Drink ${punishment.amount}.`;
  } else if (punishment?.punishmentType === 2 || punishment?.punishmentType === 0) {
    urlEnd = "item/3134";
    message = `You received a punishment${punishment.distributor?.playerName ? ` from ${punishment.distributor.playerName}` : ""}. Drink ${punishment.amount}!`;
  }
  return (
    <div>
      <div className="flex flex-col bg-slate-300 gap-1 border rounded border-black p-1">
        <div className="text-center text-sm">{message}</div>
        <img src={`https://static.bigbrain.gg/assets/lol/riot_static/13.23.1/img/${urlEnd}.png`} alt="champion icon" className="m-1 w-1/5 border border-black self-center" />
        <PunishmentButton isActive={punishmentStack.length > 0} punishmentStack={punishmentStack} />
      </div>
    </div>
  );
};

const PunishmentButton = ({ isActive, punishmentStack }) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pendingRef = useRef(false);
  const remainingPunishments = punishmentStack.length;
  const handleDone = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await axios.post(
        `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}confirmPunishment`,
        { id: punishmentStack[0].punishmentId },
        { timeout: 5000, headers: playerAuth() },
      );
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  if (!isActive) return <div className="grid grid-cols-5"><div></div><div className="text-center text-sm col-span-3">Count yourself lucky!</div><div className="justify-self-end border border-black p-3 m-1 bg-secondary text-center"><h1 className="text-white text-xs">0</h1><h3 className="text-white text-xs">Remaining</h3></div></div>;
  return (
    <div className="grid grid-cols-3 w-full">
      {error && <div role="alert" className="col-span-3 text-center text-red-700">{error}</div>}
      <div></div>
      <Button className="m-2 justify-self-center" color="primary" size="xm" onClick={handleDone} disabled={pending}>{pending ? "Saving..." : "Done"}</Button>
      <div className="justify-self-end text-center border border-black p-3 m-1 bg-secondary"><h1 className="text-white text-xs">{remainingPunishments}</h1><h3 className="text-white text-xs">Remaining</h3></div>
    </div>
  );
};

export default PunishmentDisplay;
