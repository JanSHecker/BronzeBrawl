import { useState } from "react";
import CreationForm from "./CreationForm";
import Linkbox from "./Linkbox";
import { Button } from "react-daisyui";
import { API_BASE_URL } from "../constants";

const CreationPage = () => {
  const [gameId, setGameId] = useState("");
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
      <p className="max-w-xs px-3 text-sm text-slate-800">Companion-Direktmodus und Browser-Relay nur alternativ nutzen, nie gleichzeitig. Die Replay-Seite startet keinen Feed.</p>
      <a href={window.location.origin + "/lolApi"}>
        <Button color="secondary" className="m-2 justify-self-center">
          Open LoL Monitor
        </Button>
      </a>
    </div>
  );
};

export default CreationPage;
