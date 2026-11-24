import { useEffect, useState } from "react";
import { locale, tr } from "@/lib/i18n";

/**
 * Show long lists step by step: renders `step` entries first, "Show more" loads the next batch.
 * Resets whenever `resetKey` changes (e.g. search or filter).
 */
export function usePaged<T>(items: T[], step = 100, resetKey?: unknown) {
  const [n, setN] = useState(step);
  useEffect(() => setN(step), [resetKey, step]);
  return { visible: items.length > n ? items.slice(0, n) : items, rest: Math.max(0, items.length - n), more: () => setN((x) => x + step) };
}

export function MoreButton({ rest, step, onClick, className = "" }: { rest: number; step: number; onClick: () => void; className?: string }) {
  if (rest <= 0) return null;
  return (
    <button type="button" onClick={onClick} className={`link text-[13px] ${className}`}>
      {rest > step
        ? tr(`Show ${step.toLocaleString(locale())} more (${rest.toLocaleString(locale())} left)`, `${step.toLocaleString(locale())} weitere zeigen (noch ${rest.toLocaleString(locale())})`)
        : tr(`Show remaining ${rest.toLocaleString(locale())}`, `Restliche ${rest.toLocaleString(locale())} zeigen`)}
    </button>
  );
}
