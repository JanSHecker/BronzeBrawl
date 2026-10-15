import { useEffect, useRef, useState } from "react";
import { axios, backendUrl } from "../api";
import { API_BASE_URL } from "../constants";

export const REPLAY_TOKEN_KEY = "bb:replay-admin";
export const replayUrl = (path = "") => backendUrl(API_BASE_URL, `replays${path}`);
const savedToken = () => {
  try { return sessionStorage.getItem(REPLAY_TOKEN_KEY) || ""; } catch { return ""; }
};
const requestError = (error) => {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return "Replay-Token abgelehnt. Bitte erneut entsperren.";
  if (status === 409) return "Konflikt: Replay bereits reserviert, nicht verfügbar oder Datei abweichend. Liste erneut prüfen.";
  if (status === 413) return "Die Replay-Datei ist zu groß.";
  if (status === 400 || status === 422) return "Eingaben oder Replay-Datei ungültig. Match-ID, Version und Dateiformat prüfen.";
  if (status === 429) return "Zu viele Anfragen. Bitte später erneut versuchen.";
  if (error?.invalidReplayResponse) return "Ungültige Antwort der Replay-Verwaltung.";
  return "Verbindung zur Replay-Verwaltung fehlgeschlagen. Bitte erneut versuchen.";
};
const validReplayItem = (item) => item && typeof item === "object" &&
  typeof item.matchId === "string" && typeof item.gameVersion === "string" &&
  typeof item.patch === "string" && typeof item.analysisStatus === "string";

// A session owns all requests and timers. A finished request schedules the next poll,
// never an interval: slow requests cannot overlap, even with manual refreshes.
export default function useReplayAdmin() {
  const [token, setToken] = useState(savedToken);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const session = useRef(null);

  const lock = () => {
    session.current?.stop();
    sessionStorage.removeItem(REPLAY_TOKEN_KEY);
    setToken(""); setData(null); setError(""); setNotice(""); setLoading(false); setBusy(false);
  };

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const context = {
      active: true, timer: null, pending: null, running: false, urls: new Set(),
      config: { headers: { "X-Replay-Token": token }, signal: controller.signal, timeout: 30000 },
      stop() {
        this.active = false;
        controller.abort();
        window.clearTimeout(this.timer);
        for (const url of this.urls) URL.revokeObjectURL(url);
        this.urls.clear();
      },
    };
    const fail = (err) => {
      if (!context.active) return;
      setError(requestError(err));
      if ([401, 403].includes(err?.response?.status)) {
        context.stop(); sessionStorage.removeItem(REPLAY_TOKEN_KEY);
        setToken(""); setData(null); setNotice(""); setLoading(false); setBusy(false);
      }
    };
    context.fail = fail;
    context.refresh = () => {
      if (!context.active) return Promise.resolve();
      if (context.pending) return context.pending;
      window.clearTimeout(context.timer);
      setLoading(true);
      context.pending = (async () => {
        try {
          const response = await axios.get(replayUrl(), context.config);
          if (!context.active) return;
          if (!Array.isArray(response.data?.items) || typeof response.data?.riotConfigured !== "boolean" ||
            !response.data.items.every(validReplayItem)) {
            throw { invalidReplayResponse: true };
          }
          setData(response.data); setError("");
        } catch (err) { fail(err); }
        finally {
          context.pending = null;
          if (context.active) {
            setLoading(false);
            context.timer = window.setTimeout(context.refresh, 5000);
          }
        }
      })();
      return context.pending;
    };
    session.current = context;
    setData(null); setBusy(false); setNotice(""); setError("");
    context.refresh();
    return () => { context.stop(); if (session.current === context) session.current = null; };
  }, [token]);

  const unlock = (value) => {
    const next = value.trim();
    if (!next) { setError("Bitte Replay-Token eingeben."); return; }
    try { sessionStorage.setItem(REPLAY_TOKEN_KEY, next); }
    catch { setError("Sitzungsspeicher nicht verfügbar. Bitte im Browser zulassen."); return; }
    setError(""); setToken(next);
  };

  const perform = async (task) => {
    const context = session.current;
    if (!context?.active || context.running) return;
    context.running = true; setBusy(true); setError(""); setNotice("");
    try {
      const message = await task(context);
      if (context.active) {
        setNotice(message || "Aktion abgeschlossen.");
        // Wait out an older poll, then fetch a fresh post-mutation snapshot.
        if (context.pending) await context.pending;
        if (context.active) await context.refresh();
      }
    } catch (err) { context.fail(err); }
    finally { context.running = false; if (context.active) setBusy(false); }
  };

  return { data, loading, busy, error, notice, hasToken: Boolean(token), unlock, lock, perform,
    refresh: () => session.current?.refresh(), setError };
}
