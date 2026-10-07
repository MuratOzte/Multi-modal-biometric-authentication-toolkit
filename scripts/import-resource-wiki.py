"""Build an offline, allowlisted wiki snapshot from browser-captured DeepWiki pages.

Usage: python scripts/import-resource-wiki.py capture.json
The capture contains title, url, html, text and headings for every source page.
No network calls or runtime third-party scripts are included in the output.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/landing-web/public/wiki"


class Element:
    def __init__(self, tag="root", attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []


class Tree(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Element()
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {"br", "hr", "img", "input", "wbr", "meta", "link"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def text_content(node):
    if isinstance(node, str):
        return node
    if node.tag in {"button", "svg"}:
        return ""
    return "".join(text_content(c) for c in node.children)


def attr_string(attrs):
    return "".join(f' {k}="{html.escape(str(v), quote=True)}"' for k, v in attrs.items())


SVG_TAGS = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "marker", "clippath", "lineargradient", "radialgradient", "stop", "style", "foreignobject", "div", "span", "p", "br", "b", "strong", "i", "em"}
# HTMLParser lowercases SVG names; restore their case for standalone SVG documents.
SVG_CASE = {"viewbox": "viewBox", "preserveaspectratio": "preserveAspectRatio", "markerwidth": "markerWidth", "markerheight": "markerHeight", "refx": "refX", "refy": "refY", "markerunits": "markerUnits", "gradientunits": "gradientUnits", "gradienttransform": "gradientTransform", "clippath": "clipPath", "lineargradient": "linearGradient", "radialgradient": "radialGradient", "foreignobject": "foreignObject", "textlength": "textLength"}


def svg_html(node):
    if isinstance(node, str):
        return html.escape(node)
    if node.tag not in SVG_TAGS:
        return ""
    attrs = {SVG_CASE.get(k, k): v for k, v in node.attrs.items()
             if not k.startswith("on") and k not in {"href", "xlink:href"} and v is not None}
    if node.tag == "svg":
        attrs["xmlns"] = "http://www.w3.org/2000/svg"
        attrs["style"] = "max-width:100%;background:#fafafa"
    if node.tag == "foreignobject":
        # Mermaid labels use XHTML inside their foreignObject.
        for child in node.children:
            if isinstance(child, Element) and child.tag == "div":
                child.attrs["xmlns"] = "http://www.w3.org/1999/xhtml"
    tag = SVG_CASE.get(node.tag, node.tag)
    return f'<{tag}{attr_string(attrs)}>' + "".join(svg_html(c) for c in node.children) + f'</{tag}>'


SAFE_TAGS = {"h1", "h2", "h3", "h4", "p", "a", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "pre", "code", "strong", "b", "em", "i", "blockquote", "details", "summary", "hr", "br", "s", "del", "sup", "sub"}


def build(capture):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "diagrams").mkdir(exist_ok=True)
    urls = {p["url"]: re.sub(r"[^a-z0-9.-]+", "-", p["url"].rsplit("/", 1)[-1].lower()).strip("-") for p in capture}
    pages = []
    for page in capture:
        slug = urls[page["url"]]
        diagrams = []

        def render(node):
            if isinstance(node, str):
                return html.escape(node)
            if node.tag in {"script", "style", "button", "input", "iframe", "object", "embed"}:
                return ""
            if node.tag == "svg":
                if not node.attrs.get("id", "").startswith("mermaid-"):
                    return ""
                name = f"{slug}-{len(diagrams) + 1}.svg"
                (OUT / "diagrams" / name).write_text(svg_html(node), encoding="utf-8")
                diagrams.append(name)
                return f'<figure class="wiki-diagram"><img src="./wiki/diagrams/{name}" alt="{html.escape(page["title"], quote=True)} — diagram {len(diagrams)}" loading="lazy" /><figcaption>Diyagramı büyütmek için seçin ↗</figcaption></figure>'
            body = "".join(render(c) for c in node.children)
            if node.tag not in SAFE_TAGS:
                return body
            if node.tag == "pre" and '<figure class="wiki-diagram">' in body:
                return body
            attrs = {}
            if re.fullmatch(r"h[1-4]", node.tag) and node.attrs.get("id"):
                attrs["id"] = node.attrs["id"]
            if node.tag == "a":
                href = node.attrs.get("href", "")
                base, _, fragment = href.partition("#")
                if base in urls:
                    href = f'#/wiki/{urls[base]}' + (f'?section={fragment}' if fragment else "")
                elif not href.startswith(("https://", "#")):
                    return body
                attrs["href"] = href
                if href.startswith("https://"):
                    attrs.update(target="_blank", rel="noopener noreferrer")
                if "github.com/" in href:
                    attrs["class"] = "wiki-source"
                    body = html.escape(" ".join(text_content(c).strip() for c in node.children if text_content(c).strip()))
            if node.tag in {"th", "td"}:
                attrs.update({k: v for k, v in node.attrs.items() if k in {"colspan", "rowspan"} and str(v).isdigit()})
            result = f'<{node.tag}{attr_string(attrs)}>' + body
            if node.tag not in {"hr", "br"}:
                result += f'</{node.tag}>'
            if node.tag == "table":
                result = '<div class="wiki-table-scroll" tabindex="0" role="region" aria-label="Documentation table">' + result + '</div>'
            return result

        content = render(Tree(page["html"]).root)
        (OUT / f"{slug}.html").write_text(content, encoding="utf-8")
        headings = [{**h, "title": h["title"].strip()} for h in page["headings"]]
        # Search uses source text; diagrams remain available as separate SVG assets.
        search = re.sub(r"\s+", " ", text_content(Tree(content).root)).strip()
        pages.append(dict(slug=slug, title=page["title"], source=page["url"],
                          number=slug.split("-", 1)[0], headings=headings,
                          searchText=search, diagrams=diagrams,
                          words=len(search.split())))
    index = dict(source="https://deepwiki.com/MuratOzte/Multi-modal-biometric-authentication-toolkit",
                 indexedAt="2026-10-07", sourceCommit="7b9cbda5", pages=pages)
    target = ROOT / "apps/landing-web/src/wiki-index.json"
    target.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f'Imported {len(pages)} pages, {sum(len(p["diagrams"]) for p in pages)} diagrams.')


if __name__ == "__main__":
    build(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
