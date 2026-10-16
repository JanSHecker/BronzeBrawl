import { useEffect, useState } from "react";
import CreationForm from "./CreationForm";
import Linkbox from "./Linkbox";
import NameForm from "../FrontPage/NameForm";
import api, { errorMessage, getGameId, getHostCapability, hostAuth, readActiveSession, validGameCode, validId, writeActiveSession } from "../api";

const CreationPage = () => {
  const [game, setGame] = useState(() => {
    const active = readActiveSession();
    const gameId = Number(getGameId());
    return validId(gameId) && getHostCapability(gameId) ? active || { gameId } : null;
  });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!game || validGameCode(game.gameCode)) return;
    const controller = new AbortController();
    api.get("getInvitation", { params: { gameId: game.gameId }, headers: hostAuth(getHostCapability(game.gameId)), signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (data?.gameId !== game.gameId || !validGameCode(data.gameCode)) throw new Error("Invalid invitation response");
        const restored = { ...game, gameCode: data.gameCode };
        writeActiveSession(restored);
        setGame(restored);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [game]);
  return (
    <>
      <section className="flex flex-col items-center border rounded border-black p-4 bg-slate-300">
        <h1 className="text-2xl">Join a game</h1>
        <NameForm />
      </section>
      <div className="flex flex-col border rounded border-black p-1 bg-slate-300 items-center">
        <h2 className="text-2xl m-3">Host a game</h2>
        <CreationForm setGame={created => { setError(""); setGame(created); }} />
        <Linkbox gameCode={game?.gameCode} />
        {error && <p role="alert">{error}</p>}
        <a href="/companion" className="m-3 underline text-slate-900">Companion verbinden</a>
        <p className="max-w-xs px-3 text-sm text-slate-800">Companion auf dem LoL-PC starten und einmal mit dem Spiel verbinden. Er sendet Live-Daten direkt an den Server — auch wenn diese Seite geschlossen ist.</p>
      </div>
    </>
  );
};

export default CreationPage;
