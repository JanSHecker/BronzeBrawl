import { CHEST_PROGRESS } from './chestTypes';
import StatusIcon from './StatusIcon';

export default function ChestProgress({ progress = [] }) {
  return <section className="status-panel status-progress" aria-labelledby="progress-title">
    <div className="status-section-heading"><h2 id="progress-title">Next chest</h2></div>
    <div className="status-progress-grid">{CHEST_PROGRESS.filter(type => type.key).map(type => {
      const value = progress.find(item => item.key === type.key) || { current: 0, target: type.target };
      return <div key={type.key}>
        <div className="status-progress-label"><StatusIcon name={type.icon} /><span>{type.name}</span><span>{value.current}/{value.target}</span></div>
        <div className="status-track" role="progressbar" aria-label={type.name} aria-valuenow={value.current} aria-valuemin="0" aria-valuemax={value.target}>
          <span style={{ width: `${Math.min(100, 100 * value.current / value.target)}%` }} />
        </div>
      </div>;
    })}</div>
  </section>;
}
