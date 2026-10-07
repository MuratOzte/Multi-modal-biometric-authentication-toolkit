import { lazy, Suspense, useEffect, useState } from "react";
import App from "./App";

const Wiki = lazy(() => import("./Wiki"));

export default function SiteRouter() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const navigate = () => setHash(window.location.hash);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return hash.startsWith("#/wiki") ? (
    <Suspense
      fallback={
        <div className="wiki-loading" role="status">
          Kaynak wiki yükleniyor…
        </div>
      }
    >
      <Wiki hash={hash} />
    </Suspense>
  ) : (
    <App />
  );
}
