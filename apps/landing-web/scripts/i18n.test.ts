import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";
import LanguageSwitcher from "../src/LanguageSwitcher";
import { localeFromPath, preferredLocale, seo } from "../src/locale";

test("browser preferences honor regional languages, order, saved choice and English fallback", () => {
  assert.equal(preferredLocale(["tr-TR", "en-US"]), "tr");
  assert.equal(preferredLocale(["en-GB", "tr"]), "en");
  assert.equal(preferredLocale(["de-DE", "tr-TR"]), "tr");
  assert.equal(preferredLocale(["fr-FR"]), "en");
  assert.equal(preferredLocale([]), "en");
  assert.equal(preferredLocale(["en-US"], "tr"), "tr");
  assert.equal(preferredLocale(["tr-TR"], "invalid"), "tr");
  assert.equal(localeFromPath("/tr/"), "tr");
  assert.equal(localeFromPath("/en"), "en");
  assert.equal(localeFromPath("/english/"), null);
});

const entrySource = await readFile(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const entry = ts
  .transpileModule(entrySource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace(/^import[\s\S]*?;\s*$/gm, "");

function openPage(
  pathname: string,
  languages: string[],
  saved: string | null,
  storageBlocked = false,
  hash = "#flow",
) {
  const redirects: string[] = [];
  let hydrations = 0;
  let mounts = 0;
  vm.runInNewContext(entry, {
    window: {
      location: {
        pathname,
        search: "?ref=example",
        hash,
        replace: (url: string) => redirects.push(url),
      },
    },
    navigator: { languages, language: languages[0] },
    localStorage: {
      getItem: () => {
        if (storageBlocked) throw new Error("blocked");
        return saved;
      },
    },
    document: { getElementById: () => ({ hasChildNodes: () => true }) },
    localeFromPath,
    preferredLocale,
    preferenceKey: "securekit.language",
    _jsx: (_component: unknown, props: unknown) => props,
    StrictMode: {},
    SiteRouter: {},
    hydrateRoot: () => hydrations++,
    createRoot: () => ({ render: () => mounts++ }),
  });
  return { redirects, hydrations, mounts };
}

test("entry redirects only unlocalized URLs and preserves search/hash even with blocked storage", () => {
  assert.deepEqual(openPage("/", ["tr-TR"], null).redirects, [
    "/tr/?ref=example#flow",
  ]);
  assert.deepEqual(openPage("/", ["tr-TR"], "en").redirects, [
    "/en/?ref=example#flow",
  ]);
  assert.deepEqual(openPage("/", ["en-US"], "tr", true).redirects, [
    "/en/?ref=example#flow",
  ]);
  assert.deepEqual(
    openPage("/", ["de-DE"], null, false, "#/wiki/1-overview").redirects,
    ["/en/?ref=example#/wiki/1-overview"],
  );
  assert.deepEqual(openPage("/en/", ["tr-TR"], "tr"), {
    redirects: [],
    hydrations: 1,
    mounts: 0,
  });
  assert.deepEqual(
    openPage("/tr/", ["en-US"], "en", false, "#/wiki/1-overview"),
    { redirects: [], hydrations: 0, mounts: 1 },
  );
});

test("language switch preserves the current section and saves the choice with storage failure fallback", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window",
  );
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { search: "?ref=example", hash: "#developers" } },
    });
    for (const storageBlocked of [false, true]) {
      const saved: string[][] = [];
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          setItem: (key: string, value: string) => {
            if (storageBlocked) throw new Error("blocked");
            saved.push([key, value]);
          },
        },
      });
      const group = LanguageSwitcher({ locale: "tr" });
      const english = group.props.children[1];
      const currentTarget = { href: "/en/" };
      english.props.onClick({ currentTarget });
      assert.equal(currentTarget.href, "/en/?ref=example#developers");
      assert.deepEqual(
        saved,
        storageBlocked ? [] : [["securekit.language", "en"]],
      );
    }
  } finally {
    if (windowDescriptor)
      Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (storageDescriptor)
      Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("static entry redirects before React loads and localized HTML contains no redirect script", async () => {
  const html = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(inline);
  for (const [pathname, languages, saved, expected] of [
    ["/", ["tr-TR"], null, "/tr/?ref=example#flow"],
    ["/", ["en-US"], "tr", "/tr/?ref=example#flow"],
    ["/", ["fr-FR"], null, "/en/?ref=example#flow"],
    ["/en/", ["tr-TR"], "tr", null],
  ] as const) {
    const redirects: string[] = [];
    vm.runInNewContext(inline, {
      window: {
        location: {
          pathname,
          search: "?ref=example",
          hash: "#flow",
          replace: (url: string) => redirects.push(url),
        },
      },
      navigator: { languages },
      localStorage: { getItem: () => saved },
    });
    assert.deepEqual(redirects, expected ? [expected] : []);
  }
  for (const locale of ["tr", "en"]) {
    const page = await readFile(
      new URL(`../dist/${locale}/index.html`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(page, /window\.location\.replace/);
  }
});

test("both landing pages render full localized content and crawlable language links without browser APIs", () => {
  const english = renderToStaticMarkup(createElement(App, { locale: "en" }));
  const turkish = renderToStaticMarkup(createElement(App, { locale: "tr" }));
  for (const html of [english, turkish]) {
    assert.match(html, /href="\/tr\/" hrefLang="tr" lang="tr"/);
    assert.match(html, /href="\/en\/" hrefLang="en" lang="en"/);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.equal((html.match(/class="capability-block"/g) ?? []).length, 5);
    assert.match(html, /id="flow"/);
    assert.match(html, /id="developers"/);
  }
  assert.match(english, /The many layers/);
  assert.match(english, /Your typing rhythm\./);
  assert.match(english, /Pause animations/);
  const visibleEnglish = english.replace(/<[^>]*>/g, " ");
  assert.doesNotMatch(visibleEnglish, /[çğıöşüÇĞİÖŞÜ]/);
  assert.match(turkish, /Kimliğin farklı/);
  assert.match(turkish, /Hareketleri duraklat/);
});

test("production HTML contains localized content, metadata and reciprocal language alternates", async () => {
  for (const locale of ["tr", "en"] as const) {
    const html = await readFile(
      new URL(`../dist/${locale}/index.html`, import.meta.url),
      "utf8",
    );
    assert.match(html, new RegExp(`<html lang="${locale}">`));
    assert.ok(html.includes(`<title>${seo[locale].title}</title>`));
    assert.ok(html.includes(`content="${seo[locale].description}"`));
    assert.match(
      html,
      new RegExp(`rel="canonical" href="(?:https?://[^/]+)?/${locale}/"`),
    );
    for (const language of ["tr", "en", "x-default"])
      assert.match(html, new RegExp(`hreflang="${language}"`));
    assert.ok(html.includes(`content="${seo[locale].ogLocale}"`));
    assert.match(html, /name="twitter:description"/);
    assert.match(html, /<div id="root"><div class="site">/);
    assert.match(html, /id="developers"/);
    assert.match(html, /src="\/assets\//);
  }
  const root = await readFile(
    new URL("../dist/index.html", import.meta.url),
    "utf8",
  );
  assert.match(root, /hreflang="x-default"/);
  assert.match(root, /The many layers/);
  const robots = await readFile(
    new URL("../dist/robots.txt", import.meta.url),
    "utf8",
  );
  assert.match(robots, /Allow: \//);
  if (robots.includes("Sitemap:")) {
    const sitemap = await readFile(
      new URL("../dist/sitemap.xml", import.meta.url),
      "utf8",
    );
    assert.equal((sitemap.match(/<url>/g) ?? []).length, 3);
    assert.equal((sitemap.match(/hreflang="x-default"/g) ?? []).length, 3);
    assert.doesNotMatch(sitemap, /#\/wiki/);
    assert.match(sitemap, /<loc>https?:\/\//);
  }
});
