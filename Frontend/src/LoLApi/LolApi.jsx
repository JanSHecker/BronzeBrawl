import { useLiveFeed } from "./LiveFeed";

const LoLApiFeed = () => {
  const { message } = useLiveFeed();
  return <div className="p-4">
    <h1 className="text-2xl font-bold mb-4">LoL Live-Feed</h1>
    <p>{message}</p>
    <p>Companion im Terminal starten. Kein Spiel verbinden, keine Schlüssel kopieren und kein Feed-Modus nötig.</p>
    <a className="underline" href="/">Zur Haupt-App</a>
  </div>;
};
export default LoLApiFeed;
