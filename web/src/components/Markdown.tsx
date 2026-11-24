import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./ui";

/** Safe Markdown: no raw HTML, links open externally without a referrer. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx("prose-nalpia", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children: c }) => {
            const internal = !!href && /^\/(?!\/)/.test(href);
            const safe = href && (internal || /^(https?:|mailto:|tel:)/i.test(href)) ? href : undefined;
            return (
              <a href={safe} target={internal ? undefined : "_blank"} rel="noopener noreferrer">
                {c}
              </a>
            );
          },
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
