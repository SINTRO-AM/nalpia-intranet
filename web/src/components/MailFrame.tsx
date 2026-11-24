import DOMPurify from "dompurify";
import { ImageOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "@/lib/i18n";

/**
 * Sanitizes e-mail HTML: no scripts/forms, external images (tracking pixels) only on request.
 * Rendered in a sandboxed iframe without script execution.
 */
function sanitize(html: string, allowImages: boolean) {
  let blocked = 0;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const el = node as Element;
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      const href = el.getAttribute("href") ?? "";
      if (!/^(https?:|mailto:|tel:|#)/i.test(href)) el.removeAttribute("href");
    }
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      if (/^cid:/i.test(src)) {
        el.removeAttribute("src");
        el.setAttribute("alt", el.getAttribute("alt") || tr("[Embedded image]", "[Eingebettetes Bild]"));
      } else if (!allowImages && src && !/^data:image\//i.test(src)) {
        // Everything except embedded data: images counts as external (including //host/… and relative paths)
        blocked++;
        el.removeAttribute("src");
        el.setAttribute("data-blocked", "1");
      }
      el.removeAttribute("srcset");
    }
    if (!allowImages && el.hasAttribute("background")) {
      el.removeAttribute("background");
      blocked++;
    }
    if (!allowImages && el.hasAttribute("style")) {
      const st = el.getAttribute("style") ?? "";
      if (/url\(/i.test(st)) {
        el.setAttribute("style", st.replace(/url\([^)]*\)/gi, "none"));
        blocked++;
      }
    }
  });
  let clean = DOMPurify.sanitize(html, {
    FORCE_BODY: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "frame", "frameset", "svg", "math"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "formaction"],
    ALLOW_DATA_ATTR: false,
  }) as string;
  DOMPurify.removeHook("afterSanitizeAttributes");
  if (!allowImages) clean = clean.replace(/@import[^;]+;/gi, "").replace(/url\((?!\s*['"]?data:)[^)]*\)/gi, "none");
  return { clean, blocked };
}

const BASE_CSS = `
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font: 15px/1.55 "Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif; color: #0E1A2C; word-wrap: break-word; overflow-wrap: anywhere; padding: 16px 18px; }
  img { max-width: 100% !important; height: auto; }
  img[data-blocked] { display: inline-block; width: 0; height: 0; }
  table { max-width: 100% !important; }
  a { color: #2C64A8; }
  blockquote { margin: 8px 0 8px 4px; padding-left: 12px; border-left: 2px solid #DCE2EB; color: #44546A; }
  pre { white-space: pre-wrap; }
`;

export function MailFrame({ html, messageKey }: { html: string; messageKey: string }) {
  const [allowImages, setAllowImages] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  useEffect(() => setAllowImages(false), [messageKey]);

  const { clean, blocked } = useMemo(() => sanitize(html || `<p><i>${tr("No content.", "Kein Inhalt.")}</i></p>`, allowImages), [html, allowImages]);
  // Second line of defense: a CSP in the iframe blocks everything except inline styles and – only after a click – images.
  const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${allowImages ? " https:" : ""}`;
  const doc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"><base target="_blank"><style>${BASE_CSS}</style></head><body>${clean}</body></html>`;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const d = frame.contentDocument;
      if (!d?.documentElement) return;
      setHeight(Math.max(80, Math.min(Math.ceil(d.documentElement.offsetHeight), 30000)));
    };
    const onLoad = () => {
      measure();
      const d = frame.contentDocument;
      if (d?.body && "ResizeObserver" in window) {
        ro = new ResizeObserver(measure);
        ro.observe(d.body);
      }
      d?.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure));
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [doc]);

  return (
    <div>
      {blocked > 0 && !allowImages && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2 text-[13px] text-muted">
          <ImageOff className="h-4 w-4 shrink-0" />
          <span className="flex-1">{tr("External images were blocked (tracking protection).", "Externe Bilder wurden blockiert (Schutz vor Tracking).")}</span>
          <button className="link shrink-0" onClick={() => setAllowImages(true)}>
            {tr("Load images", "Bilder laden")}
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        title={tr("E-mail content", "E-Mail-Inhalt")}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={doc}
        className="block w-full overflow-hidden rounded-xl border border-line bg-white"
        style={{ height }}
      />
    </div>
  );
}
