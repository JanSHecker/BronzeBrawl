export interface AllGameDataResponse {
  activePlayer: ActivePlayer;
  allPlayers: AllPlayer[];
  events: Events;
  gameData: GameData;
}

export interface ActivePlayer {
  error: string;
}

export interface AllPlayer {
  championName: string
  isBot: boolean
  isDead: boolean
  items: Item[]
  level: number
  position: string
  rawChampionName: string
  rawSkinName: string
  respawnTimer: number
  riotId: string
  riotIdGameName: string
  riotIdTagLine: string
  runes: Runes
  scores: Scores
  screenPositionBottom: string
  screenPositionCenter: string
  skinID: number
  skinName: string
  summonerName: string
  summonerSpells: SummonerSpells
  team: string
}

export interface Item {
  canUse: boolean;
  consumable: boolean;
  count: number;
  displayName: string;
  itemID: number;
  price: number;
  rawDescription: string;
  rawDisplayName: string;
  slot: number;
}

export interface Runes {
  keystone: Keystone;
  primaryRuneTree: PrimaryRuneTree;
  secondaryRuneTree: SecondaryRuneTree;
}

export interface Keystone {
  displayName: string;
  id: number;
  rawDescription: string;
  rawDisplayName: string;
}

export interface PrimaryRuneTree {
  displayName: string;
  id: number;
  rawDescription: string;
  rawDisplayName: string;
}

export interface SecondaryRuneTree {
  displayName: string;
  id: number;
  rawDescription: string;
  rawDisplayName: string;
}

export interface Scores {
  assists: number;
  creepScore: number;
  deaths: number;
  kills: number;
  wardScore: number;
}

export interface SummonerSpells {
  summonerSpellOne: SummonerSpellOne;
  summonerSpellTwo: SummonerSpellTwo;
}

export interface SummonerSpellOne {
  displayName: string;
  rawDescription: string;
  rawDisplayName: string;
}

export interface SummonerSpellTwo {
  displayName: string;
  rawDescription: string;
  rawDisplayName: string;
}

export interface Events {
  Events: Event[];
}

export interface Event {
  EventID: number;
  EventName: string;
  EventTime: number;
  Assisters?: string[];
  KillerName?: string;
  VictimName?: string;
  Recipient?: string;
  KillStreak?: number;
}

export interface GameData {
  gameMode: string;
  gameTime: number;
  mapName: string;
  mapNumber: number;
  mapTerrain: string;
}
