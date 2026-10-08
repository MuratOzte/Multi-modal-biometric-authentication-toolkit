import { renderToString } from "react-dom/server";
import App from "./App";
import { seo, type Locale } from "./locale";

export { seo };
export { localeFromPath, preferenceKey, preferredLocale } from "./locale";
export function render(locale: Locale) {
  return renderToString(<App locale={locale} />);
}
