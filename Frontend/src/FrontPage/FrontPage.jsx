import { useParams } from "react-router-dom";
import NameForm from "./NameForm";
import { normalizeGameCode, validGameCode } from "../api";
import icon from "../bronzeIcon150.png";

const FrontPage = () => {
  const { parameter } = useParams();
  const gameCode = normalizeGameCode(parameter);
  if (!validGameCode(gameCode)) return <>
    <p role="alert">Invalid invitation. Game codes contain four letters.</p>
    <a href="/" className="underline">Enter a game code</a>
  </>;
  return (
    <>
      <img
        src={icon}
        alt="bronze brawl with icon"
        className="mb-8 max-w-full h-auto"
      />
      <NameForm key={gameCode} gameCode={gameCode} />
    </>
  );
};
export default FrontPage;
