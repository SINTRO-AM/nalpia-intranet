import { useSyncExternalStore } from "react";
import { getLang, type Lang } from "./i18n";
import { plainText } from "./text";

/**
 * Content in the interface language. Texts people wrote (news, tasks, notes, profiles …) are shown
 * translated when they are in the other language: `useTx(text)` / `<Tx text={…} />` return the
 * translation once it is there and the original until then (or when nothing needs translating).
 * Requests are batched and the server keeps every translation, so each text is translated only once.
 * Never use the translated text as the value of an input: edit forms work on the original.
 */

const DE_WORDS = new Set(
  "und oder nicht kein keine keinen der die das den dem des ein eine einen einem einer ist sind war wird werden wurde mit für auf aus bei nach von vom zum zur über unter ohne bis auch noch schon nur jetzt hier wir ihr sie es ich du dein deine unser unsere bitte danke sowie wie als wenn dann dass weil damit gibt haben hat kann können muss müssen soll sollen zu im am beim ins neue neuen neuer erste ersten bereits etwa vor seit gegen durch".split(" "),
);
const EN_WORDS = new Set(
  "the and or not no a of to on at by for with from is are were be been will would can could should must this that these those it its we you your our they their i he she please thanks as if then because have has had do does did new first already about before since against through into onto up out".split(" "),
);

/** Same rule as on the server (lib/translate.ts): "de", "en" or null when unclear */
export function detectLang(text: string): Lang | null {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  if (words.length < 2) return null;
  let de = /[äöüß]/i.test(text) ? 1.5 : 0;
  let en = 0;
  for (const w of words) {
    if (DE_WORDS.has(w)) de++;
    if (EN_WORDS.has(w)) en++;
  }
  if (de === 0 && en === 0) return null;
  if (de > en * 1.2) return "de";
  if (en > de * 1.2) return "en";
  return null;
}

const MAX_TEXTS = 60;
const MAX_CHARS = 8000;

/** per language: text → translation (null = show the original) */
const cache: Record<Lang, Map<string, string | null>> = { en: new Map(), de: new Map() };
const queued: Record<Lang, Set<string>> = { en: new Set(), de: new Set() };
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const fn of listeners) fn();
};

/** Long texts only when their language is clearly the other one; short ones (labels, tags, roles) are left to the server */
const needs = (text: string, lang: Lang) => {
  if (!text || text.length > MAX_CHARS || !/[a-zäöüß]{3}/i.test(text)) return false;
  const src = detectLang(text);
  if (src) return src !== lang;
  return text.trim().split(/\s+/).length <= 4;
};

async function flush() {
  timer = null;
  for (const lang of ["en", "de"] as Lang[]) {
    const all = [...queued[lang]];
    queued[lang].clear();
    for (let i = 0; i < all.length; i += MAX_TEXTS) {
      const texts = all.slice(i, i + MAX_TEXTS);
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-requested-with": "nalpia-intranet", "x-lang": lang },
          body: JSON.stringify({ lang, texts }),
        });
        const data = res.ok ? ((await res.json()) as { translations: (string | null)[] }) : null;
        texts.forEach((t, k) => cache[lang].set(t, data?.translations[k] ?? null));
      } catch {
        texts.forEach((t) => cache[lang].set(t, null));
      }
      emit();
    }
  }
}

function request(text: string, lang: Lang) {
  if (cache[lang].has(text) || queued[lang].has(text)) return;
  queued[lang].add(text);
  if (!timer) timer = setTimeout(() => void flush(), 40);
}

/** Translation of `text` into the interface language, or the original */
export function txNow(text: string | null | undefined): string {
  const t = text ?? "";
  const lang = getLang();
  if (!needs(t, lang)) return t;
  const hit = cache[lang].get(t);
  if (hit === undefined) request(t, lang);
  return hit ?? t;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Re-renders when translations arrive */
export function useTxVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** The text in the interface language (translated content), the original until the translation is there */
export function useTx(text: string | null | undefined): string {
  useTxVersion();
  return txNow(text);
}

/** Whether `text` is shown translated */
export function useIsTranslated(text: string | null | undefined): boolean {
  useTxVersion();
  const t = text ?? "";
  const lang = getLang();
  return needs(t, lang) && !!cache[lang].get(t);
}

/** Inline translated text */
export function Tx({ text }: { text: string | null | undefined }) {
  return <>{useTx(text)}</>;
}

/** Shown below an editable field whose content is in the other language: the translation, read-only */
export function TxNote({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const tx = useTx(text);
  if (!text || tx === text) return null;
  return (
    <p className={`mt-1.5 whitespace-pre-wrap rounded-lg bg-surface2/70 px-3 py-2 text-[13px] leading-relaxed text-muted ${className}`}>
      <span className="mr-1.5 font-semibold text-ink">{getLang() === "de" ? "Übersetzung:" : "Translation:"}</span>
      {tx}
    </p>
  );
}

/** Plain-text preview (Markdown removed) in the interface language */
export function TxPlain({ text }: { text: string | null | undefined }) {
  return <>{plainText(useTx(text))}</>;
}
