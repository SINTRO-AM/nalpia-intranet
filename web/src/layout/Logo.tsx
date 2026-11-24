import { STAR_MARK_PATH, STAR_PATH, STAR_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "./logo-paths";

type P = { className?: string; title?: string; /** Star colour; defaults to brand turquoise */ star?: string };

/** nalpia wordmark. Letters follow `text-*` (currentColor), the i-dot star stays turquoise. */
export function Wordmark({ className, title = "nalpia", star = "#2CC1CC" }: P) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={className} role="img" aria-label={title}>
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
      <path fill={star} d={STAR_PATH} />
    </svg>
  );
}

/** Same as the wordmark – kept for call sites that expect a full logo. */
export function LogoFull(p: P) {
  return <Wordmark {...p} />;
}

/** Logo mark: turquoise star on dark blue – like the app icon. */
export function LogoMark({ className }: P) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#05224B" />
      <svg x="14" y="14" width="36" height="36" viewBox={STAR_VIEWBOX}>
        <path fill="#2CC1CC" d={STAR_MARK_PATH} />
      </svg>
    </svg>
  );
}

/** The star alone, in currentColor – for labels and bullets. */
export function Star({ className }: { className?: string }) {
  return (
    <svg viewBox={STAR_VIEWBOX} className={className} aria-hidden>
      <path fill="currentColor" d={STAR_MARK_PATH} />
    </svg>
  );
}
