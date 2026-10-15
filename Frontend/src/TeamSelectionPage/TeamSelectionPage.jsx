import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "react-daisyui";
import Team from "./Team";
import api, { getGameId, getPlayerId } from "../api";
import { usePolling } from "../useRequest";
import title from "../PickYourTeam.png";

const TeamSelectionPage = () => {
  const [roster, setRoster] = useState({ teams: [], players: { blue: [], red: [] } });
  const [editModeOn, setEditModeOn] = useState(false);
  const navigate = useNavigate();
  const memberOf = data => {
    for (const [color, name] of [[0, "blue"], [1, "red"]]) {
      const player = data.players[name].find(row => row.playerId === Number(getPlayerId()));
      if (player) return { ...player, team: data.teams.find(team => team.teamName === color) };
    }
    return null;
  };
  const { error, retry } = usePolling(async signal => {
    const { data } = await api.get("getTeams", { params: { id: getGameId() }, signal });
    if (signal.aborted) return;
    if (!Array.isArray(data?.teams) || !Array.isArray(data.players?.blue) || !Array.isArray(data.players?.red)) throw new Error("Invalid roster");
    setRoster(data);
    const member = memberOf(data);
    if (member?.team) localStorage.setItem("teamId", member.team.teamId);
    else localStorage.removeItem("teamId");
    if (member?.champion) navigate("/status", { replace: true });
  });
  const member = memberOf(roster);
  return <>
    <img src={title} alt="pick your team" />
    {error && <p role="alert">{error} <button onClick={retry}>Retry</button></p>}
    <div className="grid grid-cols-2 w-full">
      {[0, 1].map(color => <Team key={color} teamInfo={roster.teams.find(team => team.teamName === color)}
        players={color === 0 ? roster.players.blue : roster.players.red} member={member} editModeOn={editModeOn} onSuccess={retry} />)}
    </div>
    <Button className="m-8" color="primary" disabled={!member?.team || Boolean(error) || roster.teams.length !== 2} onClick={() => navigate("/champion")}>READY</Button>
    <Button onClick={() => setEditModeOn(value => !value)}>{editModeOn ? "Finish editing" : "Edit membership"}</Button>
  </>;
};
export default TeamSelectionPage;
