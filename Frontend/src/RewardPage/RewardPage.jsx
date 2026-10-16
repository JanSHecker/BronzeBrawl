import { useEffect, useState } from 'react';
import api, { errorMessage, isJsonObject } from '../api';
import StatusIcon from '../StatusPage/StatusIcon';
import { choiceDescription } from '../StatusPage/rewardFormatting';
import './rewards.css';

const categories = {
  standard: { name: 'Normal / Support', icon: 'chest', description: 'Shared pool for kills, assists and turrets.' },
  revenge: { name: 'Revenge', icon: 'revenge', description: 'Each chest offers one small reward and one risky reward.' },
  epic: { name: 'Epic', icon: 'epic', description: 'Grubs, Herald, Dragon and combat milestones.' },
  legendary: { name: 'Legendary', icon: 'legendary', description: 'Baron, Elder and high combat milestones.' },
  pentakill: { name: 'Pentakill', icon: 'legendary', description: 'One fixed reward for a Pentakill.' },
  turret: { name: 'Legacy Turret', icon: 'turret', description: 'Old catalogue entries. New turret chests use the Normal pool instead.' },
};
const breaksShieldText = choice => choice.mode === 'enemy_team'
  ? 'Breaks every enemy shield' : 'Breaks target’s entire shield';

export default function RewardPage() {
  const [difficulty, setDifficulty] = useState('baseline');
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setError('');
    const load = async () => {
      try {
        const { data } = await api.get('rewardCatalog', { params: { difficulty }, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!isJsonObject(data) || !isJsonObject(data.pools) || !isJsonObject(data.conversions)
          || !Number.isFinite(data.maxShield) || !Object.values(data.pools).every(choices => Array.isArray(choices)
            && choices.every(choice => typeof choice?.id === 'string' && typeof choice?.name === 'string'))) {
          throw new Error('Invalid reward catalogue response');
        }
        setCatalog(data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      }
    };
    void load();
    return () => controller.abort();
  }, [difficulty, revision]);

  const query = search.trim().toLowerCase();
  const groups = catalog ? Object.entries(catalog.pools).sort(([a], [b]) => {
    const order = Object.keys(categories);
    return order.indexOf(a) - order.indexOf(b);
  }).map(([pool, choices]) => ({
    pool, ...categories[pool], choices: choices.filter(choice => [choice.name, choice.tier,
      ...choiceDescription(choice), choice.breaksShields && breaksShieldText(choice)].filter(Boolean).join(' ').toLowerCase().includes(query)),
  })).filter(group => group.choices.length) : [];
  const total = catalog ? Object.values(catalog.pools).reduce((sum, choices) => sum + choices.length, 0) : 0;

  return <main className="reward-catalog">
    <header className="reward-catalog-header"><h1>All rewards</h1>
      <p>Browse every reward, its effects and its risks. No game required.</p>
    </header>
    <div className="reward-catalog-controls">
      <label>Search rewards<input className="input input-bordered" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or effect…" /></label>
      <label>Difficulty<select className="select select-bordered" value={difficulty} onChange={event => setDifficulty(event.target.value)}>
        <option value="easy">Easy</option><option value="baseline">Baseline</option><option value="hard">Hard</option><option value="terror">Terror</option>
      </select></label>
    </div>
    {error ? <p role="alert">{error} <button className="btn btn-sm" onClick={() => setRevision(value => value + 1)}>Retry</button></p>
      : !catalog ? <p role="status">Loading rewards…</p> : <>
        <p className="reward-catalog-note">{total} catalogue entries · {catalog.multiplier}× difficulty · 1 shot = {catalog.conversions.shots} sips · 1 chug = {catalog.conversions.chugs} sips · Shields capped at {catalog.maxShield}.</p>
        <p className="reward-catalog-note">Amounts use the server’s current configuration. Previously opened chests keep their saved offers.</p>
        {!groups.length && <p role="status">No rewards match your search.</p>}
        {groups.map(group => <section key={group.pool} aria-labelledby={`reward-pool-${group.pool}`}>
          <div className="reward-category-heading"><h2 id={`reward-pool-${group.pool}`}><StatusIcon name={group.icon} />{group.name || group.pool}</h2><span>{group.choices.length} rewards</span></div>
          {group.description && <p className="reward-catalog-note">{group.description}</p>}
          <ul className="reward-catalog-grid">{group.choices.map(choice => <li key={choice.id}>
            <article className="reward-catalog-card" aria-labelledby={`reward-${choice.id}`}>
              <h3 id={`reward-${choice.id}`}>{choice.name}</h3>
              {choice.tier && <span className={`reward-tier reward-tier-${choice.tier}`}>{choice.tier === 'risky' ? 'Big risk' : 'Small reward'}</span>}
              <ul className="reward-effects">{choiceDescription(choice).map((line, index) => <li key={index}>{line}</li>)}</ul>
              {choice.breaksShields && <p className="reward-breaks-shields"><StatusIcon name="shieldBreak" />{breaksShieldText(choice)}</p>}
            </article>
          </li>)}</ul>
        </section>)}
      </>}
  </main>;
}
