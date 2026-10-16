import { Button } from "react-daisyui";
import TeamTable from "./TeamTable";
import api, { getPlayerId } from "../api";
import { useAction } from "../useRequest";
import { TEAMBLUE, TEAMRED } from "../constants";

const Team = ({ teamInfo, players, member, editModeOn, onSuccess }) => {
  const { run, loading, error } = useAction();
  if (!teamInfo) return <section>Waiting for team data…</section>;
  const blue = teamInfo.teamName === 0;
  return <section className={`team-panel flex flex-col rounded items-center m-1 ${blue ? "team-panel-blue" : "team-panel-red"}`}>
    <h1>{blue ? TEAMBLUE : TEAMRED}</h1>
    <TeamTable players={players} editModeOn={editModeOn} onSuccess={onSuccess} />
    <Button className="m-2" color="neutral" disabled={loading || players.length >= 5 || member?.team?.teamId === teamInfo.teamId} onClick={() => run(async () => {
      await api.post("joinTeam", { player: Number(getPlayerId()), team: teamInfo.teamId });
      onSuccess();
    })}>Join</Button>
    {error && <p role="alert">{error}</p>}
  </section>;
};
export default Team;
