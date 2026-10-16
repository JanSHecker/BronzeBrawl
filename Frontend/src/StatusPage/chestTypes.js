export const CHEST_PROGRESS = [
  { type: 'standard', key: 'kills', name: 'Kills', short: 'Kills', icon: 'kills', target: 1 },
  { type: 'support', key: 'assists', name: 'Assists', short: 'Assists', icon: 'assists', target: 2 },
  { type: 'revenge', key: 'revenge', name: 'Revenge', short: 'Revenge', icon: 'revenge', target: 3 },
  { type: 'turret', key: 'turret', name: 'Turret', short: 'Turret', icon: 'turret', target: 1 },
  { type: 'epic', key: 'epic', name: 'Grubs / Herald / Dragon', short: 'G/H/D', icon: 'epic', target: 1 },
  { type: 'legendary', key: 'legendary', name: 'Baron / Elder', short: 'B/E', icon: 'legendary', target: 1 },
  { type: 'pentakill', name: 'Pentakill', short: 'Penta', icon: 'legendary' },
];

export const CHEST_TYPES = [
  { type: 'standard', name: 'Normal', short: 'Normal', icon: 'chest' },
  { type: 'support', name: 'Support', short: 'Support', icon: 'assists' },
  { type: 'revenge', name: 'Revenge', short: 'Revenge', icon: 'revenge' },
  { type: 'epic', name: 'Epic', short: 'Epic', icon: 'epic' },
  { type: 'legendary', name: 'Legendary', short: 'Legendary', icon: 'legendary' },
  { type: 'pentakill', name: 'Pentakill', short: 'Penta', icon: 'legendary' },
];

export const inventoryChestType = type => type === 'turret' ? 'standard' : type || 'standard';
export const chestDefinition = type => CHEST_TYPES.find(item => item.type === inventoryChestType(type)) || CHEST_TYPES[0];
