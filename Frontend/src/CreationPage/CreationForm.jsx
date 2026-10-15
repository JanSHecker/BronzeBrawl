import axios from "axios";
import { useState } from "react";
import { Button, Input } from "react-daisyui";
import { GAME_ID_KEY, GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import api, { validateGame } from "../api";
import { useAction } from "../useRequest";

const CreationForm = ({ setGameId }) => {
  const [punishmentAmount, setPunishmentAmount] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rotationMode, setRotationMode] = useState("Kills");
  const [defaultCounter, setDefaultCounter] = useState("");
  const { run, loading, error } = useAction();

  const handleSubmit = async () => {
    await run(async () => {
      if (![punishmentAmount, rewardAmount, defaultCounter].every(value => /^[1-9]\d*$/.test(value) && Number(value) <= 100)) {
        throw new Error("Settings must be integers between 1 and 100");
      }
      const res = await api.get("runGame", {
        params: {
          punishmentAmount: punishmentAmount,
          rewardAmount: rewardAmount,
          rotationMode: rotationMode,
          defaultCounter: defaultCounter,
        },
      });
      const game = validateGame(res.data);
      localStorage.setItem(`hostToken:${game.gameId}`, game.hostToken);
      localStorage.setItem("hostGameId", game.gameId);
      setGameId(game.gameId);
      localStorage.setItem(GAME_ID_KEY, game.gameId);
      // A cosmetic third-party outage must not prevent a lobby from being created.
      localStorage.setItem(GAME_VERSION_KEY, DEFAULT_GAME_VERSION);
      axios.get("https://ddragon.leagueoflegends.com/api/versions.json", { timeout: 3000 })
        .then(({ data }) => { if (Array.isArray(data) && typeof data[0] === "string") localStorage.setItem(GAME_VERSION_KEY, data[0]); })
        .catch(() => {});
    });
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
          <label className="label" htmlFor="punishment-amount">
            <span className="label-text text-black">Amount per Punishment</span>
          </label>
          <Input
            id="punishment-amount"
            type="text"
            value={punishmentAmount}
            onChange={handlePunish}
            // className="bg-white"
          />
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="reward-amount">
            <span className="label-text text-black">Amount per Reward</span>
          </label>
          <Input
            id="reward-amount"
            type="text"
            value={rewardAmount}
            onChange={handleReward}
            // className="bg-white"
          />
        </div>
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="options">
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
          <label className="label" htmlFor="rotation-counter">
            <span className="label-text text-black">
              Kills/Deaths until Rotation
            </span>
          </label>
          <Input
            id="rotation-counter"
            type="text"
            value={defaultCounter}
            onChange={handleCounter}
            // className="bg-white"
          />
        </div>
      </div>

      <Button
        disabled={loading}
        type="submit"
        wide="true"
        color="primary"
        className="m-8 border border-black text-black"
      >
        CREATE
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
};

export default CreationForm;
