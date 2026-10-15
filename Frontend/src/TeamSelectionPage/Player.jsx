import { Button } from "react-daisyui";
import api from "../api";
import { useAction } from "../useRequest";
import { useNavigate } from "react-router-dom";

const Player = ({ playerName, editModeOn, id, onSuccess }) => {
  const { run, loading, error } = useAction();
  const navigate = useNavigate();
  const own = id === Number(localStorage.getItem("playerId"));
  return <div className="flex items-center gap-2">
    <h1 className="font-semibold">{playerName}{own ? " (you)" : ""}</h1>
    {editModeOn && own && <Button size="xs" disabled={loading} onClick={() => run(async () => {
      await api.post("deletePlayer", { id });
      ["playerId", "playerToken", "teamId", "activeChampionId", "activeChampionName"].forEach(key => localStorage.removeItem(key));
      onSuccess?.();
      navigate(`/name/${localStorage.getItem("GameID")}`);
    })}>Leave</Button>}
    {error && <p role="alert">{error}</p>}
  </div>;
};
export default Player;
