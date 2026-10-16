import { useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../api';
import { useAction } from '../useRequest';
import { GAME_VERSION_KEY, DEFAULT_GAME_VERSION } from '../constants';
import processChampionName from '../nameAdjuster';
import placeholder from '../Champion_Placeholder.png';
import StatusIcon from './StatusIcon';
import { CHEST_TYPES, chestDefinition } from './chestTypes';
import { amountText, canTarget, choiceDescription, nextUnit, normalizedChoice } from './rewardFormatting';

function ChestPopup({ initialChest, recipients, onClose, onRefresh, ended }) {
  const [chest, setChest] = useState(initialChest);
  const [players, setPlayers] = useState(recipients);
  const [queued, setQueued] = useState([]);
  const [tapError, setTapError] = useState('');
  const [feedback, setFeedback] = useState('');
  const { run, loading, error } = useAction();
  const ref = useRef(null);
  const current = useRef(initialChest);
  const queue = useRef([]);
  const processing = useRef(false);
  const projected = useRef(null);
  const definition = chestDefinition(chest.chestType);
  const choice = chest.choices?.find(option => option.id === chest.distribution?.choiceId);
  const activeChoice = choice && normalizedChoice(choice);
  const version = localStorage.getItem(GAME_VERSION_KEY) || DEFAULT_GAME_VERSION;
  const busy = loading || queued.length > 0;
  const update = data => {
    current.current = data;
    setChest(data);
    if (data.recipients) setPlayers(data.recipients);
  };
  const predict = () => {
    const state = current.current.distribution && structuredClone(current.current.distribution);
    if (!state) return null;
    for (const item of queue.current) {
      state.remaining[item.unit]--;
      state.targets[String(item.recipientId)] ||= { sips: 0, shots: 0, chugs: 0 };
      state.targets[String(item.recipientId)][item.unit]++;
    }
    return state;
  };
  const state = predict();
  projected.current = state;
  const unit = nextUnit(state?.remaining);
  useEffect(() => setPlayers(recipients), [recipients]);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => dialog.close?.();
  }, []);

  const processQueue = async () => {
    if (processing.current) return;
    processing.current = true;
    setTapError('');
    let failed = false;
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        // Keep the exact request for safe retries after an ambiguous network failure.
        item.request ||= { id: chest.rewardId, expectedVersion: current.current.distribution.version, unit: item.unit, recipientId: item.recipientId };
        const { data } = await api.post('distributeReward', item.request);
        queue.current.shift();
        update(data);
        setQueued([...queue.current]);
        projected.current = predict();
        const result = data.distribution?.lastResult;
        if (result) setFeedback(result.shieldBroken ? 'Shield broken' : amountText(result.assigned) ? `Assigned ${amountText(result.assigned)}` : 'Blocked by shield');
      }
      await onRefresh();
    } catch (failure) {
      failed = true;
      setTapError(errorMessage(failure));
    } finally {
      processing.current = false;
      // A tap can arrive while the canonical status refresh is in flight.
      // That tap must start another drain instead of sitting in the queue forever.
      if (!failed && queue.current.length) void processQueue();
    }
  };
  const tap = player => {
    const next = projected.current || predict();
    if (tapError || ended || !canTarget(activeChoice, next, player.playerId)) return;
    const item = { recipientId: player.playerId, unit: nextUnit(next.remaining) };
    queue.current.push(item);
    projected.current = predict();
    setQueued([...queue.current]);
    void processQueue();
  };

  return <dialog ref={ref} className="status-popup" aria-labelledby="chest-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="status-popup-heading"><h2 id="chest-title"><StatusIcon name={definition.icon} />{definition.name}</h2>
      <button aria-label="Close chest" className="status-button" disabled={busy} onClick={onClose}><StatusIcon name="close" /></button></div>
    {chest.distributed ? <><div className="status-chest-result"><StatusIcon name="check" /><strong>{chest.distribution?.outcome === 'backfire' ? 'Backfired' : 'Complete'}</strong></div>
      <button className="status-button status-primary" onClick={onClose}>Done</button></>
      : !chest.openedAt ? <><div className="status-chest-cover"><StatusIcon name="chest" /></div>
        <button className="status-button status-primary" disabled={loading || ended} onClick={() => run(async () => {
          const { data } = await api.post('openChest', { id: chest.rewardId });
          update(data);
          await onRefresh();
        })}>Open</button></>
        : !chest.distribution ? <><p className="status-popup-label">Choose one. Your choice is final.</p><div className="status-choices">
          {(chest.choices || []).map(option => <button className="status-button status-choice" key={option.id} disabled={loading || ended}
            aria-label={option.name || 'Assign'} onClick={() => run(async () => {
              const { data } = await api.post('chooseReward', { id: chest.rewardId, choiceId: option.id });
              update(data);
              await onRefresh();
            })}>
            <strong>{option.name || 'Assign'}</strong>
            {option.tier && <span className={`status-risk-${option.tier}`}>{option.tier === 'risky' ? 'Big risk' : 'Small reward'}</span>}
            {choiceDescription(option).map((line, index) => <span key={index}>{line}</span>)}
            {option.breaksShields && <span className="status-shield-break"><StatusIcon name="shieldBreak" />{option.mode === 'enemy_team' ? 'Breaks every enemy shield' : 'Breaks target’s entire shield'}</span>}
          </button>)}
        </div></>
          : <>
            <div className="status-distribution-heading"><strong>{activeChoice?.name || 'Distribute'}</strong>
              <p aria-live="polite">{unit ? `Distribute ${unit} · ${state.remaining[unit]} remaining` : 'Saving…'}</p>
              <small>Tap a player · one {unit === 'sips' ? 'sip' : unit === 'shots' ? 'shot' : 'chug'} per tap</small>
              {activeChoice?.breaksShields && <span className="status-shield-break"><StatusIcon name="shieldBreak" />Breaks target’s entire shield</span>}
            </div>
            <div className="status-targets">{players.map(player => <button className="status-button status-target" key={player.playerId}
              disabled={Boolean(tapError) || ended || !canTarget(activeChoice, state, player.playerId)}
              aria-label={`Give 1 ${unit || 'unit'} to ${player.playerName}. Shield ${player.shield || 0}.`}
              onClick={() => tap(player)}>
              <img src={player.champion ? `https://static.bigbrain.gg/assets/lol/riot_static/${version}/img/champion/${processChampionName(player.champion.championName)}.png` : placeholder}
                onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = placeholder; }} alt="" />
              <span><strong>{player.playerName}</strong><small>{player.champion?.championName || 'Choosing champion'}</small></span>
              <span className="status-shield-badge" aria-hidden="true"><StatusIcon name="shield" /><b>{player.shield || 0}</b></span>
            </button>)}</div>
            {!players.length && <p>Waiting for opponents to join.</p>}
          </>}
    {feedback && <p className="status-tap-feedback" role="status">{feedback}</p>}
    {(error || tapError) && <p role="alert" className="status-popup-error">{error || tapError}</p>}
    {tapError && <button className="status-button status-primary" onClick={() => void processQueue()}>Retry tap</button>}
  </dialog>;
}

export default function ChestInventory({ rewards = [], enemyTeam = [], recipients, onRefresh, ended = false }) {
  const [selected, setSelected] = useState(null);
  const opener = useRef(null);
  const pending = rewards.filter(item => !item.distributed);
  const types = CHEST_TYPES.filter(type => type.type !== 'pentakill' || pending.some(item => item.chestType === 'pentakill'));
  const players = recipients || enemyTeam.filter(champion => champion.player).map(champion => ({ ...champion.player, champion }));
  return <section className="status-panel status-chests" aria-labelledby="chests-title">
    <div className="status-section-heading"><h2 id="chests-title">Chests</h2><span>{pending.length} available</span></div>
    <div className={`status-inventory${types.length > 6 ? ' status-inventory-pentakill' : ''}`}>{types.map(type => {
      const items = pending.filter(item => (item.chestType || 'standard') === type.type);
      return <button key={type.type} className={`status-chest status-chest-${type.type}`} disabled={!items.length || ended}
        aria-label={`${type.name} chest, ${items.length} available`} title={type.name}
        onClick={event => { opener.current = event.currentTarget; setSelected(items.find(item => item.distribution) || items[0]); }}>
        <StatusIcon name="chest" /><span>{type.short}</span><strong>×{items.length}</strong>
        {items.some(item => item.openedAt) && <i className="status-saved" />}
      </button>;
    })}</div>
    {selected && <ChestPopup initialChest={selected} recipients={players} ended={ended} onRefresh={onRefresh} onClose={() => {
      setSelected(null);
      opener.current?.focus();
    }} />}
  </section>;
}
