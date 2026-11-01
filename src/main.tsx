import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startNetMonitor } from "./netMonitor";
import { registerServiceWorker } from "./pwa";
import "./styles.css";

startNetMonitor();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
