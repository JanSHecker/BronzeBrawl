import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAction } from '../useRequest';
import StatusIcon from './StatusIcon';
import { CHEST_TYPES, chestDefinition } from './chestTypes';

function ChestPopup({ initialChest, enemyTeam, onClose, onRefresh }) {
  const [chest, setChest] = useState(initialChest);
  const [choice, setChoice] = useState(null);
  const [target, setTarget] = useState(null);
  const [resolved, setResolved] = useState(false);
  const { run, loading, error } = useAction();
  const ref = useRef(null);
  const definition = chestDefinition(chest.chestType);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => dialog.close?.();
  }, []);
  return <dialog ref={ref} className="status-popup" aria-labelledby="chest-title"
    onCancel={event => { event.preventDefault(); if (!loading) onClose(); }}>
    <div className="status-popup-heading"><h2 id="chest-title"><StatusIcon name={definition.icon} />{definition.name}</h2>
      <button aria-label="Close chest" className="status-button" disabled={loading} onClick={onClose}><StatusIcon name="close" /></button></div>
    {resolved ? <><div className="status-chest-result"><StatusIcon name="check" /><strong>Assigned</strong></div><button className="status-button status-primary" onClick={onClose}>Done</button></>
      : !chest.openedAt ? <><div className="status-chest-cover"><StatusIcon name="chest" /></div>
        <button className="status-button status-primary" disabled={loading} onClick={() => run(async () => {
          const { data } = await api.post('openChest', { id: chest.rewardId });
          setChest(data);
          await onRefresh();
        })}>Open</button></>
      : !choice ? <><p className="status-popup-label">Choose</p><div className="status-choices">
        {(chest.choices || []).map(option => <button className="status-button status-choice" key={option.id} onClick={() => setChoice(option)}>
          <StatusIcon name={option.unit} /><strong>{option.amount}</strong><span>Assign {option.unit}</span>
        </button>)}
      </div></>
      : <><p className="status-popup-label">{choice.amount} {choice.unit} → opponent</p>
        <div className="status-targets">{enemyTeam.filter(champion => champion.player).map(champion => <button
          className="status-button status-target" key={champion.championId} disabled={loading}
          aria-pressed={target === champion.player.playerId} onClick={() => setTarget(champion.player.playerId)}>
          <StatusIcon name="kills" /><span><strong>{champion.player.playerName}</strong><small>{champion.championName}</small></span>
        </button>)}</div>
        {!enemyTeam.some(champion => champion.player) && <p>No opponents have selected a champion yet.</p>}
        <button className="status-button status-primary" disabled={loading || !target} onClick={() => run(async () => {
          await api.post('confirmReward', { id: chest.rewardId, choiceId: choice.id, punishment: { recipient: { playerId: target } } });
          setResolved(true);
          await onRefresh();
        })}>Confirm</button>
        <button className="status-button status-back" disabled={loading} onClick={() => { setChoice(null); setTarget(null); }}>Back</button></>}
    {error && <p role="alert" className="status-popup-error">{error}</p>}
  </dialog>;
}

export default function ChestInventory({ rewards, enemyTeam, onRefresh }) {
  const [selected, setSelected] = useState(null);
  const opener = useRef(null);
  const pending = rewards.filter(item => !item.distributed);
  return <section className="status-panel status-chests" aria-labelledby="chests-title">
    <div className="status-section-heading"><h2 id="chests-title">Chests</h2><span>{pending.length} available</span></div>
    <div className="status-inventory">{CHEST_TYPES.map(type => {
      const items = pending.filter(item => (item.chestType || 'standard') === type.type);
      return <button key={type.type} className={`status-chest status-chest-${type.type}`} disabled={!items.length}
        aria-label={`${type.name} chest, ${items.length} available`} title={type.name}
        onClick={event => { opener.current = event.currentTarget; setSelected(items[0]); }}>
        <StatusIcon name="chest" /><span>{type.short}</span><strong>×{items.length}</strong>
        {items.some(item => item.openedAt) && <i className="status-saved" />}
      </button>;
    })}</div>
    {selected && <ChestPopup initialChest={selected} enemyTeam={enemyTeam} onRefresh={onRefresh} onClose={() => {
      setSelected(null);
      opener.current?.focus();
    }} />}
  </section>;
}
