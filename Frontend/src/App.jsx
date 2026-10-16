import { createRoot } from "react-dom/client";
import React from "react";
import Router from "./Router";
import './theme.css';


document.documentElement.dataset.theme = 'bronze';
const container = document.getElementById("root");

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
