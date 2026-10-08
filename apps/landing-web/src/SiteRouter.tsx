import { lazy, Suspense, useEffect, useState } from "react";
import App from "./App";
import { localeFromPath, seo, type Locale } from "./locale";

const Wiki = lazy(() => import("./Wiki"));

export default function SiteRouter() {
  const locale: Locale = localeFromPath(window.location.pathname) ?? "en";
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const origin = import.meta.env.VITE_SITE_URL
      ? new URL(import.meta.env.VITE_SITE_URL).origin
      : window.location.origin;
    document.documentElement.lang = locale;
    if (!hash.startsWith("#/wiki")) document.title = seo[locale].title;
    const meta = (name: string, content: string, property = false) => {
      const attribute = property ? "property" : "name";
      let element = document.head.querySelector<HTMLMetaElement>(
        `meta[${attribute}="${name}"]`,
      );
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, name);
        document.head.append(element);
      }
      element.content = content;
    };
    meta("description", seo[locale].description);
    meta("og:title", seo[locale].title, true);
    meta("og:description", seo[locale].description, true);
    meta("og:locale", seo[locale].ogLocale, true);
    meta("og:url", `${origin}/${locale}/`, true);
    meta(
      "og:locale:alternate",
      seo[locale === "tr" ? "en" : "tr"].ogLocale,
      true,
    );
    meta("twitter:title", seo[locale].title);
    meta("twitter:description", seo[locale].description);
    meta(
      "robots",
      hash.startsWith("#/wiki") ? "noindex, follow" : "index, follow",
    );
    for (const language of ["tr", "en", "x-default"]) {
      let link = document.head.querySelector<HTMLLinkElement>(
        `link[hreflang="${language}"]`,
      );
      if (!link) {
        link = document.createElement("link");
        link.rel = "alternate";
        link.hreflang = language;
        document.head.append(link);
      }
      link.href = `${origin}/${language === "x-default" ? "" : `${language}/`}`;
    }
    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = `${origin}/${locale}/`;
  }, [locale, hash]);
  useEffect(() => {
    const navigate = () => setHash(window.location.hash);
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  return hash.startsWith("#/wiki") ? (
    <Suspense
      fallback={
        <div className="wiki-loading" role="status">
          {locale === "tr"
            ? "Kaynak wiki yükleniyor…"
            : "Loading Resource Wiki…"}
        </div>
      }
    >
      <Wiki hash={hash} />
    </Suspense>
  ) : (
    <App locale={locale} />
  );
}
