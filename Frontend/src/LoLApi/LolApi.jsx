import { useState } from "react";
import api, { axios, getGameId, getHostCapability, hostAuth, validId } from "../api";
import { usePolling } from "../useRequest";

const LoLApiFeed = () => {
  const gameId = Number(getGameId());
  const hostToken = getHostCapability(gameId);
  const hasCapability = validId(gameId) && Boolean(hostToken);
  const [jsonData, setJsonData] = useState(null);
  const [connected, setConnected] = useState(false);
  const { error, retry } = usePolling(async signal => {
    if (!hasCapability) throw new Error("A host game capability is required to start the feed.");
    setConnected(false);
    const { data: input } = await axios.get("http://localhost:3002/lol-data", { timeout: 5000, signal });
    if (signal.aborted) return;
    setJsonData(input);
    await api.post("sendLoLInput", { gameId, input }, { headers: hostAuth(hostToken), signal });
    if (!signal.aborted) setConnected(true);
  }, 3000);
  return <div className="min-h-screen p-4">
    <h1 className="text-2xl font-bold mb-4">League of Legends API Feed</h1>
    <p>Browser-Relay: nicht gleichzeitig mit dem Companion-Direktmodus betreiben. <a className="underline" href="/replays#companion-setup">Companion einrichten und Modus wählen</a>. Für den Direktmodus diesen Tab schließen.</p>
    {error && <p role="alert">{error} <button onClick={retry}>Retry</button></p>}
    <p role="status">{connected ? "Connected: game data submitted." : hasCapability ? "Waiting for game data…" : "Host capability missing. Open the monitor from a created game."}</p>
    <p>Proxy URL: http://localhost:3002/lol-data</p>
    <pre className="overflow-auto bg-gray-800 text-green-400 p-4">{jsonData ? JSON.stringify(jsonData, null, 2) : "Waiting for data…"}</pre>
  </div>;
};
export default LoLApiFeed;
