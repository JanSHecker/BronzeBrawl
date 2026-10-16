import { useState } from "react";
import { Button } from "react-daisyui";
import { inviteUrl } from "../api";
import { useAction } from "../useRequest";

const Linkbox = ({ gameCode }) => {
  const link = inviteUrl(gameCode);
  const [copied, setCopied] = useState(false);
  const { run, loading, error } = useAction();
  return <div className="invitation">
    {link ? <>
      <div className="invitation-heading"><p>Game code: <strong>{gameCode}</strong></p>
      <Button size="sm" disabled={loading} onClick={() => run(async () => { await navigator.clipboard.writeText(link); setCopied(true); })}>{copied ? "Copied!" : "Copy Link"}</Button></div>
      <a className="invitation-link" href={link}>{link}</a>
      {error && <p role="alert">{error}</p>}
    </> : <p>Create a game to receive a game code and invitation link.</p>}
  </div>;
};
export default Linkbox;
