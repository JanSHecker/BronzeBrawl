import { useEffect, useMemo, useState } from "react";
import { Button } from "react-daisyui";

export const buildInviteUrl = (gameId, location = window.location) => {
  if (!Number.isSafeInteger(Number(gameId)) || Number(gameId) <= 0) return "";
  const encodedId = encodeURIComponent(String(gameId));
  return new URL(`/name/${encodedId}`, location.origin).toString();
};

const Linkbox = ({ gameId }) => {
  const link = useMemo(() => buildInviteUrl(gameId), [gameId]);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => () => setIsCopied(false), []);

  const handleCopyClick = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1500);
    } catch {
      setIsCopied(false);
    }
  };

  if (link) {
    return (
      <div className="flex flex-col gap-2 border rounded border-black p-2 w-full max-w-xs bg-slate-400">
        <p className="m-1 text-center text-blue-600">{link}</p>
        <Button className="border border-black" onClick={handleCopyClick}>{isCopied ? "Copied!" : "Copy Link"}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 border rounded border-black p-2 w-full max-w-xs bg-slate-400 text-center">
      <h1>You first need to create a game to receive a link!</h1>
    </div>
  );
};

export default Linkbox;
