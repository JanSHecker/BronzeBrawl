import { createContext, useContext, useEffect, useState } from "react";
import api, { axios, getGameId, getHostCapability, hostAuth, SESSION_EVENT, validId } from "../api";
import { usePolling } from "../useRequest";

const idle = { gameId: null, message: "Erstelle ein Spiel in der Haupt-App. Der Live-Feed startet dann automatisch." };
const FeedContext = createContext(idle);
export const useLiveFeed = () => useContext(FeedContext);
const hostGame = () => {
  const id = Number(getGameId());
  return validId(id) && getHostCapability(id) ? id : null;
};

export function LiveFeedProvider({ children }) {
  const [gameId, setGameId] = useState(hostGame);
  const [state, setState] = useState("companion");
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
    let input;
    try {
      ({ data: input } = await axios.get("http://localhost:3002/lol-data", { timeout: 5000, signal }));
    } catch (failure) {
      if (signal.aborted) return;
      if (!failure.response || failure.response.status === 503) {
        setState(failure.response?.status === 503 ? "game" : "companion");
        return;
      }
      throw failure;
    }
    if (signal.aborted) return;
    await api.post("sendLoLInput", { gameId, input }, { headers: hostAuth(getHostCapability(gameId)), signal });
    if (!signal.aborted) setState("live");
  }, 3000, gameId);
  const message = !gameId ? idle.message : error ? `Live-Feed: ${error}`
    : state === "live" ? "Live-Daten werden automatisch weitergegeben."
    : state === "game" ? "Live-Feed bereit. Warte auf ein laufendes LoL-Spiel."
    : "Warte auf den Companion. Einfach im Terminal starten.";
  return <FeedContext.Provider value={{ gameId, message }}>
    {children}
    {gameId && <p role="status" data-testid="live-feed-status" className="m-2 text-sm">{message}</p>}
  </FeedContext.Provider>;
}
