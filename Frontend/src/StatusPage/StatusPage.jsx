import { useEffect, useRef, useState } from "react";
import axios from "axios";
import PunishmentDisplay from "./PunishmentDisplay";
import RewardDisplay from "./RewardDisplay";
import { BACKEND_PORT, GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import ChampionRotation from "./ChampionRotation";
import { useNavigate } from "react-router-dom";

const StatusPage = () => {
  const [imgError, setImgError] = useState(false);
  const placeholderUrl = '../Champion_Placeholder.png';
  const navigate = useNavigate();
  const [kda, setKda] = useState([]);
  const [changeCounter, setChangeCounter] = useState([]);
  const [punishmentStack, setPunishmentStack] = useState([]);
  const [rewardStack, setRewardStack] = useState([]);
  const [enemyTeam, setEnemyTeam] = useState([]);

  // Get the version safely
  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  const championName = localStorage.getItem("activeChampionName");
  const imgURL = `https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${championName}.png`;

  const unfulfilledPunishments = punishmentStack.filter(
    (punishment) => !punishment.recieved
  );
  const unfullfilledRewards = rewardStack.filter(
    (reward) => !reward.distributed
  );
  // const fulfilledPunishments = punishmentStack.filter(
  //   (punishment) => !punishment.recieved
  // );

  const rotationMode = localStorage.getItem("rotationMode");

  const requestRunningRef = useRef(false);

  useEffect(() => {
    const fetchEvents = async () => {
      if (requestRunningRef.current === true) {
        return;
      }
      requestRunningRef.current = true;
      const response = await axios.get(
        localStorage.getItem("baseURL") + BACKEND_PORT + "Status",
        {
          params: {
            playerId: parseInt(localStorage.getItem("playerId")),
            championId: localStorage.getItem("activeChampionId"),
            enemyTeam: localStorage.getItem("enemyTeamId"),
          },
        }
      );
      const Allstatus = response.data;
      console.log({ Allstatus });
      console.log(localStorage.getItem("enemyTeamId"));
      setPunishmentStack(Allstatus.punishments);
      setRewardStack(Allstatus.rewards);
      setKda(Allstatus.kda);
      setChangeCounter(Allstatus.counter);
      setEnemyTeam(Allstatus.enemyTeam);
      requestRunningRef.current = false;
    };
    fetchEvents();
    const intervalId = setInterval(() => {
      fetchEvents();
    }, 100);

    // Cleanup function to clear the interval when the component unmounts
    return () => clearInterval(intervalId);
  }, []);

  return (
    <>
      <div className="flex flex-col justify-start gap-2 min-h-screen">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col text-center justify-center bg-slate-300 border border-black rounded p-1">
            <div className="relative">
              <img 
                src={imgError ? placeholderUrl : imgURL} 
                onError={() => setImgError(true)}
                alt="champion icon" 
                className="m-1"
              />
              {imgError && (
                <div className="absolute top-0 right-0 bg-red-500 text-white text-xs px-1 rounded">!</div>
              )}
            </div>
            <h1 className="m-0.5 border border-black text-sm">{`${kda[0]}/${kda[1]}/${kda[2]}`}</h1>
          </div>
          <ChampionRotation
            changeCounter={changeCounter}
            rotationMode={rotationMode}
            navigate={navigate}
          />
        </div>
        <PunishmentDisplay punishmentStack={unfulfilledPunishments} />
        <RewardDisplay
          rewardStack={unfullfilledRewards}
          enemyTeam={enemyTeam}
        />
      </div>
    </>
  );
};
export default StatusPage;
