import { useEffect, useState } from "react";
import CreationForm from "./CreationForm";
import Linkbox from "./Linkbox";
import { Link } from "react-router-dom";
import EntryPage from "../components/EntryPage";
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
    <EntryPage host>
      <section className="host-content" aria-labelledby="host-title">
        <div className="entry-heading"><h1 id="host-title">Host a game</h1><p>Set the rules. Bring your friends.</p></div>
        <details className={`host-settings${game ? '' : ' host-settings-new'}`} open={!game || undefined}>
          <summary>Game settings</summary>
          <CreationForm setGame={created => { setError(""); setGame(created); }} />
        </details>
        <Linkbox gameCode={game?.gameCode} />
        {error && <p role="alert">{error}</p>}
        <div className="host-companion">
          <Link to="/companion">Companion verbinden</Link>
          <details className="entry-help"><summary>How to connect</summary>
            <p>Companion auf dem LoL-PC starten und einmal mit dem Spiel verbinden. Er sendet Live-Daten direkt an den Server — auch wenn diese Seite geschlossen ist.</p>
          </details>
        </div>
      </section>
    </EntryPage>
  );
};

export default CreationPage;
