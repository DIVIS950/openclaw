import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// `vite build --mode preview`: a static web preview with a fake backend inside the page.
if (import.meta.env.MODE === "preview") await import("./preview/mock.ts");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
