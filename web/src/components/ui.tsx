import clsx from "clsx";
import { Check, Loader2 } from "lucide-react";
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AVATAR, initials } from "@/lib/format";
import { tr } from "@/lib/i18n";

export const cx = clsx;

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "subtle";
type BtnSize = "sm" | "md" | "lg";

const variants: Record<BtnVariant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand/90 border border-brand",
  secondary: "bg-surface text-ink border border-line hover:bg-surface2",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-surface2",
  subtle: "bg-surface2 text-ink border border-transparent hover:bg-line/60",
  danger: "bg-surface text-neg border border-neg/30 hover:bg-neg-soft",
  accent: "bg-accent text-[#05224B] border border-accent hover:brightness-105",
};
const sizes: Record<BtnSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md"; tone?: "default" | "rail" }>(
  function IconButton({ label, size = "md", tone = "default", className, children, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cx(
          "relative inline-grid shrink-0 place-items-center rounded-[10px] transition active:scale-95 disabled:opacity-40",
          size === "md" ? "h-10 w-10" : "h-8 w-8",
          tone === "rail" ? "text-rail-ink hover:bg-rail-hover" : "text-ink hover:bg-surface2",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-muted", className)} aria-label={tr("Loading", "Lädt")} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-surface2", className)} aria-hidden />;
}

export function Avatar({
  name,
  color,
  src,
  size = 32,
  className,
  ring,
}: {
  name: string;
  color?: string;
  /** Profile photo; without one (or if it fails to load) the initials are shown */
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className={cx("inline-block shrink-0 select-none rounded-full bg-surface2 object-cover", ring && "ring-2 ring-surface", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cx(
        "inline-grid shrink-0 select-none place-items-center rounded-full font-bold tracking-[-0.02em]",
        AVATAR[color ?? "slate"] ?? AVATAR.slate,
        ring && "ring-2 ring-surface",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", className ?? "bg-surface2 text-muted")}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-muted">{icon}</div>}
      <p className="font-bold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className={cx("scrollbar-none inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 font-semibold transition",
            size === "md" ? "h-9 text-sm" : "h-7 text-[13px]",
            o.value === value ? "bg-surface text-ink shadow-[0_1px_3px_rgb(15_27_45/.12)]" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="num text-[11px] text-accent-ink">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed opacity-60")}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition", checked ? "bg-brand" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function Field({ label, error, hint, children, className, htmlFor }: { label?: string; error?: string; hint?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-[13px] font-medium text-neg">{error}</p> : hint ? <p className="mt-1 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

const PRIO_RING: Record<string, string> = { hoch: "border-neg", mittel: "border-accent", niedrig: "border-muted/50" };

/** Round checkbox – generous hit area for touch. */
export function TaskCheck({ done, onToggle, priority = "mittel", label }: { done: boolean; onToggle: () => void; priority?: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={label}
      aria-pressed={done}
      className="-m-2 grid shrink-0 place-items-center p-2"
    >
      <span
        className={cx(
          "grid h-[22px] w-[22px] place-items-center rounded-full border-2 transition",
          done ? "animate-check-pop border-pos bg-pos text-white" : cx(PRIO_RING[priority], "hover:bg-surface2"),
        )}
      >
        {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

export function Progress({ value, className, tone = "brand", label = tr("Progress", "Fortschritt") }: { value: number; className?: string; tone?: "brand" | "pos" | "accent"; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cx("h-1.5 overflow-hidden rounded-full bg-surface2", className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${pct}%`}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", tone === "pos" ? "bg-pos" : tone === "accent" ? "bg-accent" : "bg-brand")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Section({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cx("card min-w-0", className)} aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3.5">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        {action}
      </div>
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Dot({ className }: { className?: string }) {
  return <span className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)} aria-hidden />;
}
