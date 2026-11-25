import { createContext, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { tr } from "@/lib/i18n";
import { cx } from "./ui";

const LineCtx = createContext<number | null>(null);
const ToggleCtx = createContext<((line: number) => void) | null>(null);

function CheckBox({ checked }: { checked: boolean }) {
  const line = useContext(LineCtx);
  const toggle = useContext(ToggleCtx);
  if (!toggle || line === null) {
    return <span aria-hidden className={cx("mr-2 inline-grid h-4 w-4 translate-y-[2px] place-items-center rounded border", checked ? "border-pos bg-pos text-white" : "border-line")}>{checked ? "✓" : ""}</span>;
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? tr("Mark as not done", "Als offen markieren") : tr("Mark as done", "Als erledigt markieren")}
      onClick={(e) => {
        e.stopPropagation();
        toggle(line);
      }}
      className={cx(
        "mr-2 inline-grid h-[18px] w-[18px] translate-y-[3px] place-items-center rounded-[5px] border text-[11px] font-bold leading-none transition",
        checked ? "border-pos bg-pos text-white" : "border-muted/50 bg-surface hover:border-brand",
      )}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

/**
 * Safe Markdown: no raw HTML, links open externally without a referrer.
 * With onToggleCheck, checklist items ("- [ ] …") can be ticked off; the callback gets the source line.
 */
export function Markdown({ children, className, onToggleCheck }: { children: string; className?: string; onToggleCheck?: (line: number) => void }) {
  return (
    <ToggleCtx.Provider value={onToggleCheck ?? null}>
      <div className={cx("prose-nalpia", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ href, children: c }) => {
              const internal = !!href && /^\/(?!\/)/.test(href);
              const safe = href && (internal || /^(https?:|mailto:|tel:)/i.test(href)) ? href : undefined;
              return (
                <a href={safe} target={internal ? undefined : "_blank"} rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                  {c}
                </a>
              );
            },
            img: () => null,
            li: ({ node, children: c, className: cls }) => (
              <LineCtx.Provider value={node?.position?.start.line ?? null}>
                <li className={cls}>{c}</li>
              </LineCtx.Provider>
            ),
            input: ({ type, checked }) => (type === "checkbox" ? <CheckBox checked={!!checked} /> : null),
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    </ToggleCtx.Provider>
  );
}
