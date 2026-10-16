import axios from "axios";
import { API_BASE_URL, GAME_ID_KEY } from "./constants";

export const ACTIVE_SESSION_KEY = "bb:active";
export const SESSION_EVENT = "bronzebrawl:session";
export const hostTokenKey = gameId => `bb:host:${gameId}`;
export const playerTokenKey = (gameId, playerId) => `bb:player:${gameId}:${playerId}`;
export function readActiveSession() {
  try { return JSON.parse(sessionStorage.getItem(ACTIVE_SESSION_KEY)) || null; }
  catch { return null; }
}
export const writeActiveSession = session => {
  sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_EVENT));
};
export const getGameId = () => readActiveSession()?.gameId ?? localStorage.getItem(GAME_ID_KEY);
export const getPlayerId = () => readActiveSession()?.playerId ?? localStorage.getItem("playerId");
export function getPlayerToken() {
  const active = readActiveSession();
  if (active) return active.gameId && active.playerId ? sessionStorage.getItem(playerTokenKey(active.gameId, active.playerId)) : null;
  // Read-only compatibility for sessions created before per-tab capabilities.
  return localStorage.getItem("playerToken");
}
export function getHostCapability(gameId = getGameId()) {
  if (!gameId) return null;
  return sessionStorage.getItem(hostTokenKey(gameId)) || localStorage.getItem(`hostToken:${gameId}`) || null;
}
export const playerAuth = () => getPlayerToken() ? { "X-Player-Token": getPlayerToken() } : {};
export const hostAuth = token => token ? { "X-Game-Token": token } : {};
export const backendUrl = (baseUrl, endpoint) => `${(baseUrl || API_BASE_URL).replace(/\/$/, "")}/${endpoint.replace(/^\//, "")}`;
export const isJsonObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

const api = axios.create({ baseURL: `${API_BASE_URL}/`, timeout: 10000 });
api.interceptors.request.use(config => {
  const token = getPlayerToken();
  if (token) config.headers["X-Player-Token"] = token;
  return config;
});
export default api;
export { axios };

export function errorMessage(error, fallback = "Request failed. Please try again.") {
  const message = error?.response?.data?.message || error?.response?.data;
  if (typeof message === "string" && message.trim() && !message.trim().startsWith("<")) return message.trim();
  return error?.message || fallback;
}
export const validId = value => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const normalizeGameCode = value => typeof value === "string" ? value.trim().toUpperCase() : "";
export const validGameCode = value => typeof value === "string" && /^[A-Z]{4}$/.test(value);
export function validateGame(game) {
  if (!isJsonObject(game) || !validId(game.gameId) || !validGameCode(game.gameCode) || !/^[a-f0-9]{64}$/i.test(game.hostToken || "")) throw new Error("Invalid game response");
  return game;
}
export const inviteUrl = gameCode => validGameCode(gameCode) ? new URL(`/name/${gameCode}`, window.location.origin).href : "";
