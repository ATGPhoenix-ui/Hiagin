import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register service worker for PWA install eligibility + offline shell
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.log("SW registration failed:", err);
    });
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
