import { Link, useParams } from "react-router-dom";
import NameForm from "./NameForm";
import { normalizeGameCode, validGameCode } from "../api";
import EntryPage from "../components/EntryPage";

const FrontPage = () => {
  const { parameter } = useParams();
  const gameCode = parameter === undefined ? undefined : normalizeGameCode(parameter);
  if (gameCode !== undefined && !validGameCode(gameCode)) return <EntryPage>
    <p role="alert">Invalid invitation. Game codes contain four letters.</p>
    <Link to="/join" className="underline">Enter a game code</Link>
  </EntryPage>;
  return (
    <EntryPage>
      <section className="entry-panel join-panel" aria-labelledby="join-title">
        <div className="entry-heading"><h1 id="join-title">Join a game</h1><p>Your team is waiting.</p></div>
        <NameForm key={gameCode || 'manual'} gameCode={gameCode} />
      </section>
    </EntryPage>
  );
};
export default FrontPage;
