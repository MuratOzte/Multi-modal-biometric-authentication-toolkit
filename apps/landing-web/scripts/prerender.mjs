import { build, loadEnv } from "vite";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const env = { ...loadEnv("production", root, ""), ...process.env };
const configuredUrl = env.VITE_SITE_URL?.trim();
const origin = configuredUrl ? new URL(configuredUrl).origin : "";
if (configuredUrl && !/^https?:\/\//.test(configuredUrl))
  throw new Error("VITE_SITE_URL must be an absolute HTTP(S) URL.");
const bundlePath = path.join(root, "dist", ".prerender.mjs");
const result = await build({
  configFile: false,
  root,
  build: { ssr: "src/prerender.tsx", write: false, minify: false },
});
const bundle = (Array.isArray(result) ? result[0] : result).output.find(
  (item) => item.type === "chunk" && item.isEntry,
);
await writeFile(bundlePath, bundle.code);
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
try {
  const { render, seo, localeFromPath, preferenceKey, preferredLocale } =
    await import(pathToFileURL(bundlePath).href);
  const template = await readFile(
    path.join(root, "dist", "index.html"),
    "utf8",
  );
  const url = (locale) => `${origin}/${locale ? `${locale}/` : ""}`;
  const alternates = ["tr", "en", "x-default"]
    .map(
      (locale) =>
        `<link rel="alternate" hreflang="${locale}" href="${escape(url(locale === "x-default" ? "" : locale))}" />`,
    )
    .join("\n    ");
  function page(locale, entry = false) {
    const data = seo[locale];
    const canonical = url(entry ? "" : locale);
    // Run before the body is parsed so the entry page does not flash the fallback language.
    // The module entry also handles redirection when inline scripts are blocked by CSP.
    const redirect = entry
      ? `<script>
      (() => {
        if ((${localeFromPath.toString()})(window.location.pathname)) return;
        let saved = null;
        try { saved = localStorage.getItem(${JSON.stringify(preferenceKey)}); } catch {}
        const locale = (${preferredLocale.toString()})(navigator.languages || [navigator.language], saved);
        window.location.replace('/' + locale + '/' + window.location.search + window.location.hash);
      })();
    </script>`
      : "";
    const metadata = `
    <link rel="canonical" href="${escape(canonical)}" />
    ${alternates}
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="SecureKit" />
    <meta property="og:title" content="${escape(data.title)}" />
    <meta property="og:description" content="${escape(data.description)}" />
    <meta property="og:url" content="${escape(canonical)}" />
    <meta property="og:locale" content="${data.ogLocale}" />
    <meta property="og:locale:alternate" content="${seo[locale === "tr" ? "en" : "tr"].ogLocale}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escape(data.title)}" />
    <meta name="twitter:description" content="${escape(data.description)}" />`;
    return template
      .replace(/<html lang="[^"]*">/, `<html lang="${locale}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${escape(data.title)}</title>`)
      .replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
        `<meta name="description" content="${escape(data.description)}" />`,
      )
      .replace("</head>", `${metadata}\n    ${redirect}\n  </head>`)
      .replace(
        '<div id="root"></div>',
        `<div id="root">${render(locale)}</div>`,
      );
  }
  for (const locale of ["tr", "en"]) {
    await mkdir(path.join(root, "dist", locale), { recursive: true });
    await writeFile(
      path.join(root, "dist", locale, "index.html"),
      page(locale),
    );
  }
  await writeFile(path.join(root, "dist", "index.html"), page("en", true));
  if (origin) {
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${["", "tr", "en"].map((locale) => `<url><loc>${escape(url(locale))}</loc>${["tr", "en", "x-default"].map((language) => `<xhtml:link rel="alternate" hreflang="${language}" href="${escape(url(language === "x-default" ? "" : language))}" />`).join("")}</url>`).join("\n")}
</urlset>`;
    await writeFile(path.join(root, "dist", "sitemap.xml"), sitemap);
  }
  await writeFile(
    path.join(root, "dist", "robots.txt"),
    `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`,
  );
  if (!origin)
    console.warn(
      "VITE_SITE_URL is unset: using relative canonical/alternate URLs; set the production origin to generate absolute hreflang links and sitemap.xml.",
    );
} finally {
  await unlink(bundlePath);
}
