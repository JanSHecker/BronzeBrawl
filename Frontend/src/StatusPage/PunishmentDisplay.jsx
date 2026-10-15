import { Button } from "react-daisyui";
import api from "../api";
import { useAction } from "../useRequest";

const PunishmentDisplay = ({ punishmentStack = [], onSuccess }) => {
  const { run, loading, error } = useAction();
  const punishment = punishmentStack[0];
  const message = !punishment ? "You haven't received any punishments."
    : punishment.punishmentType === 1 ? `You were killed! Drink ${punishment.amount}.`
    : `You received a punishment from ${punishment.distributor?.playerName || "another player"}. Drink ${punishment.amount}!`;
  return <div className="flex flex-col bg-slate-300 gap-1 border rounded border-black p-1 text-center">
    <p>{message}</p>
    {punishment && <Button disabled={loading} onClick={() => run(async () => {
      await api.post("confirmPunishment", { id: punishment.punishmentId });
      await onSuccess?.();
    })}>Done</Button>}
    {error && <p role="alert">{error}</p>}
    <p>{punishmentStack.length} Remaining</p>
  </div>;
};
export default PunishmentDisplay;
