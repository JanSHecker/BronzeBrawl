import { useRef, useState } from "react";
import { Button, Input } from "react-daisyui";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { BACKEND_PORT, GAME_ID_KEY, PLAYER_NAME_KEY } from "../constants";
import { errorMessage, hostTokenKey, isJsonObject, playerTokenKey, writeActiveSession } from "../api";

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const NameForm = () => {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pendingRef = useRef(false);
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const playerName = name.trim();
    const gameId = Number(localStorage.getItem(GAME_ID_KEY));
    if (!playerName || !positiveInteger(gameId)) {
      setError("Enter a name for a valid game.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await axios.post(
        `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}createPlayer`,
        { playerName, game: gameId },
        { timeout: 5000 },
      );
      const player = response.data;
      if (!isJsonObject(player) || !positiveInteger(player.playerId) || typeof player.playerToken !== "string" || !player.playerToken) {
        throw new Error("Invalid player response.");
      }
      const settingsResponse = await axios.get(
        `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}getSettings`,
        { timeout: 5000, params: { gameId } },
      );
      const settings = settingsResponse.data?.settings || settingsResponse.data;
      if (!isJsonObject(settings)) throw new Error("Invalid game settings response.");

      localStorage.setItem("playerId", String(player.playerId));
      localStorage.setItem("changeAllowed", "true");
      localStorage.setItem(PLAYER_NAME_KEY, playerName);
      if (settings.punishmentAmount !== undefined) localStorage.setItem("punishmentAmount", String(settings.punishmentAmount));
      if (settings.rewardAmount !== undefined) localStorage.setItem("rewardAmount", String(settings.rewardAmount));
      if (settings.rotationMode !== undefined) localStorage.setItem("rotationMode", settings.rotationMode);
      if (settings.defaultCounter !== undefined) localStorage.setItem("defaultRotationCounter", String(settings.defaultCounter));
      sessionStorage.setItem(playerTokenKey(gameId, player.playerId), player.playerToken);
      const hostToken = sessionStorage.getItem(hostTokenKey(gameId));
      writeActiveSession({ gameId, playerId: player.playerId, playerName });
      if (hostToken) sessionStorage.setItem(hostTokenKey(gameId), hostToken);
      navigate("/team");
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not join the game."));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div role="alert" className="m-2 text-red-700">{error}</div>}
      <div className="flex w-full component-preview p-4 items-center justify-center gap-2 font-sans">
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name"><span className="label-text">What is your name?</span></label>
          <Input id="name" type="text" value={name} onChange={(event) => setName(event.target.value)} className="bg-white" />
        </div>
      </div>
      <Button type="submit" color="primary" wide="true" disabled={pending} className="m-8">{pending ? "STARTING..." : "START"}</Button>
    </form>
  );
};

export default NameForm;
