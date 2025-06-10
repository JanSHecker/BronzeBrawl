import React, { useState } from "react";
import { Button, Input, Link } from "react-daisyui";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { usePlayer } from "../playerContext";
import { BACKEND_PORT, GAME_ID_KEY, PLAYER_NAME_KEY } from "../constants";

const NameForm = () => {
  // State to store the input value
  const [name, setName] = useState("");

  const navigate = useNavigate();
  // Event handler for input changes
  const handleNameChange = (event) => {
    setName(event.target.value);
  };

  // Event handler for form submission
  const handleSubmit = async (event) => {
    event.preventDefault();
    const res = await axios.post(
      localStorage.getItem("baseURL") + BACKEND_PORT + "createPlayer",
      {
        playerName: name,
        game: localStorage.getItem(GAME_ID_KEY),
      }
    );
    const res2 = await axios.get(
      localStorage.getItem("baseURL") + BACKEND_PORT + "getSettings",
      {
        params: {
          gameId: localStorage.getItem(GAME_ID_KEY),
        },
      }
    );
    setSettings(res2.data);
    const player = res.data;
    console.log({ player });
    localStorage.setItem("playerId", player.playerId);
    localStorage.setItem("changeAllowed", true);
    localStorage.setItem(PLAYER_NAME_KEY, name);
    navigate("/team");
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex w-full component-preview p-4 items-center justify-center gap-2 font-sans">
        <div className="form-control w-full max-w-xs">
          <label className="label" htmlFor="name">
            <span className="label-text">What is your name?</span>
          </label>
          <Input
            type="text"
            value={name}
            onChange={handleNameChange}
            className="bg-white"
          />
        </div>
      </div>
      <Button type="submit" color="primary" wide="true" className="m-8">
        START
      </Button>
    </form>
  );
};

export default NameForm;

const setSettings = (settings) => {
  localStorage.setItem("punishmentAmount", settings.punishmentAmount);
  localStorage.setItem("rewardAmount", settings.rewardAmount);
  localStorage.setItem("rotationMode", settings.rotationMode);
  localStorage.setItem(
    "defaultRotationCounter",
    settings.defaultRotationCounter
  );
};
