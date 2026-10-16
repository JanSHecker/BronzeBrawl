import { useState } from "react";
import { Button } from "react-daisyui";
import { inviteUrl } from "../api";
import { useAction } from "../useRequest";

const Linkbox = ({ gameCode }) => {
  const link = inviteUrl(gameCode);
  const [copied, setCopied] = useState(false);
  const { run, loading, error } = useAction();
  return <div className="flex flex-col gap-2 border rounded border-black p-2 w-full max-w-xs bg-slate-400 text-center">
    {link ? <>
      <p>Game code: <strong className="text-3xl tracking-widest">{gameCode}</strong></p>
      <a className="text-blue-600 break-all" href={link}>{link}</a>
      <Button disabled={loading} onClick={() => run(async () => { await navigator.clipboard.writeText(link); setCopied(true); })}>{copied ? "Copied!" : "Copy Link"}</Button>
      {error && <p role="alert">{error}</p>}
    </> : <p>Create a game to receive a game code and invitation link.</p>}
  </div>;
};
export default Linkbox;
