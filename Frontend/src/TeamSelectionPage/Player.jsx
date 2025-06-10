import { Button } from "react-daisyui";
import { BACKEND_PORT, PLAYER_NAME_KEY } from "../constants";
import axios from "axios";

const Player = ({ playerName, editModeOn, id }) => {
  if (editModeOn) {
    return (
      <div className="flex items-center gap-2">
        <h1>
          {playerName}
          {playerName === localStorage.getItem(PLAYER_NAME_KEY) ? " (you)" : ""}
        </h1>
        <DeleteButton id={id} />
      </div>
    );
  } else {
    return (
      <div className="flex items-center gap-2">
        <h1 className="font-semibold">
          {playerName}
          {playerName === localStorage.getItem(PLAYER_NAME_KEY) ? " (you)" : ""}
        </h1>
      </div>
    );
  }
};
export default Player;

const DeleteButton = ({ id }) => {
  const handleDelete = async () => {
    await axios.post(
      localStorage.getItem("baseURL") + BACKEND_PORT + "deletePlayer",
      {
        id: id,
      }
    );
  };
  return (
    <Button shape="circle" size="xs" onClick={handleDelete}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </Button>
  );
};
