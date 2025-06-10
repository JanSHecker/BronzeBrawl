import { Button } from "react-daisyui";
import TeamTable from "./TeamTable";
import axios from "axios";
import { BACKEND_PORT, PLAYER_NAME_KEY, TEAMBLUE, TEAMRED } from "../constants";
import { useState } from "react";

const Team = ({ teamNumber, players, setTeam, team, editModeOn }) => {
  // console.log("component was reloaded", players);
  const teamIsFull = players.length === 5 ? true : false;

  let teamName;
  if (teamNumber % 2 === 1) {
    teamName = TEAMBLUE;
  } else {
    teamName = TEAMRED;
  }
  const handleJoin = (event) => {
    event.preventDefault();
    // console.log(localStorage.getItem("playerId"));
    axios.post(localStorage.getItem("baseURL") + BACKEND_PORT + "joinTeam", {
      player: localStorage.getItem("playerId"),
      team: teamNumber,
    });

    localStorage.setItem("teamId", teamNumber);
  };
  const playernames = players.map((player) => player.playerName);
  console.log(playernames);
  if (playernames.includes(localStorage.getItem(PLAYER_NAME_KEY))) {
    setTeam(teamName);
  }
  if (teamNumber === undefined) {
    return null;
  }
  return (
    <div
      className={`flex flex-col rounded items-center m-1 ${
        teamNumber % 2 === 1 ? "bg-cyan-500" : "bg-red-500"
      }`}
    >
      <div className={`m-1`}>
        <h1>{teamName}</h1>
      </div>

      <div className="w-full">
        <TeamTable
          players={players}
          setTeam={setTeam}
          editModeOn={editModeOn}
        />
      </div>

      <Button
        className="m-2"
        color="neutral"
        onClick={handleJoin}
        disabled={teamIsFull || team === teamName}
      >
        Join
      </Button>
    </div>
  );
};
export default Team;
