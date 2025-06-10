import { createRoot } from "react-dom/client";
import React from "react";
import Router from "./Router";


document.documentElement.classList.remove("dark");
const container = document.getElementById("root");

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
