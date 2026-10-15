import { useState } from "react";
import CreationForm from "./CreationForm";
import Linkbox from "./Linkbox";
import { API_BASE_URL } from "../constants";
import { getGameId, getHostCapability, validId } from "../api";

const CreationPage = () => {
  const [gameId, setGameId] = useState(() => {
    const id = Number(getGameId());
    return validId(id) && getHostCapability(id) ? id : "";
  });
  const currentDomain = API_BASE_URL;
  localStorage.setItem("baseURL", currentDomain);
  return (
    <div className="flex flex-col border rounded border-black p-1 bg-slate-300 items-center">
      {/* <img
        src="./bronzeIcon150.png"
        alt="bronze brawl with icon"
        className="mb-8 max-w-full h-auto"
      /> */}
      <CreationForm setGameId={setGameId} currentDomain={currentDomain} />
      <Linkbox gameId={gameId} />
      <a href="/replays" className="m-3 underline text-slate-900">Replays und Companion einrichten</a>
      <p className="max-w-xs px-3 text-sm text-slate-800">Companion im Terminal starten. Live-Daten werden nach dem Erstellen eines Spiels automatisch abgeholt — ohne zusätzliches Verbinden. Das funktioniert auch nach einem Neuladen dieser Seite.</p>
    </div>
  );
};

export default CreationPage;
