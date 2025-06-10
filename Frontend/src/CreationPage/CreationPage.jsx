import { useState } from "react";
import CreationForm from "./CreationForm";
import Linkbox from "./Linkbox";
import { Button } from "react-daisyui";

const CreationPage = () => {
  const [gameId, setGameId] = useState("");
  const currentDomain = "http://" + window.location.hostname;
  console.log(currentDomain);
  return (
    <div className="flex flex-col border rounded border-black p-1 bg-slate-300 items-center">
      {/* <img
        src="./bronzeIcon150.png"
        alt="bronze brawl with icon"
        className="mb-8 max-w-full h-auto"
      /> */}
      <CreationForm setGameId={setGameId} currentDomain={currentDomain} />
      <Linkbox gameId={gameId} />
      <a href={window.location.origin + "/lolApi"} target="_blank">
        <Button color="secondary" className="m-2 justify-self-center">
          Open LoL Monitor
        </Button>
      </a>
    </div>
  );
};

export default CreationPage;
