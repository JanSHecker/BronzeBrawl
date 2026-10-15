import axios from "axios";
import { API_BASE_URL } from "./constants";

const api = axios.create({ baseURL: `${API_BASE_URL}/`, timeout: 10000 });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("playerToken");
  if (token) config.headers["X-Player-Token"] = token;
  return config;
});
export default api;

export function errorMessage(error) {
  const message = error.response?.data?.message;
  return typeof message === "string" ? message : error.message || "Request failed. Please try again.";
}

export function validId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function validateGame(game) {
  if (!game || !validId(game.gameId) || !/^[a-f0-9]{64}$/i.test(game.hostToken || "")) {
    throw new Error("Invalid game response");
  }
  return game;
}

export function inviteUrl(gameId) {
  return validId(gameId) ? new URL(`/name/${gameId}`, window.location.origin).href : "";
}
