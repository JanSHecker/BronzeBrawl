import api from '../api';
import { useAction } from '../useRequest';
import StatusIcon from './StatusIcon';

export const remaining = punishment => punishment.recieved ? 0 : Math.max(0, punishment.remainingAmount ?? punishment.amount);

export default function PunishmentCounters({ punishments, onRefresh }) {
  const { run, loading, error } = useAction();
  return <section className="status-punishments" aria-label="Remaining punishments. Tap to subtract one.">
    {['sips', 'shots', 'chugs'].map(unit => {
      const pending = punishments.filter(item => (item.unit || 'sips') === unit && remaining(item) > 0);
      const total = pending.reduce((sum, item) => sum + remaining(item), 0);
      return <button className="status-punishment" key={unit} disabled={loading || !total}
        aria-label={`${total} ${unit} remaining. Tap to subtract one.`}
        onClick={() => run(async () => {
          const item = pending[0];
          try { await api.post('consumePunishment', { id: item.punishmentId, expectedRemaining: remaining(item) }); }
          finally { await onRefresh(); }
        })}>
        <StatusIcon name={unit} /><strong aria-live="polite" aria-atomic="true">{total}</strong><span>{unit}</span>
      </button>;
    })}
    {error && <p className="status-action-error" role="alert">{error}</p>}
  </section>;
}
