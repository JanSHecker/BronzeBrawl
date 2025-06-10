import axios from "axios";
import { useEffect, useState } from "react";
import { Button, Dropdown, Input } from "react-daisyui";
import { BACKEND_PORT, GAME_ID_KEY, GAME_VERSION_KEY } from "../constants";

const CreationForm = ({ setGameId, currentDomain }) => {
  const [punishmentAmount, setPunishmentAmount] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rotationMode, setRotationMode] = useState("Kills");
  const [defaultCounter, setDefaultCounter] = useState("");

  const handleSubmit = async () => {
    try {
      const versionResponse = await axios.get("https://ddragon.leagueoflegends.com/api/versions.json");
      const currentVersion = versionResponse.data[0];

      const res = await axios.get(currentDomain + BACKEND_PORT + "runGame", {
        params: {
          punishmentAmount: punishmentAmount,
          rewardAmount: rewardAmount,
          rotationMode: rotationMode,
          defaultCounter: defaultCounter,
        },
      });
      const game = res.data;
      console.log(game);
      setGameId(game.gameId);
      localStorage.setItem(GAME_ID_KEY, game.gameId);
      localStorage.setItem(GAME_VERSION_KEY, currentVersion);
    } catch (error) {
      console.error("Error fetching game version:", error);
    }
  };

  const handlePunish = (event) => {
    const inputValue = event.target.value;
    const numericInput = inputValue.replace(/[^0-9]/g, "");
    setPunishmentAmount(numericInput);
  };
  const handleReward = (event) => {
    const inputValue = event.target.value;
    const numericInput = inputValue.replace(/[^0-9]/g, "");
    setRewardAmount(numericInput);
  };
  const handleMode = (mode) => {
    setRotationMode(mode.target.value);
  };
  const handleCounter = (event) => {
    const inputValue = event.target.value;
    const numericInput = inputValue.replace(/[^0-9]/g, "");

    setDefaultCounter(numericInput);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="flex flex-col w-full component-preview p-2 items-center justify-center gap-2 font-sans">
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name">
            <span className="label-text text-black">Amount per Punishment</span>
          </label>
          <Input
            type="text"
            value={punishmentAmount}
            onChange={handlePunish}
            // className="bg-white"
          />
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name">
            <span className="label-text text-black">Amount per Reward</span>
          </label>
          <Input
            type="text"
            value={rewardAmount}
            onChange={handleReward}
            // className="bg-white"
          />
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name">
            <span className="label-text text-black">Choose Rotation Mode</span>
          </label>
          <select
            id="options"
            value={rotationMode}
            onChange={handleMode}
            className="appearance-none border border-black rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            // className="appearance-none border border-black rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-neutral-200"
          >
            <option value="Kills">Kills</option>
            <option value="Deaths">Deaths</option>
          </select>
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name">
            <span className="label-text text-black">
              Kills/Deaths until Rotation
            </span>
          </label>
          <Input
            type="text"
            value={defaultCounter}
            onChange={handleCounter}
            // className="bg-white"
          />
        </div>
      </div>

      <Button
        type="submit"
        wide="true"
        color="primary"
        className="m-8 border border-black text-black"
      >
        CREATE
      </Button>
    </form>
  );
};

export default CreationForm;
