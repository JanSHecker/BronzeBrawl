import { Button } from "react-daisyui";
import api, { getPlayerId, getGameId, readActiveSession, validGameCode, playerTokenKey, writeActiveSession } from "../api";
import { useAction } from "../useRequest";
import { useNavigate } from "react-router-dom";

const Player = ({ playerName, editModeOn, id, onSuccess }) => {
  const { run, loading, error } = useAction();
  const navigate = useNavigate();
  const own = id === Number(getPlayerId());
  return <div className="flex items-center gap-2">
    <h1 className="font-semibold">{playerName}{own ? " (you)" : ""}</h1>
    {editModeOn && own && <Button size="xs" disabled={loading} onClick={() => run(async () => {
      const gameId = Number(getGameId());
      const gameCode = readActiveSession()?.gameCode;
      await api.post("deletePlayer", { id });
      sessionStorage.removeItem(playerTokenKey(gameId, id));
      writeActiveSession({ gameId, ...(validGameCode(gameCode) ? { gameCode } : {}) });
      ["playerId", "playerToken", "teamId", "activeChampionId", "activeChampionName"].forEach(key => localStorage.removeItem(key));
      onSuccess?.();
      navigate(validGameCode(gameCode) ? `/name/${gameCode}` : "/");
    })}>Leave</Button>}
    {error && <p role="alert">{error}</p>}
  </div>;
};
export default Player;
