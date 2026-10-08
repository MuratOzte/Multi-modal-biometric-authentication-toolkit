import english from "./wiki-index.json";
import turkish from "./wiki-index-tr.json";
import { translator, type Locale } from "./locale";

const messages: Record<string, string> = {
  "Genel bakış": "Overview",
  "ASP.NET Core API": "ASP.NET Core API",
  "Node API & geçiş": "Node API & migration",
  "SDK, Core & demo": "SDK, Core & demo",
  "Python işçileri": "Python workers",
  "Test & kabul": "Testing & acceptance",
  Sözlük: "Glossary",
  "Teknik diyagram": "Technical diagram",
  "Diyagramı küçült": "Zoom out",
  "Diyagramı büyüt": "Zoom in",
  "Diyagramı kapat": "Close diagram",
  "dk okuma": "min read",
  "Bağlantı kopyalandı ✓": "Link copied ✓",
  "Bağlantıyı kopyala ↗": "Copy link ↗",
  "İçerik yüklenemedi.": "Content could not be loaded.",
  "Bağlantınızı kontrol edip tekrar deneyin.":
    "Check your connection and try again.",
  "Tekrar dene ↻": "Try again ↻",
  "Sayfa yükleniyor…": "Loading page…",
  "DeepWiki arşivi": "DeepWiki archive",
  "7 Ekim 2026": "October 7, 2026",
  "Kaynak referansları ve özgün teknik diyagramlar korunmuştur.":
    "Source references and original technical diagrams are preserved.",
  "Kaynak sayfa ↗": "Source page ↗",
  "Önceki ve sonraki sayfa": "Previous and next page",
  "← ÖNCEKİ": "← PREVIOUS",
  "SONRAKİ →": "NEXT →",
  "Sayfa bulunamadı": "Page not found",
  "Wiki üst gezinme": "Wiki top navigation",
  "Tanıtım sitesine dön": "Back to the main site",
  "Konuları kapat ×": "Close topics ×",
  "Konular ☰": "Topics ☰",
  sayfa: "pages",
  "PROJE KAYNAKLARI": "PROJECT RESOURCES",
  "27 sayfa · 7 konu grubu": "27 pages · 7 topic groups",
  "Wiki içinde ara…": "Search the wiki…",
  "Wiki içinde ara": "Search the wiki",
  "sayfa bulundu.": "pages found.",
  "Başka bir terim deneyin.": "Try another term.",
  "Wiki konuları": "Wiki topics",
  "DeepWiki kaynağı ↗": "DeepWiki source ↗",
  "7 Ekim 2026 arşivi": "October 7, 2026 archive",
  "Bu sayfada": "On this page",
  "Mobil sayfa içindekiler": "Mobile table of contents",
  "WIKI ARAMASI": "WIKI SEARCH",
  "← İçeriğe dön": "← Back to content",
  "Sonuç bulunamadı.": "No results found.",
  "Yüz, yazım ritmi, oturum veya Python gibi bir terim deneyin.":
    "Try a term such as face, keystroke, session or Python.",
  "Bu sayfa bulunamadı.": "This page could not be found.",
  "Soldaki konulardan birini seçin veya genel bakışa dönün.":
    "Choose a topic on the left or return to the overview.",
  "Genel bakış →": "Overview →",
  "BU SAYFADA": "ON THIS PAGE",
  "Sayfa içindekiler": "Table of contents",
  "Kaynak kodla birlikte okuyun.": "Read alongside the source code.",
  "DeepWiki’de aç ↗": "Open in DeepWiki ↗",
};

export type WikiPage = (typeof english.pages)[number];

export function wikiPages(locale: Locale): WikiPage[] {
  return locale === "tr" ? turkish.pages : english.pages;
}

export function wikiTranslator(locale: Locale) {
  const shared = translator(locale);
  return (text: string) =>
    locale === "en" ? (messages[text] ?? shared(text)) : text;
}

export function wikiContentPath(locale: Locale, slug: string, base: string) {
  return `${base}wiki/${locale === "tr" ? "tr/" : ""}${slug}.html`;
}

// The archived diagrams are shared by both languages. Resolve their URLs from
// Vite's base rather than the document's /tr/ or /en/ directory.
export function prepareWikiHtml(html: string, locale: Locale, base: string) {
  return html
    .replace(/src="(?:\.\/|\/)wiki\/diagrams\//g, `src="${base}wiki/diagrams/`)
    .replace(
      /aria-label="Diyagram \d+: büyüt"/g,
      `aria-label="${locale === "tr" ? "Diyagramı büyüt" : "Enlarge diagram"}"`,
    )
    .replace(
      /aria-label="Diyagramı büyüt"/g,
      `aria-label="${locale === "tr" ? "Diyagramı büyüt" : "Enlarge diagram"}"`,
    )
    .replace(
      /Diyagramı büyütmek için seçin ↗/g,
      locale === "tr"
        ? "Diyagramı büyütmek için seçin ↗"
        : "Select to enlarge the diagram ↗",
    )
    .replace(
      /aria-label="Documentation table"/g,
      `aria-label="${locale === "tr" ? "Belge tablosu" : "Documentation table"}"`,
    );
}
