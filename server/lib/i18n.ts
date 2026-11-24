/**
 * Language per request (English/German). The web app sends `x-lang`; without it the user's saved
 * preference applies, otherwise English. Use `tr("English", "Deutsch")` anywhere on the server –
 * it reads the language of the current request (AsyncLocalStorage), so error messages, e-mails and
 * AI prompts follow the user's choice. Module-level label tables must call tr lazily (functions).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type Lang = "en" | "de";

const store = new AsyncLocalStorage<{ lang: Lang; explicit: boolean }>();

export const parseLang = (v: unknown): Lang | null => (v === "de" || v === "en" ? v : null);

export function runWithLang<T>(lang: Lang | null, fn: () => T): T {
  return store.run({ lang: lang ?? "en", explicit: !!lang }, fn);
}

/** Use the saved preference when the request did not name a language */
export function preferLang(lang: unknown) {
  const s = store.getStore();
  const l = parseLang(lang);
  if (s && !s.explicit && l) s.lang = l;
}

export const currentLang = (): Lang => store.getStore()?.lang ?? "en";
export const tr = (en: string, de: string) => (currentLang() === "de" ? de : en);
/** Locale tag for Intl/toLocale… calls */
export const localeTag = () => (currentLang() === "de" ? "de-DE" : "en-GB");
