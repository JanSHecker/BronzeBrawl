import { useEffect, useRef, useState } from "react";
import api, { hostAuth, getHostCapability } from "../api";
import { API_BASE_URL } from "../constants";
import { useAction } from "../useRequest";
import { useLiveFeed } from "../LoLApi/LiveFeed";

function ConnectionControls({ gameId }) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const { run, loading, error } = useAction();
  const controller = useRef(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const config = () => ({ headers: hostAuth(getHostCapability(gameId)), signal: controller.current.signal });
  const connect = () => run(async () => {
    setCode(""); setCopied(false);
    const { data } = await api.post("companion/connect", { gameId }, config());
    if (controller.current.signal.aborted) return;
    if (data?.gameId !== gameId || !/^[a-f0-9]{64}$/.test(data.token || "")) throw new Error("Ungültiger Verbindungscode vom Backend.");
    const backendUrl = new URL(API_BASE_URL, window.location.origin).href.replace(/\/$/, "");
    const encoded = btoa(JSON.stringify({ backendUrl, gameId, token: data.token })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    setCode(`BB1.${encoded}`);
  });
  const disconnect = () => run(async () => {
    await api.post("companion/disconnect", { gameId }, config());
    if (!controller.current.signal.aborted) { setCode(""); setCopied(false); }
  });
  return <section className="flex flex-col gap-3 my-4">
    <p>Spiel {gameId}: Verbindungscode erstellen, im Companion <code>v</code> eingeben und den Code einfügen. Danach läuft die Übertragung automatisch, auch ohne offenen Browser.</p>
    <button className="btn" disabled={loading} onClick={connect}>Neuen Verbindungscode erstellen</button>
    {code && <>
      <label>Verbindungscode<input className="input w-full" readOnly value={code} onFocus={event => event.target.select()} /></label>
      <button className="btn" disabled={loading} onClick={() => run(async () => { await navigator.clipboard.writeText(code); setCopied(true); })}>{copied ? "Kopiert" : "Code kopieren"}</button>
      <p>Geheim halten. Der Code erlaubt ausschließlich den Companion-Feed für dieses Spiel. Ein neuer Code sperrt den vorherigen.</p>
    </>}
    <button className="btn" disabled={loading} onClick={disconnect}>Companion-Zugriff widerrufen</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function CompanionPage() {
  const { gameId, status, message } = useLiveFeed();
  return <main className="max-w-2xl p-4" lang="de">
    <a className="underline" href="/">Zur Haupt-App</a>
    <h1 className="text-2xl font-bold my-4">Companion</h1>
    <p>{message}</p>
    {status?.lastSeenAt && <p>Letztes Lebenszeichen: {new Date(status.lastSeenAt).toLocaleTimeString()}</p>}
    {status?.lastInputAt && <p>Letzte Spieldaten: {new Date(status.lastInputAt).toLocaleTimeString()}</p>}
    <ol className="list-decimal ml-5 my-4">
      <li><a className="underline" href="/downloads/bronze-brawl-companion.zip" download>Companion herunterladen (.zip)</a>, entpacken und Python 3.11 oder neuer installieren.</li>
      <li><code>start.cmd</code> auf dem LoL-PC öffnen.</li>
      <li>Hier ein Spiel erstellen und den Verbindungscode im Companion mit <code>v</code> hinterlegen.</li>
    </ol>
    {gameId && <ConnectionControls key={gameId} gameId={gameId} />}
    <p>Der Companion liest LoL alle drei Sekunden und sendet direkt per HTTPS an den Server. Kein localhost-Zugriff und keine Netzwerkfreigabe im Browser nötig.</p>
  </main>;
}
