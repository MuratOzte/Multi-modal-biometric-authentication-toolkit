import { useEffect, useRef, useState } from "react";
import { Mark } from "./Visuals";
import index from "./wiki-index.json";
import LanguageSwitcher from "./LanguageSwitcher";
import { type Locale } from "./locale";
import {
  prepareWikiHtml,
  wikiContentPath,
  wikiPages,
  wikiTranslator,
  type WikiPage,
} from "./wiki-locale";
import "./wiki.css";

const repository =
  "https://github.com/MuratOzte/Multi-modal-biometric-authentication-toolkit";
const groups = [
  "Genel bakış",
  "ASP.NET Core API",
  "Node API & geçiş",
  "SDK, Core & demo",
  "Python işçileri",
  "Test & kabul",
  "Sözlük",
];
const wikiLink = (slug: string, section?: string) =>
  `#/wiki/${slug}${section ? `?section=${encodeURIComponent(section)}` : ""}`;

function DiagramViewer({
  diagram,
  close,
  locale,
}: {
  diagram: { src: string; alt: string };
  close: () => void;
  locale: Locale;
}) {
  const t = wikiTranslator(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="wiki-image-dialog"
      onCancel={close}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      aria-label={t("Teknik diyagram")}
    >
      <div className="wiki-dialog-bar">
        <strong>{diagram.alt}</strong>
        <div>
          <button
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
            aria-label={t("Diyagramı küçült")}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(Math.min(3, zoom + 0.25))}
            aria-label={t("Diyagramı büyüt")}
          >
            +
          </button>
          <button onClick={close} aria-label={t("Diyagramı kapat")} autoFocus>
            ×
          </button>
        </div>
      </div>
      <div className="wiki-dialog-canvas">
        <img
          src={diagram.src}
          alt={diagram.alt}
          style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
        />
      </div>
    </dialog>
  );
}

function WikiArticle({
  page,
  section,
  showDiagram,
  locale,
}: {
  page: WikiPage;
  section: string | null;
  showDiagram: (diagram: { src: string; alt: string }) => void;
  locale: Locale;
}) {
  const t = wikiTranslator(locale);
  const pages = wikiPages(locale);
  const [content, setContent] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  const article = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch(wikiContentPath(locale, page.slug, import.meta.env.BASE_URL), {
      signal: abort.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Content unavailable");
        return response.text();
      })
      .then((html) => {
        if (!abort.signal.aborted) {
          setContent(prepareWikiHtml(html, locale, import.meta.env.BASE_URL));
          setFailed(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [page.slug, locale, retry]);
  useEffect(() => {
    if (!content) return;
    if (section)
      document
        .getElementById(section)
        ?.scrollIntoView({ block: "start", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, [content, section]);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const position = pages.indexOf(page);
  return (
    <>
      <div className="wiki-page-meta">
        <span>
          {t(groups[Number(page.number.split(".")[0]) - 1])} <span>/</span>{" "}
          {page.number}
        </span>
        <span>
          {Math.max(1, Math.ceil(page.words / 220))} {t("dk okuma")}
        </span>
      </div>
      <div className="wiki-page-actions">
        <span>REPOSITORY RESOURCE WIKI</span>
        <button onClick={copyLink}>
          {copied ? t("Bağlantı kopyalandı ✓") : t("Bağlantıyı kopyala ↗")}
        </button>
      </div>
      {failed ? (
        <div className="wiki-empty" role="alert">
          <h1>{t("İçerik yüklenemedi.")}</h1>
          <p>{t("Bağlantınızı kontrol edip tekrar deneyin.")}</p>
          <button
            className="button secondary"
            onClick={() => setRetry(retry + 1)}
          >
            {t("Tekrar dene ↻")}
          </button>
        </div>
      ) : !content ? (
        <p className="wiki-loading" role="status">
          {t("Sayfa yükleniyor…")}
        </p>
      ) : (
        <div
          ref={article}
          className="wiki-prose"
          lang={locale}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const figure = target.closest(".wiki-diagram");
            const image = figure?.querySelector("img");
            if (image) showDiagram({ src: image.src, alt: image.alt });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              const image = (event.target as HTMLElement)
                .closest(".wiki-diagram")
                ?.querySelector("img");
              if (image) {
                event.preventDefault();
                showDiagram({ src: image.src, alt: image.alt });
              }
            }
          }}
          dangerouslySetInnerHTML={{ __html: content }}
        />
      )}
      <div className="wiki-attribution">
        <span className="status-dot" />
        <p>
          {t("DeepWiki arşivi") + " · " + t("7 Ekim 2026") + " · "}{" "}
          <a
            href={`${repository}/commit/${index.sourceCommit}`}
            target="_blank"
            rel="noreferrer"
          >
            {index.sourceCommit}
          </a>
          <br />
          <span>
            {t("Kaynak referansları ve özgün teknik diyagramlar korunmuştur.")}
          </span>
        </p>
        <a href={page.source} target="_blank" rel="noreferrer">
          {t("Kaynak sayfa ↗")}
        </a>
      </div>
      <nav
        className="wiki-pagination"
        aria-label={t("Önceki ve sonraki sayfa")}
      >
        <div>
          {pages[position - 1] && (
            <a href={wikiLink(pages[position - 1].slug)}>
              <small>{t("← ÖNCEKİ")}</small>
              <strong>{pages[position - 1].title}</strong>
            </a>
          )}
        </div>
        <div>
          {pages[position + 1] && (
            <a href={wikiLink(pages[position + 1].slug)}>
              <small>{t("SONRAKİ →")}</small>
              <strong>{pages[position + 1].title}</strong>
            </a>
          )}
        </div>
      </nav>
    </>
  );
}

export default function Wiki({
  hash,
  locale,
}: {
  hash: string;
  locale: Locale;
}) {
  const t = wikiTranslator(locale);
  const pages = wikiPages(locale);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [diagram, setDiagram] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const [path, params = ""] = hash.split("?");
  const slug = path.replace(/^#\/wiki\/?/, "") || pages[0].slug;
  const page = pages.find((item) => item.slug === slug);
  const section = new URLSearchParams(params).get("section");
  const search = query.trim().toLocaleLowerCase(locale);
  const results = search
    ? pages.filter((item) =>
        `${item.title} ${item.searchText}`
          .toLocaleLowerCase(locale)
          .includes(search),
      )
    : [];
  useEffect(() => {
    document.title = `${page?.title ?? wikiTranslator(locale)("Sayfa bulunamadı")} · SecureKit Wiki`;
  }, [page, locale]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const choosePage = () => {
    setQuery("");
    setMenuOpen(false);
  };
  return (
    <div className="wiki-site">
      <a
        className="skip-link"
        href="#wiki-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("wiki-content")?.focus();
        }}
      >
        {t("İçeriğe geç")}
      </a>
      <header className="wiki-header">
        <a className="brand" href="#main" aria-label={t("SecureKit ana sayfa")}>
          <Mark small />
          <span>
            SecureKit<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="wiki-header-divider" />
        <a
          className="wiki-header-label"
          href={wikiLink(pages[0].slug)}
          onClick={choosePage}
        >
          Resource Wiki
        </a>
        <nav aria-label={t("Wiki üst gezinme")}>
          <a href="#resources">{t("Tanıtım sitesine dön")}</a>
          <a href={repository} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <LanguageSwitcher locale={locale} hash={hash} />
        </nav>
      </header>
      <div className="wiki-mobile-bar">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-controls="wiki-sidebar"
        >
          {menuOpen ? t("Konuları kapat ×") : t("Konular ☰")}
        </button>
        <span>
          {page?.number ?? "404"} / {pages.length} {t("sayfa")}
        </span>
      </div>
      <div className="wiki-layout">
        <aside
          id="wiki-sidebar"
          className={`wiki-sidebar ${menuOpen ? "is-open" : ""}`}
        >
          <div className="wiki-repository">
            <span className="eyebrow">{t("PROJE KAYNAKLARI")}</span>
            <strong>
              Multi-modal biometric
              <br />
              authentication toolkit
            </strong>
            <span>{t("27 sayfa · 7 konu grubu")}</span>
          </div>
          <label className="wiki-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Wiki içinde ara…")}
              aria-label={t("Wiki içinde ara")}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
            />
            <kbd>⌃ K</kbd>
          </label>
          {search && (
            <div className="wiki-mobile-results" aria-live="polite">
              <p>
                {results.length} {t("sayfa bulundu.")}
              </p>
              {results.map((item) => (
                <a
                  key={item.slug}
                  href={wikiLink(item.slug)}
                  onClick={choosePage}
                >
                  <small>{item.number}</small>
                  {item.title}
                  <span>↗</span>
                </a>
              ))}
              {!results.length && <p>{t("Başka bir terim deneyin.")}</p>}
            </div>
          )}
          <nav
            className={`wiki-topic-list ${search ? "has-query" : ""}`}
            aria-label={t("Wiki konuları")}
          >
            {groups.map((group, groupIndex) => (
              <div className="wiki-topic-group" key={group}>
                <p>
                  {String(groupIndex + 1).padStart(2, "0")}{" "}
                  <span>{t(group)}</span>
                </p>
                {pages
                  .filter(
                    (item) =>
                      Number(item.number.split(".")[0]) === groupIndex + 1,
                  )
                  .map((item) => (
                    <a
                      key={item.slug}
                      href={wikiLink(item.slug)}
                      aria-current={
                        page?.slug === item.slug ? "page" : undefined
                      }
                      style={{
                        paddingLeft: `${12 + (item.number.split(".").length - 1) * 12}px`,
                      }}
                      onClick={choosePage}
                    >
                      <span>{item.number}</span>
                      {item.title}
                    </a>
                  ))}
              </div>
            ))}
          </nav>
          <a
            className="wiki-sidebar-source"
            href={index.source}
            target="_blank"
            rel="noreferrer"
          >
            {t("DeepWiki kaynağı ↗")}
            <span>{t("7 Ekim 2026 arşivi")}</span>
          </a>
        </aside>
        <main id="wiki-content" className="wiki-content" tabIndex={-1}>
          {!search && page && (
            <details className="wiki-inline-toc">
              <summary>{t("Bu sayfada")}</summary>
              <nav aria-label={t("Mobil sayfa içindekiler")}>
                {page.headings.map((heading) => (
                  <a key={heading.id} href={wikiLink(page.slug, heading.id)}>
                    {heading.title}
                  </a>
                ))}
              </nav>
            </details>
          )}
          {search ? (
            <section className="wiki-search-results" aria-live="polite">
              <p className="eyebrow">{t("WIKI ARAMASI")}</p>
              <h1>“{query.trim()}”</h1>
              <p>
                {results.length} {t("sayfa bulundu.")}
              </p>
              <button className="wiki-back" onClick={() => setQuery("")}>
                {t("← İçeriğe dön")}
              </button>
              {results.length ? (
                results.map((item) => {
                  const start = Math.max(
                    0,
                    item.searchText.toLocaleLowerCase(locale).indexOf(search) -
                      70,
                  );
                  return (
                    <a
                      key={item.slug}
                      href={wikiLink(item.slug)}
                      onClick={choosePage}
                    >
                      <small>
                        {item.number} /{" "}
                        {t(groups[Number(item.number.split(".")[0]) - 1])}
                      </small>
                      <h2>
                        {item.title} <span>↗</span>
                      </h2>
                      <p>…{item.searchText.slice(start, start + 240)}…</p>
                    </a>
                  );
                })
              ) : (
                <div className="wiki-empty">
                  <h2>{t("Sonuç bulunamadı.")}</h2>
                  <p>
                    {t(
                      "Yüz, yazım ritmi, oturum veya Python gibi bir terim deneyin.",
                    )}
                  </p>
                </div>
              )}
            </section>
          ) : page ? (
            <WikiArticle
              key={`${locale}/${page.slug}`}
              page={page}
              section={section}
              showDiagram={setDiagram}
              locale={locale}
            />
          ) : (
            <div className="wiki-empty">
              <p className="eyebrow">404 / WIKI</p>
              <h1>{t("Bu sayfa bulunamadı.")}</h1>
              <p>
                {t("Soldaki konulardan birini seçin veya genel bakışa dönün.")}
              </p>
              <a className="button primary" href={wikiLink(pages[0].slug)}>
                {t("Genel bakış →")}
              </a>
            </div>
          )}
        </main>
        {!search && page && (
          <aside className="wiki-toc">
            <p>{t("BU SAYFADA")}</p>
            <nav aria-label={t("Sayfa içindekiler")}>
              {page.headings.map((heading) => (
                <a
                  key={heading.id}
                  href={wikiLink(page.slug, heading.id)}
                  style={{ paddingLeft: heading.level > 2 ? 12 : 0 }}
                >
                  {heading.title}
                </a>
              ))}
            </nav>
            <div className="wiki-toc-foot">
              <span>{t("Kaynak kodla birlikte okuyun.")}</span>
              <a href={page.source} target="_blank" rel="noreferrer">
                {t("DeepWiki’de aç ↗")}
              </a>
            </div>
          </aside>
        )}
      </div>
      {diagram && (
        <DiagramViewer
          diagram={diagram}
          close={() => setDiagram(null)}
          locale={locale}
        />
      )}
    </div>
  );
}
