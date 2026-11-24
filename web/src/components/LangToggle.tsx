import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { setLang, useLang, type Lang } from "@/lib/i18n";
import { useMe } from "@/lib/queries";
import { cx } from "./ui";

/** Small DE | EN switch. Logged-in users also store the choice in their profile (applies on every device). */
export function LangToggle({ className, persist = true }: { className?: string; persist?: boolean }) {
  const lang = useLang();
  const choose = (l: Lang) => {
    if (l === lang) return;
    if (persist) void api.patch("/api/me/prefs", { lang: l }).catch(() => undefined);
    setLang(l);
  };
  return (
    <div role="group" aria-label={lang === "de" ? "Sprache" : "Language"} className={cx("inline-flex h-8 items-center rounded-lg bg-surface2 p-0.5 text-[12px] font-bold", className)}>
      {(["de", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          title={l === "de" ? "Deutsch" : "English"}
          onClick={() => choose(l)}
          className={cx("h-7 rounded-md px-2 uppercase transition", lang === l ? "bg-surface text-ink shadow-[0_1px_2px_rgb(15_27_45/.12)]" : "text-muted hover:text-ink")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** After login: apply the language stored in the profile (once per session) */
export function useProfileLang() {
  const me = useMe().data;
  const done = useRef(false);
  const saved = me?.prefs?.lang;
  useEffect(() => {
    if (done.current || !me) return;
    done.current = true;
    if (saved === "en" || saved === "de") setLang(saved);
  }, [me, saved]);
}
