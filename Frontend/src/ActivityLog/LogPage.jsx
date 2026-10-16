import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getGameId, getHostCapability, getPlayerId, SESSION_EVENT, validId } from "../api";
import EventLog from "./EventLog";
import { useGameActivity } from "./useGameActivity";

function GameHistory({ gameId, playerId, hostToken }) {
  const log = useGameActivity({ gameId, playerId, hostToken });
  return <>
    <div className="flex justify-between gap-4 items-center">
      <p>Game #{gameId} · Updates every 2 seconds</p>
      <button className="btn btn-sm" onClick={log.refresh}>Refresh</button>
    </div>
    {log.error && <p role="alert">{log.error} <button onClick={log.retry}>Retry</button></p>}
    {log.loading ? !log.error && <p role="status">Loading activity…</p> : <EventLog items={log.items} />}
    {log.olderError && <p role="alert">{log.olderError}</p>}
    {log.hasOlder && <button className="btn btn-sm" disabled={log.loadingOlder} onClick={log.loadOlder}>
      {log.loadingOlder ? "Loading older events…" : "Load older events"}
    </button>}
  </>;
}

export default function LogPage() {
  const [search] = useSearchParams();
  const [, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    window.addEventListener(SESSION_EVENT, update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener(SESSION_EVENT, update); window.removeEventListener("storage", update); };
  }, []);
  const gameId = Number(search.get("gameId") ?? getGameId());
  const playerId = Number(getPlayerId()) || undefined;
  const hostToken = getHostCapability(gameId);
  return <main className="w-full max-w-2xl flex flex-col gap-4">
    <h1 className="text-2xl font-bold">Game event log</h1>
    <p>Test view for the reusable activity log. Newest events appear first.</p>
    {!validId(gameId) || !hostToken && !playerId
      ? <p>Create or join a game in this browser tab, then open /log.</p>
      : <GameHistory key={`${gameId}:${playerId}:${hostToken}`} gameId={gameId} playerId={playerId} hostToken={hostToken} />}
    <Link to="/" className="underline">Back to game creation</Link>
  </main>;
}
