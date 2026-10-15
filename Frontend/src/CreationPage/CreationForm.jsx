import axios from "axios";
import { useRef, useState } from "react";
import { Button, Input } from "react-daisyui";
import { BACKEND_PORT, GAME_ID_KEY, GAME_VERSION_KEY } from "../constants";
import { hostTokenKey, isJsonObject, writeActiveSession } from "../api";

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const validateGameResponse = (data) => {
  if (!isJsonObject(data)) throw new Error("Invalid game response: expected JSON.");
  if (!isPositiveInteger(data.gameId)) throw new Error("Invalid game response: game ID is missing.");
  if (typeof data.hostToken !== "string" || data.hostToken.trim() === "") {
    throw new Error("Invalid game response: host capability is missing.");
  }
  const settings = data.settings || data;
  if (![settings.punishmentAmount, settings.rewardAmount, settings.defaultCounter ?? data.defaultRotationCounter]
    .every(isPositiveInteger)) {
    throw new Error("Invalid game response: game settings are incomplete.");
  }
  if (settings.rotationMode !== "Kills" && settings.rotationMode !== "Deaths") {
    throw new Error("Invalid game response: rotation mode is missing.");
  }
  return {
    ...data,
    gameId: data.gameId,
    punishmentAmount: settings.punishmentAmount,
    rewardAmount: settings.rewardAmount,
    defaultRotationCounter: settings.defaultCounter ?? data.defaultRotationCounter,
    rotationMode: settings.rotationMode,
  };
};

const CreationForm = ({ setGameId, currentDomain }) => {
  const [punishmentAmount, setPunishmentAmount] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rotationMode, setRotationMode] = useState("Kills");
  const [defaultCounter, setDefaultCounter] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pendingRef = useRef(false);

  const handleSubmit = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const versionResponse = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json", { timeout: 5000 });
      const currentVersion = Array.isArray(versionResponse.data) && typeof versionResponse.data[0] === "string"
        ? versionResponse.data[0]
        : null;
      if (!currentVersion) throw new Error("Invalid game version response.");

      const response = await axios.get(`${currentDomain.replace(/\/$/, "")}${BACKEND_PORT}runGame`, {
        timeout: 5000,
        params: { punishmentAmount, rewardAmount, rotationMode, defaultCounter },
      });
      const game = validateGameResponse(response.data);
      const gameId = game.gameId;

      localStorage.setItem(GAME_ID_KEY, String(gameId));
      localStorage.setItem(GAME_VERSION_KEY, currentVersion);
      localStorage.setItem("punishmentAmount", String(game.punishmentAmount));
      localStorage.setItem("rewardAmount", String(game.rewardAmount));
      localStorage.setItem("rotationMode", game.rotationMode);
      localStorage.setItem("defaultRotationCounter", String(game.defaultRotationCounter));
      sessionStorage.setItem(hostTokenKey(gameId), game.hostToken);
      writeActiveSession({ gameId });
      setGameId(gameId);
    } catch (requestError) {
      setError(requestError?.message || "Could not create the game.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  const numeric = (setter) => (event) => setter(event.target.value.replace(/[^0-9]/g, ""));

  return (
    <form onSubmit={(event) => { event.preventDefault(); handleSubmit(); }}>
      {error && <div role="alert" className="m-2 text-red-700">{error}</div>}
      <div className="flex flex-col w-full component-preview p-2 items-center justify-center gap-2 font-sans">
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="punishmentAmount"><span className="label-text text-black">Amount per Punishment</span></label>
          <Input id="punishmentAmount" type="text" value={punishmentAmount} onChange={numeric(setPunishmentAmount)} />
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="rewardAmount"><span className="label-text text-black">Amount per Reward</span></label>
          <Input id="rewardAmount" type="text" value={rewardAmount} onChange={numeric(setRewardAmount)} />
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="options"><span className="label-text text-black">Choose Rotation Mode</span></label>
          <select id="options" value={rotationMode} onChange={(event) => setRotationMode(event.target.value)} className="appearance-none border border-black rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline">
            <option value="Kills">Kills</option>
            <option value="Deaths">Deaths</option>
          </select>
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="defaultCounter"><span className="label-text text-black">Kills/Deaths until Rotation</span></label>
          <Input id="defaultCounter" type="text" value={defaultCounter} onChange={numeric(setDefaultCounter)} />
        </div>
      </div>
      <Button type="submit" wide="true" color="primary" disabled={pending} className="m-8 border border-black">
        {pending ? "CREATING..." : "CREATE"}
      </Button>
    </form>
  );
};

export { validateGameResponse };
export default CreationForm;
