import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "apps/landing-web/public/wiki");
const index = JSON.parse(
  readFileSync(path.join(root, "apps/landing-web/src/wiki-index.json"), "utf8"),
);
const pages = new Map(index.pages.map((page) => [page.slug, page]));

test("complete wiki snapshot has 27 distinct pages across seven topic groups", () => {
  assert.equal(pages.size, 27);
  assert.equal(
    new Set(index.pages.map((page) => page.number.split(".")[0])).size,
    7,
  );
  assert.equal(index.sourceCommit, "7b9cbda5");
});

for (const page of index.pages) {
  test(`${page.number}: content, anchors, internal links, and diagram assets are valid`, () => {
    const html = readFileSync(
      path.join(directory, `${page.slug}.html`),
      "utf8",
    );
    assert.ok(
      html.includes(
        `<h1 id="${page.headings[0].id}">${page.title.replaceAll("&", "&amp;")}</h1>`,
      ),
    );
    assert.ok(page.words > 100);
    assert.equal(
      new Set(page.headings.map((heading) => heading.id)).size,
      page.headings.length,
      "Duplicate heading anchors",
    );
    for (const heading of page.headings)
      assert.ok(html.includes(`id="${heading.id}"`), heading.title);
    for (const [, slug, section] of html.matchAll(
      /href="#\/wiki\/([^"?]+)(?:\?section=([^"&]+))?"/g,
    )) {
      assert.ok(pages.has(slug), `Unresolved wiki link: ${slug}`);
      if (section)
        assert.ok(
          pages.get(slug).headings.some((heading) => heading.id === section),
        );
    }
    assert.doesNotMatch(html, /href="(?:https:\/\/deepwiki.com|\/MuratOzte)/);
    assert.doesNotMatch(
      html,
      /<(?:script|iframe|object|embed)\b|\son\w+=|javascript:/i,
    );
    for (const name of page.diagrams) {
      assert.ok(html.includes(`./wiki/diagrams/${name}`));
      assert.ok(existsSync(path.join(directory, "diagrams", name)));
      const svg = readFileSync(path.join(directory, "diagrams", name), "utf8");
      assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
      assert.ok(svg.includes("viewBox="));
      assert.doesNotMatch(svg, /<(?:script|iframe)\b|\son\w+=/i);
    }
  });
}

test("configuration code samples retain separate executable lines", () => {
  const html = readFileSync(
    path.join(directory, "1.2-getting-started-and-local-development.html"),
    "utf8",
  );
  assert.match(
    html,
    /VITE_SECUREKIT_BASE_URL=\/api\/securekit\r?\nVITE_SECUREKIT_API_BACKEND=aspnet/,
  );
});
