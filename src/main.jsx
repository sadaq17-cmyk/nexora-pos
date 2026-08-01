import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/index.css";
import "./styles/enterprise.css";
import "./styles/public.css";
import "./styles/nexora-ai.css";
import "./styles/nexora-pro-home.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
