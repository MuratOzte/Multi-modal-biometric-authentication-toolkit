"""Build the Turkish wiki snapshot from reviewed, local block translations.

Run after import-resource-wiki.py. No network service is used. Inline markup,
code samples, source references, section IDs and diagram assets are preserved.
"""
import html
import json
import re
from pathlib import Path
from importlib.util import module_from_spec, spec_from_file_location

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("wiki_import", ROOT / "scripts/import-resource-wiki.py")
wiki = module_from_spec(spec)
spec.loader.exec_module(wiki)
BLOCKS = {"p", "li", "th", "td", "h1", "h2", "h3", "h4", "summary", "figcaption"}
VOID = {"br", "hr", "img", "input", "wbr", "meta", "link"}


def serialize(node):
    if isinstance(node, str):
        return html.escape(node)
    if node.tag == "root":
        return "".join(serialize(c) for c in node.children)
    start = f"<{node.tag}{wiki.attr_string(node.attrs)}>"
    return start if node.tag in VOID else start + "".join(serialize(c) for c in node.children) + f"</{node.tag}>"


def blocks(node):
    if isinstance(node, str) or node.tag in {"pre", "code"}:
        return
    descendants = list(walk(node))[1:]
    if node.tag in BLOCKS and not any(n.tag in BLOCKS for n in descendants):
        yield node
    else:
        for child in node.children:
            yield from blocks(child)


def walk(node):
    if not isinstance(node, str):
        yield node
        for child in node.children:
            yield from walk(child)


def template(node):
    tokens = []

    def token(value):
        tokens.append(value)
        return f"{{{len(tokens) - 1}}}"

    def inner(child):
        if isinstance(child, str):
            return child
        if child.tag in {"code", "pre"} or "wiki-source" in child.attrs.get("class", ""):
            return token(serialize(child))
        start = token(f"<{child.tag}{wiki.attr_string(child.attrs)}>")
        if child.tag in VOID:
            return start
        return start + "".join(inner(c) for c in child.children) + token(f"</{child.tag}>")

    return "".join(inner(c) for c in node.children), tokens


def build():
    index = json.loads((ROOT / "apps/landing-web/src/wiki-index.json").read_text(encoding="utf-8"))
    translations = json.loads((ROOT / "apps/landing-web/src/wiki-translations-tr.json").read_text(encoding="utf-8"))
    out = ROOT / "apps/landing-web/public/wiki/tr"
    out.mkdir(exist_ok=True)
    for page in index["pages"]:
        tree = wiki.Tree((out.parent / f"{page['slug']}.html").read_text(encoding="utf-8"))
        source_blocks = list(blocks(tree.root))
        translated_nodes = {id(node) for node in source_blocks}

        def check_coverage(node):
            if isinstance(node, str):
                if node.strip():
                    fragments = translations["_fragments"]
                    if node not in fragments:
                        raise ValueError(f"Uncovered prose in {page['slug']}: {node}")
                    return fragments[node]
                return node
            elif id(node) not in translated_nodes and node.tag not in {"pre", "code"} and "wiki-source" not in node.attrs.get("class", ""):
                node.children = [check_coverage(child) for child in node.children]
            return node

        check_coverage(tree.root)
        translated = translations[page["slug"]]
        if len(source_blocks) != len(translated):
            raise ValueError(f"{page['slug']}: expected {len(source_blocks)} blocks, got {len(translated)}")
        for node, entry in zip(source_blocks, translated):
            source, tokens = template(node)
            if source != entry[0]:
                raise ValueError(f"Stale translation in {page['slug']}: {source}")
            target = entry[1]
            if sorted(re.findall(r"\{\d+\}", source)) != sorted(re.findall(r"\{\d+\}", target)):
                raise ValueError(f"Lost inline markup in {page['slug']}: {source}")
            markup = re.sub(r"\{(\d+)\}", lambda m: tokens[int(m[1])], html.escape(target))
            node.children = wiki.Tree(markup).root.children
        for node in walk(tree.root):
            if node.tag == "figure":
                node.attrs["aria-label"] = "Diyagramı büyüt"
            if node.attrs.get("aria-label") == "Documentation table":
                node.attrs["aria-label"] = "Belge tablosu"
            if node.tag == "img":
                node.attrs["src"] = node.attrs["src"].replace("./wiki/", "/wiki/")
                node.attrs["alt"] = node.attrs["alt"].replace(page["title"], wiki.text_content(next(n for n in walk(tree.root) if n.tag == "h1"))).replace("diagram", "diyagram")
        content = serialize(tree.root)
        (out / f"{page['slug']}.html").write_text(content + "\n", encoding="utf-8")
        page["title"] = wiki.text_content(next(n for n in walk(tree.root) if n.tag == "h1"))
        page["headings"] = [dict(id=n.attrs["id"], title=wiki.text_content(n), level=int(n.tag[1])) for n in walk(tree.root) if re.fullmatch("h[1-4]", n.tag) and "id" in n.attrs]
        page["searchText"] = re.sub(r"\s+", " ", wiki.text_content(tree.root)).strip()
        page["words"] = len(page["searchText"].split())
    (ROOT / "apps/landing-web/src/wiki-index-tr.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Localized {len(index['pages'])} Turkish wiki pages.")


if __name__ == "__main__":
    build()
