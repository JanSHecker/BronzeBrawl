import axios from "axios";
import { API_BASE_URL, BACKEND_PORT, GAME_ID_KEY } from "./constants";

export const ACTIVE_SESSION_KEY = "bb:active";
export const hostTokenKey = (gameId) => `bb:host:${gameId}`;
export const playerTokenKey = (gameId, playerId) => `bb:player:${gameId}:${playerId}`;

export const readActiveSession = () => {
  try {
    const value = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

export const writeActiveSession = (session) => {
  sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
};

export const getGameId = () => {
  const active = readActiveSession();
  return active?.gameId ?? localStorage.getItem(GAME_ID_KEY);
};

export const getPlayerToken = () => {
  const active = readActiveSession();
  const gameId = active?.gameId ?? localStorage.getItem(GAME_ID_KEY);
  const playerId = active?.playerId ?? localStorage.getItem("playerId");
  return gameId && playerId ? sessionStorage.getItem(playerTokenKey(gameId, playerId)) : null;
};

export const getHostCapability = () => {
  const active = readActiveSession();
  const gameId = active?.gameId ?? localStorage.getItem(GAME_ID_KEY);
  if (!gameId) return null;
  return sessionStorage.getItem(hostTokenKey(gameId)) || sessionStorage.getItem("bb:host") || null;
};

export const playerAuth = () => {
  const token = getPlayerToken();
  return token ? { "X-Player-Token": token } : {};
};

export const hostAuth = (token) => (token ? { "X-Game-Token": token } : {});

export const backendUrl = (baseUrl, endpoint) => {
  const base = (baseUrl || API_BASE_URL).replace(/\/$/, "");
  return `${base}${BACKEND_PORT}${endpoint.replace(/^\//, "")}`;
};

export const errorMessage = (error, fallback = "Request failed. Please try again.") => {
  const message = error?.response?.data?.message || error?.response?.data;
  if (typeof message === "string" && message.trim() && !message.trim().startsWith("<")) {
    return message.trim();
  }
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
  return fallback;
};

export const isJsonObject = (value) => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

export { axios };
