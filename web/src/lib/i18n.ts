import { de as dfDe, enGB as dfEn } from "date-fns/locale";
import { useSyncExternalStore } from "react";

/**
 * Language switch (English/German). Texts live inline next to the code: `tr("Save", "Speichern")`.
 * Changing the language re-renders the whole app (see LangRoot in main.tsx), so module-level
 * label tables must read their labels lazily (getters or functions), never at import time.
 */
export type Lang = "en" | "de";

const KEY = "nalpia.lang";

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "de") return v;
  } catch {
    /* ignore */
  }
  return "en";
}

let current: Lang = initial();
if (typeof document !== "undefined") document.documentElement.lang = current;
const listeners = new Set<() => void>();

export const getLang = () => current;

/** Pick the text for the current language */
export function tr(en: string, de: string): string {
  return current === "de" ? de : en;
}

/** Locale for Intl/toLocale… calls */
export const locale = () => (current === "de" ? "de-DE" : "en-GB");
/** date-fns locale */
export const dfLocale = () => (current === "de" ? dfDe : dfEn);

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);
