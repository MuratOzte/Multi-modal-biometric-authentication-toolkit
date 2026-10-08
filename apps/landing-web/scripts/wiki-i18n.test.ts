import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import LanguageSwitcher from "../src/LanguageSwitcher";
import { Mark } from "../src/Visuals";
import index from "../src/wiki-index.json";
import {
  prepareWikiHtml,
  wikiContentPath,
  wikiPages,
  wikiTranslator,
} from "../src/wiki-locale";
import type { Locale } from "../src/locale";

// Remove the CSS import for a server-rendered UI check, as in the entry tests.
const source = await readFile(
  new URL("../src/Wiki.tsx", import.meta.url),
  "utf8",
);
const compiled = ts
  .transpileModule(source.replaceAll("import.meta.env.BASE_URL", '"/"'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace(/^import[\s\S]*?;\s*$/gm, "")
  .replace("export default function Wiki", "function Wiki");
const Wiki = vm.runInNewContext(`${compiled}\nWiki`, {
  _jsx: jsx,
  _jsxs: jsxs,
  _Fragment: Fragment,
  useEffect,
  useRef,
  useState,
  Mark,
  index,
  LanguageSwitcher,
  prepareWikiHtml,
  wikiContentPath,
  wikiPages,
  wikiTranslator,
  URLSearchParams,
}) as ComponentType<{ hash: string; locale: Locale }>;

test("wiki navigation, page headings, loading states and 404 are localized", () => {
  for (const slug of ["1-overview", "missing-page"]) {
    const hash = `#/wiki/${slug}?section=overview`;
    const english = renderToStaticMarkup(
      createElement(Wiki, { locale: "en", hash }),
    );
    const turkish = renderToStaticMarkup(
      createElement(Wiki, { locale: "tr", hash }),
    );
    assert.match(english, /Search the wiki/);
    assert.match(english, /Back to the main site/);
    assert.match(english, /Topics ☰/);
    assert.match(english, /27 pages · 7 topic groups/);
    assert.match(turkish, /Wiki içinde ara/);
    assert.match(turkish, /Konular ☰/);
    assert.match(turkish, /27 sayfa · 7 konu grubu/);
    assert.match(turkish, /Yazım ritmi, oturum ve risk hizmetleri/);
    assert.ok(english.includes(`href="/tr/${hash}"`));
    assert.ok(turkish.includes(`href="/en/${hash}"`));
    assert.doesNotMatch(english.replace(/<[^>]*>/g, " "), /[çğıöşüÇĞİÖŞÜ]/);
    if (slug === "1-overview") {
      assert.match(english, /Loading page…/);
      assert.match(turkish, /Sayfa yükleniyor…/);
    } else {
      assert.match(english, /This page could not be found/);
      assert.match(turkish, /Bu sayfa bulunamadı/);
    }
  }
});

test("article and shared diagram URLs resolve from the site base in both languages", async () => {
  for (const locale of ["tr", "en"] as const) {
    for (const page of wikiPages(locale)) {
      const contentPath = wikiContentPath(locale, page.slug, "/");
      assert.equal(
        contentPath,
        `/wiki/${locale === "tr" ? "tr/" : ""}${page.slug}.html`,
      );
      const html = await readFile(
        new URL(`../public${contentPath}`, import.meta.url),
        "utf8",
      );
      const prepared = prepareWikiHtml(html, locale, "/");
      assert.doesNotMatch(prepared, /src="\.\/wiki\//);
      for (const diagram of page.diagrams)
        assert.ok(prepared.includes(`src="/wiki/diagrams/${diagram}"`));
      if (locale === "en")
        assert.doesNotMatch(prepared, /Diyagramı|Diyagram \d+: büyüt/);
    }
  }
  const example = '<img src="./wiki/diagrams/example.svg">';
  assert.equal(
    prepareWikiHtml(example, "en", "/docs/"),
    '<img src="/docs/wiki/diagrams/example.svg">',
  );
});

test("language links preserve a wiki article and its deep section even when opened in a new tab", () => {
  const hash =
    "#/wiki/5.1-face-and-voice-workers?section=voice-verification-worker";
  const html = renderToStaticMarkup(
    createElement(LanguageSwitcher, { locale: "tr", hash }),
  );
  assert.ok(html.includes(`href="/en/${hash}"`));
  assert.ok(html.includes(`href="/tr/${hash}"`));
});
