import { useState } from "react";
import { Button, Input } from "react-daisyui";
import api, { validId } from "../api";
import { useAction } from "../useRequest";
import { useNavigate } from "react-router-dom";
import { GAME_ID_KEY, PLAYER_NAME_KEY } from "../constants";

const NameForm = () => {
  // State to store the input value
  const [name, setName] = useState("");
  const { run, loading, error } = useAction();

  const navigate = useNavigate();
  // Event handler for input changes
  const handleNameChange = (event) => {
    setName(event.target.value);
  };

  // Event handler for form submission
  const handleSubmit = async (event) => {
    event.preventDefault();
    await run(async () => {
      const gameId = Number(localStorage.getItem(GAME_ID_KEY));
      if (!validId(gameId) || !name.trim()) throw new Error("Invalid game or name");
      const { data: settings } = await api.get("getSettings", { params: { gameId } });
      setSettings(settings);
      const { data: player } = await api.post("createPlayer", { playerName: name.trim(), game: gameId });
      if (!validId(player?.playerId) || !/^[a-f0-9]{64}$/i.test(player.playerToken || "")) throw new Error("Invalid player response");
      localStorage.setItem("playerId", player.playerId);
      localStorage.setItem("playerToken", player.playerToken);
      ["teamId", "enemyTeamId", "activeChampionId", "activeChampionName"].forEach(key => localStorage.removeItem(key));
      localStorage.setItem(PLAYER_NAME_KEY, name.trim());
      navigate("/team");
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex w-full component-preview p-4 items-center justify-center gap-2 font-sans">
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name">
            <span className="label-text">What is your name?</span>
          </label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={handleNameChange}
            className="bg-white"
          />
        </div>
      </div>
      <Button disabled={loading || !name.trim()} type="submit" color="primary" wide="true" className="m-8">
        START
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
};

export default NameForm;

const setSettings = (settings) => {
  localStorage.setItem("punishmentAmount", settings.punishmentAmount);
  localStorage.setItem("rewardAmount", settings.rewardAmount);
  localStorage.setItem("rotationMode", settings.rotationMode);
  localStorage.setItem(
    "defaultRotationCounter",
    settings.defaultRotationCounter
  );
};
