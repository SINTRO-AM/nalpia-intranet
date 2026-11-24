import { useState } from "react";
import { tr } from "@/lib/i18n";
import { useIsTranslated, useTx } from "@/lib/translate";
import { Markdown } from "./Markdown";

/** Markdown content in the interface language, with a switch back to the original when it was translated */
export function TxMarkdown({ text, className }: { text: string; className?: string }) {
  const tx = useTx(text);
  const translated = useIsTranslated(text);
  const [original, setOriginal] = useState(false);
  return (
    <>
      <Markdown className={className}>{translated && !original ? tx : text}</Markdown>
      {translated && (
        <p className="mt-3 text-[12.5px] text-muted">
          {original ? tr("Original", "Original") : tr("Translated automatically", "Automatisch übersetzt")} ·{" "}
          <button type="button" className="link" onClick={() => setOriginal(!original)}>
            {original ? tr("Show translation", "Übersetzung zeigen") : tr("Show original", "Original zeigen")}
          </button>
        </p>
      )}
    </>
  );
}
