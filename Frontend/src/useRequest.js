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
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let disposed = false;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        await latest.current(controller.signal);
        if (!disposed) setError("");
      } catch (failure) {
        if (!disposed) setError(errorMessage(failure));
      } finally {
        if (!disposed) timer = setTimeout(poll, delay);
      }
    };
    poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [delay, revision]);
  return { error, retry };
}
