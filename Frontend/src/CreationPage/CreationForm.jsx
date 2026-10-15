import axios from "axios";
import { useState } from "react";
import { Button, Input } from "react-daisyui";
import { GAME_ID_KEY, GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from "../constants";
import api, { validateGame, hostTokenKey, writeActiveSession } from "../api";
import { useAction } from "../useRequest";

const CreationForm = ({ setGameId }) => {
  const [punishmentAmount, setPunishmentAmount] = useState("");
  const [rewardAmount, setRewardAmount] = useState("");
  const [rotationMode, setRotationMode] = useState("Kills");
  const [defaultCounter, setDefaultCounter] = useState("");
  const { run, loading, error } = useAction();
  const submit = () => run(async () => {
    if (![punishmentAmount, rewardAmount, defaultCounter].every(value => /^[1-9]\d*$/.test(value) && Number(value) <= 100)) throw new Error("Settings must be integers between 1 and 100");
    const { data } = await api.get("runGame", { params: { punishmentAmount, rewardAmount, rotationMode, defaultCounter } });
    const game = validateGame(data);
    sessionStorage.setItem(hostTokenKey(game.gameId), game.hostToken);
    writeActiveSession({ gameId: game.gameId });
    localStorage.setItem(GAME_ID_KEY, game.gameId);
    setGameId(game.gameId);
    localStorage.setItem(GAME_VERSION_KEY, DEFAULT_GAME_VERSION);
    axios.get("https://ddragon.leagueoflegends.com/api/versions.json", { timeout: 3000 })
      .then(({ data: versions }) => { if (Array.isArray(versions) && typeof versions[0] === "string") localStorage.setItem(GAME_VERSION_KEY, versions[0]); })
      .catch(() => {});
  });
  const numeric = setter => event => setter(event.target.value.replace(/[^0-9]/g, ""));
  return <form onSubmit={event => { event.preventDefault(); submit(); }}>
    <div className="flex flex-col w-full component-preview p-2 items-center justify-center gap-2 font-sans">
      <div className="form-control w-full max-w-xs">
        <label htmlFor="punishmentAmount">Amount per Punishment</label>
        <Input id="punishmentAmount" type="text" value={punishmentAmount} onChange={numeric(setPunishmentAmount)} />
      </div>
      <div className="form-control w-full max-w-xs">
        <label htmlFor="rewardAmount">Amount per Reward</label>
        <Input id="rewardAmount" type="text" value={rewardAmount} onChange={numeric(setRewardAmount)} />
      </div>
      <div className="form-control w-full max-w-xs">
        <label htmlFor="rotationMode">Choose Rotation Mode</label>
        <select id="rotationMode" value={rotationMode} onChange={event => setRotationMode(event.target.value)}>
          <option value="Kills">Kills</option><option value="Deaths">Deaths</option>
        </select>
      </div>
      <div className="form-control w-full max-w-xs">
        <label htmlFor="defaultCounter">Kills/Deaths until Rotation</label>
        <Input id="defaultCounter" type="text" value={defaultCounter} onChange={numeric(setDefaultCounter)} />
      </div>
    </div>
    <Button disabled={loading} type="submit" wide="true" color="primary" className="m-8 border border-black text-black">CREATE</Button>
    {error && <p role="alert">{error}</p>}
  </form>;
};
export { validateGame as validateGameResponse };
export default CreationForm;
