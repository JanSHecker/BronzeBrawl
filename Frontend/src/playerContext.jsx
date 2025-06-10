// PlayerContext.js
import React, { createContext, useState, useContext, useEffect } from "react";

const PlayerContext = createContext();

export const PlayerProvider = ({ children }) => {
  const [playerId, setPlayerIdState] = useState(() => {
    // Initialize the state with the value from local storage, or null if it's not present
    return localStorage.getItem("playerId") || null;
  });

  const setPlayerId = (newPlayerId) => {
    localStorage.setItem("playerId", newPlayerId);
    setPlayerIdState(newPlayerId);
  };

  useEffect(() => {
    // Optional: You can perform additional actions when playerId changes
    console.log("Player ID changed:", playerId);
  }, [playerId]);

  return (
    <PlayerContext.Provider value={{ playerId, setPlayerId }}>
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
