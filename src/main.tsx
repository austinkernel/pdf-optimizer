import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { startNetMonitor } from "./netMonitor";
import { registerServiceWorker } from "./pwa";
import { startInstallListener } from "./install";
import "./styles.css";

startNetMonitor();
startInstallListener();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
