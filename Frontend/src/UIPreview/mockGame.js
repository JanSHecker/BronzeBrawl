// This adapter is installed only by the standalone preview entry point.
// Every action stays in this document's memory, including unsupported requests.
export function createPreviewGame() {
  const status = {
    player: { playerId: 1, playerName: 'Alex', shield: 2 },
    champion: { championId: 1, championName: 'Yasuo' },
    kda: [8, 5, 12],
    punishments: [
      { punishmentId: 1, amount: 4, remainingAmount: 4, unit: 'sips', recieved: false },
      { punishmentId: 2, amount: 1, remainingAmount: 1, unit: 'shots', recieved: false },
    ],
    rewards: ['standard', 'standard', 'support', 'epic', 'legendary', 'pentakill'].map((chestType, index) => ({
      rewardId: index + 1, chestType, amount: 2, distributed: false, openedAt: null, choices: null,
    })),
    recipients: [
      { playerId: 2, playerName: 'Sam', shield: 0, champion: { championName: 'Garen' } },
      { playerId: 3, playerName: 'Jamie', shield: 0, champion: { championName: 'Ahri' } },
    ],
    chestProgress: [
      { key: 'kills', current: 0, target: 1 },
      { key: 'assists', current: 1, target: 2 },
      { key: 'revenge', current: 2, target: 3 },
      { key: 'turret', current: 0, target: 1 },
      { key: 'epic', current: 2, target: 3 },
      { key: 'legendary', current: 0, target: 1 },
    ],
  };
  const snapshot = () => structuredClone(status);
  const adapter = async config => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data || {};
    const endpoint = config.url.replace(/^\//, '');
    let data;
    if (endpoint === 'consumePunishment') {
      const punishment = status.punishments.find(item => item.punishmentId === body.id);
      if (!punishment || punishment.remainingAmount <= 0) throw new Error('No punishment remaining in this preview.');
      punishment.remainingAmount--;
      punishment.recieved = punishment.remainingAmount === 0;
      data = punishment;
    } else {
      const chest = status.rewards.find(item => item.rewardId === body.id);
      if (!chest) throw new Error('This action is not part of the visual preview.');
      if (endpoint === 'openChest') {
        chest.openedAt = new Date().toISOString();
        chest.choices = [
          { id: 'marked', name: 'Marked', mode: 'single', tier: 'small', amounts: { sips: 2, shots: 0, chugs: 0 } },
          { id: 'shield', name: 'Shield', mode: 'self', tier: 'small', amounts: {}, shieldPoints: 2 },
        ];
      } else if (endpoint === 'chooseReward') {
        const choice = chest.choices?.find(item => item.id === body.choiceId);
        if (!choice) throw new Error('Choose a preview reward.');
        chest.distribution = {
          choiceId: choice.id, remaining: { sips: 0, shots: 0, chugs: 0, ...choice.amounts },
          targets: {}, version: 0, outcome: 'success',
        };
        if (choice.mode === 'self') {
          status.player.shield += choice.shieldPoints;
          chest.distributed = true;
        }
      } else if (endpoint === 'distributeReward') {
        const distribution = chest.distribution;
        if (!distribution || !(distribution.remaining[body.unit] > 0)) throw new Error('No preview reward remaining.');
        distribution.remaining[body.unit]--;
        distribution.version++;
        distribution.targets[body.recipientId] ||= { sips: 0, shots: 0, chugs: 0 };
        distribution.targets[body.recipientId][body.unit]++;
        distribution.lastResult = { assigned: { [body.unit]: 1 } };
        chest.distributed = Object.values(distribution.remaining).every(value => value === 0);
      } else {
        throw new Error('This action is not part of the visual preview.');
      }
      data = chest;
    }
    return { data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config };
  };
  return { snapshot, adapter };
}
