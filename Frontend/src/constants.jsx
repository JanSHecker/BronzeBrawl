const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
export const API_BASE_URL = (configuredApiBaseUrl || "/api").replace(/\/$/, "");

//serverports
export const BACKEND_PORT = "/";
export const FRONTEND_PORT = ":5173/";

//localstorage Keys
export const GAME_ID_KEY = "GameID";
export const REWARD_KEY = "rewardAmount";
export const PLAYER_NAME_KEY = "playerName";

//punishment Types
export const DEATH_PUNISHMENT = 1;
export const DISTRIBUTED_PUNISHMENT = 2;

//Teamnames
export const TEAMBLUE = "Team Blue";
export const TEAMRED = "Team Red";

//Game Version
export const GAME_VERSION_KEY = "gameVersion";
export const DEFAULT_GAME_VERSION = "13.24.1"; // fallback version
