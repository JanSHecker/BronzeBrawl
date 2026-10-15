import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, BACKEND_PORT } from "../constants";
import { errorMessage, getHostCapability, getGameId, hostAuth } from "../api";
import { Button } from "react-daisyui";

const PROXY_BASE_URL = "http://localhost:3002";
const LOL_DATA_ENDPOINT = "/lol-data";

const StatusMessage = ({ status, error }) => {
  const text = status === "connected" ? "✅ Connected to local proxy" : status === "missing" ? "⚠️ Host capability required" : status === "error" ? "❌ Proxy connection failed" : "🔄 Checking proxy status...";
  return (
    <div className="flex flex-col border border-gray-300 rounded p-4 mb-4 bg-gray-50">
      <h2 className="text-lg font-semibold mb-2">Local Proxy Status</h2>
      <p role={status === "error" || status === "missing" ? "alert" : undefined} className={status === "connected" ? "font-medium text-green-600" : status === "error" || status === "missing" ? "font-medium text-red-600" : "font-medium text-yellow-600"}>{text}</p>
      {error && <p className="text-red-500 text-sm mt-1">Error: {error}</p>}
    </div>
  );
};

const ErrorInstructions = ({ onRefresh }) => (
  <div className="flex flex-col border border-red-300 rounded p-4 mb-4 bg-red-50">
    <h2 className="text-lg font-semibold mb-2 text-red-700">Setup Required</h2>
    <p className="mb-3 text-red-600">The local proxy server is not running. Start it first, then retry.</p>
    <Button color="error" size="sm" onClick={onRefresh} className="self-start">Refresh Status</Button>
  </div>
);

const LegacyInfo = () => (
  <div className="flex flex-col border border-gray-300 rounded p-4 bg-gray-50 opacity-60">
    <h2 className="text-lg font-semibold mb-2">Previous Method (No Longer Needed)</h2>
    <p className="text-sm text-gray-600 mb-2">With the local proxy server, you no longer need CORS browser extensions!</p>
  </div>
);

const LoLApiFeed = () => {
  const gameId = Number(getGameId());
  const hostToken = getHostCapability();
  const hasCapability = Number.isSafeInteger(gameId) && gameId > 0 && typeof hostToken === "string" && hostToken.length > 0;
  const [proxyStatus, setProxyStatus] = useState(hasCapability ? "checking" : "missing");
  const [lastError, setLastError] = useState(hasCapability ? null : "A host game capability is required to start the feed.");
  const [jsonData, setJsonData] = useState(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);

  const sendLoLInput = useCallback(async () => {
    if (!hasCapability || inFlightRef.current || !mountedRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await axios.get(`${PROXY_BASE_URL}${LOL_DATA_ENDPOINT}`, { timeout: 5000 });
      if (!mountedRef.current) return;
      setJsonData(response.data);
      await axios.post(
        `${localStorage.getItem("baseURL") || API_BASE_URL}${BACKEND_PORT}sendLoLInput`,
        { gameId, input: response.data },
        { timeout: 5000, headers: hostAuth(hostToken) },
      );
      if (mountedRef.current) {
        setProxyStatus("connected");
        setLastError(null);
      }
    } catch (requestError) {
      if (mountedRef.current) {
        setProxyStatus("error");
        setLastError(errorMessage(requestError, "Feed update failed; retrying."));
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [gameId, hasCapability, hostToken]);

  const checkProxyStatus = useCallback(async () => {
    if (!hasCapability) return;
    try {
      await axios.get(`${PROXY_BASE_URL}/health`, { timeout: 3000 });
      if (mountedRef.current) setProxyStatus("connected");
    } catch (requestError) {
      if (mountedRef.current) {
        setProxyStatus("error");
        setLastError(errorMessage(requestError, "Local proxy server not responding."));
      }
    }
  }, [hasCapability]);

  useEffect(() => {
    mountedRef.current = true;
    if (!hasCapability) return () => { mountedRef.current = false; };
    const run = async () => {
      await sendLoLInput();
      if (mountedRef.current) timerRef.current = window.setTimeout(run, 3000);
    };
    checkProxyStatus();
    run();
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [checkProxyStatus, hasCapability, sendLoLInput]);

  const retry = () => { setLastError(null); setProxyStatus("checking"); sendLoLInput(); };

  return (
    <div className="min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">League of Legends API Feed</h1>
      <p className="mb-4">Browser-Relay: nicht gleichzeitig mit dem Companion-Direktmodus betreiben. <a className="underline" href="/replays#companion-setup">Companion einrichten und Modus wählen</a>. Diese Seite sendet bei vorhandener Host-Berechtigung; für den Direktmodus diesen Tab schließen.</p>
      <div className="flex gap-4 h-[calc(100vh-8rem)]">
        <div className="w-1/3 flex flex-col gap-4">
          <StatusMessage status={proxyStatus} error={lastError} />
          {!hasCapability && <div role="status" className="border border-red-300 rounded p-4 text-red-700">Open the monitor from a created game. The host capability is missing.</div>}
          <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded border border-gray-300">Proxy URL: <code className="bg-gray-200 px-1 rounded">{PROXY_BASE_URL}{LOL_DATA_ENDPOINT}</code></div>
          {hasCapability && proxyStatus === "error" && <ErrorInstructions onRefresh={retry} />}
          {hasCapability && proxyStatus === "connected" && <div className="flex flex-col border border-green-300 rounded p-4 bg-green-50"><h2 className="text-lg font-semibold mb-2 text-green-700">✅ Ready to Go!</h2><p className="text-green-600 text-sm">Local proxy is running and game data is being submitted every 3 seconds.</p></div>}
          <LegacyInfo />
        </div>
        <div className="w-2/3"><div className="flex flex-col border border-gray-300 rounded p-4 bg-gray-50 h-full"><h2 className="text-lg font-semibold mb-2">Live Game Data</h2><div className="overflow-auto flex-grow bg-gray-800 text-green-400 font-mono p-4 rounded"><pre>{jsonData ? JSON.stringify(jsonData, null, 2) : "Waiting for data..."}</pre></div></div></div>
      </div>
    </div>
  );
};

export default LoLApiFeed;
