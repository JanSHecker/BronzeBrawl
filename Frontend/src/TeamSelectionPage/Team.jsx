import { useRef, useState } from "react";
import { Button } from "react-daisyui";
import TeamTable from "./TeamTable";
import axios from "axios";
import { BACKEND_PORT, TEAMBLUE, TEAMRED } from "../constants";
import { errorMessage, playerAuth } from "../api";

const Team = ({ teamId, teamName: teamType, players = [], selectedTeamId, onJoined, editModeOn }) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pendingRef = useRef(false);
  if (teamId === undefined) return null;
  const teamName = Number(teamType) === 0 ? TEAMBLUE : TEAMRED;
  const teamIsFull = players.length >= 5;
  const isSelected = Number(selectedTeamId) === Number(teamId);
  const playerNames = players.map((player) => player.playerName);
  const playerId = Number(localStorage.getItem("playerId"));
  const hasCurrentPlayer = players.some((player) => Number(player.playerId) === playerId);

  const handleJoin = async (event) => {
    event.preventDefault();
    if (pendingRef.current || teamIsFull || isSelected) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await axios.post(
        `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}joinTeam`,
        { player: playerId, team: teamId },
        { timeout: 5000, headers: playerAuth() },
      );
      localStorage.setItem("teamId", String(teamId));
      onJoined?.(teamId);
    } catch (requestError) {
      setError(errorMessage(requestError, "Could not join that team."));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className={`flex flex-col rounded items-center m-1 ${Number(teamType) === 0 ? "bg-cyan-500" : "bg-red-500"}`}>
      <div className="m-1"><h1>{teamName}</h1></div>
      <div className="w-full"><TeamTable players={players} editModeOn={editModeOn} /></div>
      {error && <div role="alert" className="text-center text-red-700">{error}</div>}
      <Button className="m-2" color="neutral" onClick={handleJoin} disabled={teamIsFull || isSelected || hasCurrentPlayer || pending}>
        {pending ? "Joining..." : "Join"}
      </Button>
      {playerNames.length === 0 && <span className="sr-only">No players</span>}
    </div>
  );
};

export default Team;
