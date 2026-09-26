import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// `vite build --mode preview`: a static web preview with a fake backend inside the page.
if (import.meta.env.MODE === "preview") await import("./preview/mock.ts");
// `vite build --mode standalone`: SnapSell without a server (GitHub Pages); data stays on this device.
if (import.meta.env.MODE === "standalone") await import("./local/backend.ts");
// `vite build --mode hosted`: SnapSell as a Claude page; Claude, storage and photos come from claude.ai.
if (import.meta.env.MODE === "hosted") await import("./hosted/backend.ts");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
