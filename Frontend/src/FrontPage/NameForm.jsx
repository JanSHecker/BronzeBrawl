import { useState } from "react";
import { Button, Input } from "react-daisyui";
import { useNavigate } from "react-router-dom";
import api, { validId, playerTokenKey, writeActiveSession } from "../api";
import { useAction } from "../useRequest";
import { GAME_ID_KEY, PLAYER_NAME_KEY } from "../constants";

const NameForm = () => {
  const [name, setName] = useState("");
  const { run, loading, error } = useAction();
  const navigate = useNavigate();
  const submit = event => {
    event.preventDefault();
    run(async () => {
      const gameId = Number(localStorage.getItem(GAME_ID_KEY));
      if (!validId(gameId) || !name.trim()) throw new Error("Invalid game or name");
      const { data: settings } = await api.get("getSettings", { params: { gameId } });
      const { data: player } = await api.post("createPlayer", { playerName: name.trim(), game: gameId });
      if (!validId(player?.playerId) || !/^[a-f0-9]{64}$/i.test(player.playerToken || "")) throw new Error("Invalid player response");
      sessionStorage.setItem(playerTokenKey(gameId, player.playerId), player.playerToken);
      writeActiveSession({ gameId, playerId: player.playerId, playerName: name.trim() });
      localStorage.removeItem("playerToken");
      localStorage.setItem("playerId", player.playerId);
      localStorage.setItem(PLAYER_NAME_KEY, name.trim());
      ["teamId", "enemyTeamId", "activeChampionId", "activeChampionName", "changeAllowed"].forEach(key => localStorage.removeItem(key));
      for (const key of ["punishmentAmount", "rewardAmount", "rotationMode", "defaultRotationCounter"]) {
        const value = settings[key] ?? settings.settings?.[key];
        if (value !== undefined) localStorage.setItem(key, value);
      }
      navigate("/team");
    });
  };
  return <form onSubmit={submit}>
    <div className="form-control w-full max-w-xs p-4">
      <label htmlFor="name">What is your name?</label>
      <Input id="name" type="text" value={name} onChange={event => setName(event.target.value)} className="bg-white" />
    </div>
    <Button disabled={loading || !name.trim()} type="submit" color="primary" wide="true" className="m-8">START</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
};
export default NameForm;
