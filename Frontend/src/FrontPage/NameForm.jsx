import { useState } from "react";
import { Button, Input } from "react-daisyui";
import { useNavigate } from "react-router-dom";
import api, { validId, normalizeGameCode, validGameCode, playerTokenKey, writeActiveSession } from "../api";
import { useAction } from "../useRequest";
import { PLAYER_NAME_KEY } from "../constants";

const NameForm = ({ gameCode }) => {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const targetCode = normalizeGameCode(gameCode ?? code);
  const { run, loading, error } = useAction();
  const navigate = useNavigate();
  const submit = event => {
    event.preventDefault();
    run(async () => {
      const playerName = name.trim();
      if (!validGameCode(targetCode) || !playerName) throw new Error("Enter a four-letter game code and your name.");
      const { data: settings } = await api.get("getSettings", { params: { gameCode: targetCode } });
      const gameId = settings?.gameId;
      if (!validId(gameId) || settings.gameCode !== targetCode) throw new Error("Invalid game response");
      const { data: player } = await api.post("createPlayer", { playerName, gameCode: targetCode });
      if (player?.game !== gameId || !validId(player?.playerId) || !/^[a-f0-9]{64}$/i.test(player.playerToken || "")) throw new Error("Invalid player response");
      sessionStorage.setItem(playerTokenKey(gameId, player.playerId), player.playerToken);
      writeActiveSession({ gameId, gameCode: targetCode, playerId: player.playerId, playerName });
      localStorage.removeItem("playerToken");
      localStorage.setItem("playerId", player.playerId);
      localStorage.setItem(PLAYER_NAME_KEY, playerName);
      ["teamId", "enemyTeamId", "activeChampionId", "activeChampionName", "changeAllowed"].forEach(key => localStorage.removeItem(key));
      for (const key of ["punishmentAmount", "rewardAmount"]) {
        const value = settings[key] ?? settings.settings?.[key];
        if (value !== undefined) localStorage.setItem(key, value);
      }
      navigate("/team");
    });
  };
  return <form className="entry-form" onSubmit={submit}>
    <div className="form-control">
      <label htmlFor="game-code">Game code</label>
      <Input id="game-code" type="text" value={gameCode ?? code} readOnly={gameCode !== undefined} disabled={loading} onChange={event => setCode(event.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="KFRW" className="entry-game-code" />
      <p className="field-help">Four letters from your host.</p>
    </div>
    <div className="form-control">
      <label htmlFor="name">What is your name?</label>
      <Input id="name" type="text" value={name} disabled={loading} onChange={event => setName(event.target.value)} autoComplete="given-name" />
    </div>
    <Button disabled={loading || !validGameCode(targetCode) || !name.trim()} type="submit" color="primary" className="entry-action">START</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
};
export default NameForm;
