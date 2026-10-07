import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./AuthApp.css";
import { AuthApp } from "./AuthApp.js";

createRoot(document.getElementById("auth-root")!).render(
  <StrictMode>
    <AuthApp />
  </StrictMode>
);
