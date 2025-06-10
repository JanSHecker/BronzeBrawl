import axios from "axios";
import { useEffect, useState } from "react";
import { BACKEND_PORT } from "../constants";
import { Button } from "react-daisyui";

// JSON Display Component
const JsonDisplay = ({ data, title = "JSON Data" }) => {
  return (
    <div className="flex flex-col border border-gray-300 rounded p-4 bg-gray-50 h-full">
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="overflow-auto flex-grow bg-gray-800 text-green-400 font-mono p-4 rounded">
        <pre>{data ? JSON.stringify(data, null, 2) : "Waiting for data..."}</pre>
      </div>
    </div>
  );
};

// Status Message Component
const StatusMessage = ({ status, error }) => {
  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "text-green-600";
      case "error":
        return "text-red-600";
      case "checking":
        return "text-yellow-600";
      default:
        return "text-gray-600";
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case "connected":
        return "✅ Connected to local proxy";
      case "error":
        return "❌ Proxy connection failed";
      case "checking":
        return "🔄 Checking proxy status...";
      default:
        return "⚪ Unknown status";
    }
  };

  return (
    <div className="flex flex-col border border-gray-300 rounded p-4 mb-4 bg-gray-50">
      <h2 className="text-lg font-semibold mb-2">Local Proxy Status</h2>
      <p className={`font-medium ${getStatusColor()}`}>
        {getStatusMessage()}
      </p>
      {error && (
        <p className="text-red-500 text-sm mt-1">Error: {error}</p>
      )}
    </div>
  );
};

// Error Instructions Component
const ErrorInstructions = ({ onRefresh }) => (
  <div className="flex flex-col border border-red-300 rounded p-4 mb-4 bg-red-50">
    <h2 className="text-lg font-semibold mb-2 text-red-700">
      Setup Required
    </h2>
    <p className="mb-3 text-red-600">
      The local proxy server is not running. Please start it first:
    </p>
    <ol className="list-decimal list-inside space-y-1 text-sm mb-3">
      <li>Make sure Docker is installed and running</li>
      <li>
        Run{" "}
        <code className="bg-red-100 px-1 rounded">
          run-lol-proxy-docker.bat
        </code>
      </li>
      <li>Wait for "Server running on http://localhost:3001"</li>
      <li>Make sure League of Legends is running and you're in a game</li>
    </ol>
    <Button
      color="error"
      size="sm"
      onClick={onRefresh}
      className="self-start"
    >
      Refresh Status
    </Button>
  </div>
);

// Legacy Info Component
const LegacyInfo = () => (
  <div className="flex flex-col border border-gray-300 rounded p-4 bg-gray-50 opacity-60">
    <h2 className="text-lg font-semibold mb-2">
      Previous Method (No Longer Needed)
    </h2>
    <p className="text-sm text-gray-600 mb-2">
      With the local proxy server, you no longer need CORS browser
      extensions!
    </p>
    <div className="flex flex-row gap-2">
      <a href="https://addons.mozilla.org/en-US/firefox/addon/cors-unblock/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search">
        <Button color="primary" className="m-2" size="sm" disabled>
          Firefox (Not Needed)
        </Button>
      </a>
      <a href="https://chromewebstore.google.com/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino">
        <Button color="secondary" className="m-2" size="sm" disabled>
          Chrome (Not Needed)
        </Button>
      </a>
    </div>
  </div>
);

const LoLApiFeed = () => {
  const PROXY_BASE_URL = "http://localhost:3002";
  const LOL_DATA_ENDPOINT = "/lol-data";

  // State to track proxy connection status
  const [proxyStatus, setProxyStatus] = useState("checking"); // checking, connected, error
  const [lastError, setLastError] = useState(null);
  const [jsonData, setJsonData] = useState(null);

  useEffect(() => {
    const getLolInput = async () => {
      const proxyUrl = PROXY_BASE_URL + LOL_DATA_ENDPOINT;
      const axiosInstance = axios.create({ timeout: 5000 });

      try {
        const response = await axiosInstance.get(proxyUrl);
        const responseData = response.data;

        if (proxyStatus !== "connected") {
          setProxyStatus("connected");
          setLastError(null);
        }
        setJsonData(responseData);

        return responseData;
      } catch (error) {
        if (
          error.code === "ECONNREFUSED" ||
          error.message.includes("Network Error")
        ) {
          setProxyStatus("error");
          setLastError("Local proxy server not running");
        } else if (error.response?.status === 503) {
          setProxyStatus("connected");
          setLastError("League of Legends client not running or not in game");
        } else {
          setProxyStatus("error");
          setLastError(`Connection error: ${error.message}`);
        }
        throw error;
      }
    };

    const sendLoLInput = async () => {
      try {
        const lolInput = await getLolInput();
        const response = await axios.post(
          localStorage.getItem("baseURL") + BACKEND_PORT + "sendLoLInput",
          lolInput
        );

      } catch (error) {
        console.error("Error sending LoL data:", error);
      }
    };

    const checkProxyStatus = async () => {
      try {
        await axios.get(PROXY_BASE_URL + "/health", { timeout: 3000 });
        setProxyStatus("connected");
      } catch (error) {
        setProxyStatus("error");
        setLastError("Local proxy server not responding");
      }
    };

    checkProxyStatus();

    const intervalId = setInterval(() => {
      sendLoLInput();
    }, 3000);

    return () => clearInterval(intervalId);
  }, [proxyStatus]);

  return (
    <div className="min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">League of Legends API Feed</h1>

      <div className="flex gap-4 h-[calc(100vh-8rem)]">
        {/* Left Column - Server Info */}
        <div className="w-1/3 flex flex-col gap-4">
          <StatusMessage status={proxyStatus} error={lastError} />
          
          <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded border border-gray-300">
            Proxy URL:{" "}
            <code className="bg-gray-200 px-1 rounded">
              {PROXY_BASE_URL + LOL_DATA_ENDPOINT}
            </code>
          </div>

          {proxyStatus === "error" && (
            <ErrorInstructions onRefresh={() => window.location.reload()} />
          )}

          {proxyStatus === "connected" && (
            <div className="flex flex-col border border-green-300 rounded p-4 bg-green-50">
              <h2 className="text-lg font-semibold mb-2 text-green-700">
                ✅ Ready to Go!
              </h2>
              <p className="text-green-600 text-sm">
                Local proxy is running and data is being fetched every 3 seconds.
                {lastError && (
                  <span className="block mt-1 text-yellow-600">
                    Note: {lastError}
                  </span>
                )}
              </p>
            </div>
          )}

          <LegacyInfo />
        </div>

        {/* Right Column - JSON Display */}
        <div className="w-2/3">
          <JsonDisplay data={jsonData} title="Live Game Data" />
        </div>
      </div>
    </div>
  );
};

export default LoLApiFeed;
