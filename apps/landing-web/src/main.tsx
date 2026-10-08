import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import SiteRouter from "./SiteRouter";
import { localeFromPath, preferenceKey, preferredLocale } from "./locale";
import "./styles.css";

if (!localeFromPath(window.location.pathname)) {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(preferenceKey);
  } catch {
    /* Storage may be disabled. */
  }
  const locale = preferredLocale(
    navigator.languages ?? [navigator.language],
    saved,
  );
  window.location.replace(
    `/${locale}/${window.location.search}${window.location.hash}`,
  );
} else {
  const root = document.getElementById("root")!;
  const app = (
    <StrictMode>
      <SiteRouter />
    </StrictMode>
  );
  // Wiki hash routes mount separately from the prerendered landing page.
  if (root.hasChildNodes() && !window.location.hash.startsWith("#/wiki"))
    hydrateRoot(root, app);
  else createRoot(root).render(app);
}
