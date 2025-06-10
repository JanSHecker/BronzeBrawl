import axios from "axios";
import ChampionCard from "./ChampionCard";
import { useEffect, useState } from "react";
import { BACKEND_PORT, GAME_ID_KEY } from "../constants";
import { useNavigate } from "react-router-dom";

const ChampionSelectionPage = () => {
  const navigate = useNavigate();
  const [currentTeamChampions, setCurrentTeamChampions] = useState([]);
  // console.log({ currentTeamChampions });
  if (localStorage.getItem("changeAllowed") === "false") {
    navigate("/status");
  }
  useEffect(() => {
    const fetchChampions = async () => {
      const championsUpdate = await axios.get(
        localStorage.getItem("baseURL") + BACKEND_PORT + "getAllChampions",
        {
          params: { id: localStorage.getItem(GAME_ID_KEY) },
        }
      );
      // console.log(championsUpdate);
      if (localStorage.getItem("teamId") % 2 === 1) {
        setCurrentTeamChampions(championsUpdate.data.blue);
        localStorage.setItem(
          "enemyTeam",
          JSON.stringify(championsUpdate.data.red)
        );
        localStorage.setItem(
          "enemyTeamId",
          parseInt(localStorage.getItem("teamId")) + 1
        );
        // console.log(currentTeamChampions);
      } else {
        setCurrentTeamChampions(championsUpdate.data.red);
        localStorage.setItem(
          "enemyTeam",
          JSON.stringify(championsUpdate.data.blue)
        );
        localStorage.setItem(
          "enemyTeamId",
          parseInt(localStorage.getItem("teamId")) - 1
        );
      }
    };
    fetchChampions();
    const intervalId = setInterval(async () => {
      fetchChampions();
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);
  return (
    <>
      <img src="./PickYourChampion.png" alt="pick your champion"></img>

      <div className="flex justify-center flex-wrap h-min border border-black bg-slate-300 p-2">
        {currentTeamChampions?.map((champion, index) => (
          <ChampionCard key={index} champion={champion} />
        ))}
      </div>
    </>
  );
};
export default ChampionSelectionPage;
