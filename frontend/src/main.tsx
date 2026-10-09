import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import App from "./App.tsx";
import { applyTheme, getInitialTheme } from "./theme";

// Set before the first render so a dark-mode user never sees a light flash.
applyTheme(getInitialTheme(), false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
