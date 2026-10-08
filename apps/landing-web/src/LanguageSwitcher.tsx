import { preferenceKey, translator, type Locale } from "./locale";

export default function LanguageSwitcher({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <div
      className="language-switcher"
      role="group"
      aria-label={t("Dil seçimi")}
    >
      {(["tr", "en"] as const).map((language) => (
        <a
          key={language}
          href={`/${language}/`}
          hrefLang={language}
          lang={language}
          aria-label={language === "tr" ? "Türkçe" : "English"}
          aria-current={language === locale ? "page" : undefined}
          onClick={(event) => {
            try {
              localStorage.setItem(preferenceKey, language);
            } catch {
              /* Storage may be disabled. */
            }
            event.currentTarget.href = `/${language}/${window.location.search}${window.location.hash}`;
          }}
        >
          {language.toUpperCase()}
        </a>
      ))}
    </div>
  );
}
