import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "react-daisyui";
import Team from "./Team";
import { BACKEND_PORT, GAME_ID_KEY } from "../constants";
import { errorMessage } from "../api";

const TeamSelectionPage = () => {
  const [bluePlayers, setBluePlayers] = useState([]);
  const [redPlayers, setRedPlayers] = useState([]);
  const [blueID, setBlueID] = useState();
  const [redID, setRedID] = useState();
  const [selectedTeamId, setSelectedTeamId] = useState();
  const [editModeOn, setEditModeOn] = useState(false);
  const [error, setError] = useState(null);
  const requestRunningRef = useRef(false);
  const mountedRef = useRef(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem("changeAllowed") === "false") navigate("/status");
    if (localStorage.getItem("changeAllowed") === "championOnly") navigate("/champion");
  }, [navigate]);

  useEffect(() => {
    mountedRef.current = true;
    const fetchData = async () => {
      if (requestRunningRef.current || !mountedRef.current) return;
      requestRunningRef.current = true;
      try {
        const response = await axios.get(
          `${localStorage.getItem("baseURL") || ""}${BACKEND_PORT}getTeams`,
          { timeout: 5000, params: { id: localStorage.getItem(GAME_ID_KEY) } },
        );
        const data = response.data || {};
        const players = data.players || {};
        const teams = Array.isArray(data.teams) ? data.teams : [];
        if (!mountedRef.current) return;
        const blue = teams.find((team) => Number(team.teamName) === 0);
        const red = teams.find((team) => Number(team.teamName) === 1);
        const nextBluePlayers = Array.isArray(players.blue) ? players.blue : [];
        const nextRedPlayers = Array.isArray(players.red) ? players.red : [];
        setBluePlayers(nextBluePlayers);
        setRedPlayers(nextRedPlayers);
        setBlueID(blue?.teamId);
        setRedID(red?.teamId);
        const currentId = Number(localStorage.getItem("playerId"));
        const currentTeam = nextBluePlayers.some((player) => Number(player.playerId) === currentId)
          ? blue?.teamId
          : nextRedPlayers.some((player) => Number(player.playerId) === currentId)
            ? red?.teamId
            : undefined;
        setSelectedTeamId(currentTeam);
        if (currentTeam !== undefined) localStorage.setItem("teamId", String(currentTeam));
        else localStorage.removeItem("teamId");
        setError(null);
      } catch (requestError) {
        if (mountedRef.current) setError(errorMessage(requestError, "Team list update failed; retrying."));
      } finally {
        requestRunningRef.current = false;
      }
    };
    fetchData();
    const intervalId = window.setInterval(fetchData, 1000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const handleReady = (event) => {
    event.preventDefault();
    if (selectedTeamId !== undefined) navigate("/champion");
  };
  const handleJoined = (teamId) => setSelectedTeamId(teamId);

  return (
    <>
      {error && <div role="alert" className="m-2 text-red-700">{error}</div>}
      <img src="./PickYourTeam.png" alt="pick your team" />
      <div className="grid grid-cols-2 w-full">
        <Team teamId={blueID} teamName={0} players={bluePlayers} selectedTeamId={selectedTeamId} onJoined={handleJoined} editModeOn={editModeOn} />
        <Team teamId={redID} teamName={1} players={redPlayers} selectedTeamId={selectedTeamId} onJoined={handleJoined} editModeOn={editModeOn} />
      </div>
      <div className="grid grid-cols-3 items-center w-full">
        <div></div>
        <Button color="primary" className="m-8 justify-self-center" onClick={handleReady} disabled={selectedTeamId === undefined}>READY</Button>
        <EditButton setEditModeOn={setEditModeOn} editModeOn={editModeOn} />
      </div>
    </>
  );
};

const EditButton = ({ setEditModeOn, editModeOn }) => (
  <Button shape="circle" size="m" onClick={(event) => { event.preventDefault(); setEditModeOn(!editModeOn); }} className={editModeOn ? "border border-black bg-gray-400" : ""}>
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
  </Button>
);

export default TeamSelectionPage;
