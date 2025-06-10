import { useState } from "react";
import { FRONTEND_PORT } from "../constants";
import { Button } from "react-daisyui";

const Linkbox = ({ gameId }) => {
  const link = window.location.href + "name/";
  const [isCopied, setIsCopied] = useState(false);
  console.log(gameId !== "");
  const handleCopyClick = () => {
    // Create a temporary textarea element to hold the link
    const textarea = document.createElement("textarea");
    textarea.value = link + gameId;
    document.body.appendChild(textarea);

    // Select the text in the textarea
    textarea.select();
    document.execCommand("copy");

    // Remove the temporary textarea
    document.body.removeChild(textarea);

    // Set the copied state to true
    setIsCopied(true);

    // Reset the copied state after a short delay
    setTimeout(() => {
      setIsCopied(false);
    }, 1500);
  };
  if (gameId != "") {
    return (
      <div className="flex flex-col gap-2 border rounded border-black p-2 w-full max-w-xs bg-slate-400">
        {/* Explicit link */}
        <p className="m-1 text-center text-blue-600">{link + gameId}</p>
        {/* Copy button */}
        <Button className="border border-black" onClick={handleCopyClick}>
          {isCopied ? "Copied!" : "Copy Link"}
        </Button>
      </div>
    );
  } else {
    return (
      <div className="flex flex-col gap-4 border rounded border-black p-2 w-full max-w-xs bg-slate-400 text-center">
        <h1>You first need to create a game to recieve a link!</h1>
      </div>
    );
  }
};
export default Linkbox;
