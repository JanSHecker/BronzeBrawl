import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

// The ref closes the gap before React renders the disabled button.
export function useAction() {
  const running = useRef(false);
  const mounted = useRef(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (work) => {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    setError("");
    try { await work(); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally {
      running.current = false;
      if (mounted.current) setLoading(false);
    }
  };
  return { run, loading, error };
}

// Schedule only after completion: no overlapping requests, even on a slow feed.
export function usePolling(work, delay = 1000) {
  const latest = useRef(work);
  latest.current = work;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const context = useRef(null);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const refresh = useCallback(async () => {
    const current = context.current;
    if (!current) return;
    if (current.pending) await current.pending;
    if (current.active) await current.poll();
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer;
    const controller = new AbortController();
    const current = { active: true, pending: null, poll: null };
    const poll = () => {
      if (current.pending) return current.pending;
      clearTimeout(timer);
      current.pending = (async () => {
        try {
          await latest.current(controller.signal);
          if (!disposed) setError("");
        } catch (failure) {
          if (!disposed) setError(errorMessage(failure));
        } finally {
          current.pending = null;
          if (!disposed) timer = setTimeout(poll, delay);
        }
      })();
      return current.pending;
    };
    current.poll = poll;
    context.current = current;
    poll();
    return () => { disposed = true; current.active = false; controller.abort(); clearTimeout(timer); if (context.current === current) context.current = null; };
  }, [delay, revision]);
  return { error, retry, refresh };
}
