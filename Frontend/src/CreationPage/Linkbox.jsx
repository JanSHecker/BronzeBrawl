import { useState } from "react";
import { Button } from "react-daisyui";
import { inviteUrl } from "../api";
import { useAction } from "../useRequest";

const Linkbox = ({ gameId }) => {
  const link = inviteUrl(gameId);
  const [isCopied, setIsCopied] = useState(false);
  const { run, loading, error } = useAction();
  return (
    <div className="flex flex-col gap-2 border rounded border-black p-2 w-full max-w-xs bg-slate-400 text-center">
      {link ? <>
        <a className="text-blue-600 break-all" href={link}>{link}</a>
        <Button disabled={loading} onClick={() => run(async () => {
          await navigator.clipboard.writeText(link);
          setIsCopied(true);
        })}>{isCopied ? "Copied!" : "Copy Link"}</Button>
        {error && <p role="alert">{error}</p>}
      </> : <h1>You first need to create a game to receive a link!</h1>}
    </div>
  );
};
export default Linkbox;
