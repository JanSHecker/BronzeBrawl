import { createContext, useContext, useEffect, useState } from "react";
import api, { getGameId, getHostCapability, hostAuth, SESSION_EVENT, validId } from "../api";
import { usePolling } from "../useRequest";

const idle = { gameId: null, status: null, message: "Erstelle ein Spiel in der Haupt-App und verbinde den Companion mit diesem Spiel." };
const FeedContext = createContext(idle);
export const useLiveFeed = () => useContext(FeedContext);
const hostGame = () => {
  const id = Number(getGameId());
  return validId(id) && getHostCapability(id) ? id : null;
};

export function LiveFeedProvider({ children }) {
  const [gameId, setGameId] = useState(hostGame);
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const update = () => setGameId(hostGame());
    window.addEventListener(SESSION_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(SESSION_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const { error } = usePolling(async signal => {
    if (!gameId) return;
    const { data } = await api.get("companion/status", {
      params: { gameId }, headers: hostAuth(getHostCapability(gameId)), signal,
    });
    if (signal.aborted) return;
    if (data?.gameId !== gameId || typeof data.connected !== "boolean" || typeof data.paired !== "boolean" || typeof data.feedFresh !== "boolean") {
      throw new Error("Ungültiger Companion-Status vom Backend.");
    }
    setStatus(data);
  }, 3000, gameId);
  const current = status?.gameId === gameId ? status : null;
  const message = !gameId ? idle.message : error ? `Verbindungsstatus nicht erreichbar: ${error}`
    : !current ? "Companion-Verbindung wird geprüft …"
    : !current.paired ? "Companion nicht eingerichtet. Verbindungscode unter Companion erstellen."
    : !current.connected ? "Companion nicht verbunden. Keine aktuellen Lebenszeichen vom Companion."
    : current.availability === "conflict" ? "Companion verbunden – Spiel gewechselt oder Feed abgelehnt. Bitte ein neues BronzeBrawl-Spiel verbinden."
    : current.gameState === "ended" ? "Companion verbunden – Spiel beendet."
    : current.feedFresh ? "Companion verbunden – Live-Daten kommen direkt am Server an."
    : current.availability === "waiting" ? "Companion verbunden – warte auf LoL-Livedaten."
    : "Companion verbunden – noch keine aktuellen Spieldaten am Server.";
  return <FeedContext.Provider value={{ gameId, status: current, message }}>
    {children}
    {gameId && <p role="status" data-testid="live-feed-status" className={`feed-status m-2 rounded border p-3 text-sm${!error && current?.connected ? " feed-status-connected" : ""}`}>{message}</p>}
  </FeedContext.Provider>;
}
