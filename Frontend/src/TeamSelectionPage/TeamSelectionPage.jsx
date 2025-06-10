import axios from "axios";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "react-daisyui";
import Team from "./Team";
import { BACKEND_PORT, GAME_ID_KEY } from "../constants";

const TeamSelectionPage = () => {
  const [bluePlayers, setBluePlayers] = useState([]);
  const [redPlayers, setRedPlayers] = useState([]);
  const [blueID, setBlueID] = useState();
  const [redID, setRedID] = useState();
  const [team, setTeam] = useState();
  const [editModeOn, setEditModeOn] = useState(false);
  const navigate = useNavigate();

  if (localStorage.getItem("changeAllowed") === "false") {
    navigate("/status");
  }
  if (localStorage.getItem("changeAllowed") === "championOnly") {
    navigate("/champion");
  }

  // console.log({ bluePlayers }, { redPlayers });
  const handleReady = (event) => {
    event.preventDefault();
    navigate("/champion");
  };
  useEffect(() => {
    const fetchData = async () => {
      const res = await axios.get(
        localStorage.getItem("baseURL") + BACKEND_PORT + "getTeams",
        {
          params: { id: localStorage.getItem(GAME_ID_KEY) },
        }
      );

      const allPlayers = res.data.players;
      const teams = res.data.teams;
      // console.log({ Allplayers });
      const bluePlayersData = allPlayers.blue;
      const redPlayersData = allPlayers.red;

      setBluePlayers(bluePlayersData);
      setRedPlayers(redPlayersData);
      setBlueID(teams[0].teamId);
      setRedID(teams[1].teamId);
    };

    // Call fetchData immediately
    fetchData();

    // Setup interval to call fetchData every second
    const intervalId = setInterval(() => {
      fetchData();
    }, 1000);

    // Cleanup function to clear the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, []); // Empty dependency array means this effect runs once when the component mounts

  return (
    <>
      <img src="./PickYourTeam.png" alt="pick your team"></img>
      <div className="grid grid-cols-2 w-full">
        <Team
          teamNumber={blueID}
          players={bluePlayers}
          setTeam={setTeam}
          team={team}
          editModeOn={editModeOn}
        />
        <Team
          teamNumber={redID}
          players={redPlayers}
          setTeam={setTeam}
          team={team}
          editModeOn={editModeOn}
        />
      </div>
      <div className="grid grid-cols-3 items-center w-full">
        <div></div>
        <Button
          color="primary"
          className="m-8 justify-self-center"
          onClick={handleReady}
          disabled={team === undefined}
        >
          READY
        </Button>
        <EditButton
          className="justify-self-end"
          setEditModeOn={setEditModeOn}
          editModeOn={editModeOn}
        />
      </div>
    </>
  );
};
export default TeamSelectionPage;

const EditButton = ({ setEditModeOn, editModeOn }) => {
  const handleToggleEdit = (e) => {
    e.preventDefault();
    if (editModeOn) {
      setEditModeOn(false);
    } else {
      setEditModeOn(true);
    }
  };
  return (
    <Button
      shape="circle"
      size="m"
      onClick={handleToggleEdit}
      className={editModeOn ? `border border-black bg-gray-400` : ""}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-6 h-6"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
        />
      </svg>
    </Button>
  );
};
