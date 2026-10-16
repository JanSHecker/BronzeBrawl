import { useEffect, useRef, useState } from "react";
import api, { errorMessage, isJsonObject, validId } from "../api";
import { usePolling } from "../useRequest";

function validatePage(data) {
  if (!isJsonObject(data) || !Array.isArray(data.items)
    || !(data.nextCursor === null || validId(data.nextCursor))
    || !data.items.every(item => isJsonObject(item) && validId(item.activityId)
      && validId(item.gameId) && typeof item.type === "string" && isJsonObject(item.data)
      && typeof item.recordedAt === "string" && Number.isFinite(Date.parse(item.recordedAt))
      && (item.gameTime === null || typeof item.gameTime === "number" && Number.isFinite(item.gameTime)))) {
    throw new Error("Invalid activity response");
  }
  return data;
}

const merge = (current, incoming) => [...new Map([...current, ...incoming].map(item => [item.activityId, item])).values()]
  .sort((a, b) => b.activityId - a.activityId);

// No route or layout dependency: any screen can consume the same game history.
export function useGameActivity({ gameId, playerId, hostToken }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");
  const history = useRef(null);
  const scope = `${gameId}:${playerId || ""}:${hostToken || ""}`;

  useEffect(() => {
    const context = { newest: null, nextCursor: null, initialized: false, pendingOlder: false, controller: new AbortController() };
    history.current = context;
    setItems([]); setLoading(true); setHasOlder(false); setLoadingOlder(false); setOlderError("");
    return () => context.controller.abort();
  }, [scope]);

  const fetchPage = async (cursor, signal) => {
    const { data } = await api.get("gameActivity", {
      params: { gameId, playerId: hostToken ? undefined : playerId, limit: 100, ...cursor },
      headers: hostToken ? { "X-Game-Token": hostToken } : {}, signal,
    });
    const page = validatePage(data);
    if (page.items.some(item => item.gameId !== gameId)) throw new Error("Invalid activity game");
    return page;
  };

  const polling = usePolling(async signal => {
    const context = history.current;
    if (!context || !validId(gameId)) return;
    if (!context.initialized || context.newest === null) {
      const page = await fetchPage({}, signal);
      if (signal.aborted) return;
      context.initialized = true;
      context.newest = page.items[0]?.activityId ?? null;
      context.nextCursor = page.nextCursor;
      setItems(page.items); setHasOlder(page.nextCursor !== null); setLoading(false);
      return;
    }
    // Drain forward pages so bursts larger than one page never leave a gap.
    let cursor = context.newest;
    do {
      const page = await fetchPage({ after: cursor }, signal);
      if (signal.aborted) return;
      if (page.items.some(item => item.activityId <= cursor)
        || page.nextCursor !== null && page.nextCursor <= cursor) throw new Error("Invalid activity cursor");
      if (page.items.length) {
        context.newest = Math.max(...page.items.map(item => item.activityId));
        setItems(current => merge(current, page.items));
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }, 2000, scope);

  const loadOlder = async () => {
    const context = history.current;
    if (!context || context.pendingOlder || context.nextCursor === null) return;
    context.pendingOlder = true; setLoadingOlder(true); setOlderError("");
    try {
      const page = await fetchPage({ before: context.nextCursor }, context.controller.signal);
      if (context.controller.signal.aborted) return;
      if (page.items.some(item => item.activityId >= context.nextCursor)
        || page.nextCursor !== null && page.nextCursor >= context.nextCursor) throw new Error("Invalid activity cursor");
      context.nextCursor = page.nextCursor;
      setItems(current => merge(current, page.items)); setHasOlder(page.nextCursor !== null);
    } catch (error) {
      if (!context.controller.signal.aborted) setOlderError(errorMessage(error));
    } finally {
      context.pendingOlder = false;
      if (!context.controller.signal.aborted) setLoadingOlder(false);
    }
  };

  return { items, loading, hasOlder, loadingOlder, loadOlder, olderError,
    error: polling.error, retry: polling.retry, refresh: polling.refresh };
}
