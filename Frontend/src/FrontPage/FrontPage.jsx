import { useParams } from "react-router-dom";
import NameForm from "./NameForm";
import { GAME_ID_KEY } from "../constants";

const FrontPage = () => {
  const params = useParams();
  const gameId = params.parameter;
  localStorage.setItem(GAME_ID_KEY, gameId);
  const currentDomain = "http://" + window.location.hostname;
  localStorage.setItem("baseURL", currentDomain);
  return (
    <>
      <img
        src="../bronzeIcon150.png"
        alt="bronze brawl with icon"
        className="mb-8 max-w-full h-auto"
      />
      <NameForm />
      <h1>Game ID: {gameId}</h1>
    </>
  );
};
export default FrontPage;
