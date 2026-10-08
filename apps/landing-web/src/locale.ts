import english from "./translations.json";

export type Locale = "tr" | "en";
export const preferenceKey = "securekit.language";

export function localeFromPath(path: string): Locale | null {
  return (/^\/(tr|en)(?:\/|$)/.exec(path)?.[1] as Locale | null) ?? null;
}

export function preferredLocale(
  languages: readonly string[],
  saved?: string | null,
): Locale {
  if (saved === "tr" || saved === "en") return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "tr" || base === "en") return base;
  }
  return "en";
}

export function translator(locale: Locale) {
  return (text: string) =>
    locale === "en"
      ? ((english as Record<string, string>)[text] ?? text)
      : text;
}

export const seo = {
  tr: {
    title: "SecureKit — Çok Sinyalli Biyometrik Kimlik Doğrulama",
    description:
      "SecureKit: yüz, ses, yazım ritmi, kart ve ağ sinyallerini birleştiren modüler biyometrik kimlik doğrulama araç seti. SDK, API ve teknik kaynakları keşfedin.",
    ogLocale: "tr_TR",
  },
  en: {
    title: "SecureKit — Multi-Signal Biometric Authentication",
    description:
      "SecureKit is a modular biometric authentication toolkit combining face, voice, typing rhythm, card and network signals. Explore the SDK, API and technical resources.",
    ogLocale: "en_US",
  },
};
