import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { addDays, todayISO } from "@/lib/format";
import { getLang, tr } from "@/lib/i18n";
import { useContacts, useMilestones, useOrgs, useTopics, useUsers } from "@/lib/queries";
import { cx } from "./ui";
import { txNow, useTxVersion } from "@/lib/translate";

/** Native select – on phones this opens the system picker (fast, accessible). */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className={cx("relative", className)}>
      <select {...rest} className="field appearance-none pr-9">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}

export function UserSelect({
  value,
  onChange,
  allowNone = true,
  noneLabel = tr("Nobody", "Niemand"),
  id,
  className,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
  className?: string;
}) {
  const { data: users } = useUsers();
  useTxVersion();
  return (
    <Select id={id} className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel}</option>}
      {(users ?? []).map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
          {u.title ? ` – ${txNow(u.title)}` : ""}
        </option>
      ))}
    </Select>
  );
}

export function MilestoneSelect({ value, onChange, id }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string }) {
  const { data } = useMilestones();
  useTxVersion();
  return (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{tr("No milestone", "Kein Meilenstein")}</option>
      {(data ?? [])
        .filter((m) => m.status !== "erreicht" || m.id === value)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {txNow(m.title)}
          </option>
        ))}
    </Select>
  );
}

/** Topic picker: open topics grouped into internal and external (the current one stays even when closed). */
export function TopicSelect({ value, onChange, id, className, noneLabel = tr("No topic", "Kein Thema") }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string; className?: string; noneLabel?: string }) {
  const { data } = useTopics({ state: "all" });
  useTxVersion();
  const list = (data ?? []).filter((t) => !["erledigt", "verworfen"].includes(t.stage) || t.id === value);
  const group = (kind: "intern" | "extern") => list.filter((t) => t.kind === kind);
  return (
    <Select id={id} className={className} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{noneLabel}</option>
      {(["intern", "extern"] as const).map(
        (k) =>
          group(k).length > 0 && (
            <optgroup key={k} label={k === "intern" ? tr("Internal", "Intern") : tr("External", "Extern")}>
              {group(k).map((t) => (
                <option key={t.id} value={t.id}>
                  {txNow(t.title)}
                </option>
              ))}
            </optgroup>
          ),
      )}
    </Select>
  );
}

const PRIOS = [
  { v: "hoch", get label() { return tr("High", "Hoch"); }, cls: "data-[on=true]:bg-neg-soft data-[on=true]:text-neg data-[on=true]:border-neg/40" },
  { v: "mittel", get label() { return tr("Medium", "Mittel"); }, cls: "data-[on=true]:bg-accent-soft data-[on=true]:text-accent-ink data-[on=true]:border-accent/40" },
  { v: "niedrig", get label() { return tr("Low", "Niedrig"); }, cls: "data-[on=true]:bg-surface2 data-[on=true]:text-ink data-[on=true]:border-line" },
] as const;

export function PriorityPicker({ value, onChange }: { value: string; onChange: (v: "hoch" | "mittel" | "niedrig") => void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label={tr("Priority", "Priorität")}>
      {PRIOS.map((p) => (
        <button
          key={p.v}
          type="button"
          role="radio"
          aria-checked={value === p.v}
          data-on={value === p.v}
          onClick={() => onChange(p.v)}
          className={cx("h-9 flex-1 rounded-[10px] border border-line bg-surface text-sm font-semibold text-muted transition", p.cls)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function nextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = ((8 - day) % 7) || 7;
  return addDays(todayISO(), diff);
}

export function DueDateField({ value, onChange, id }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string }) {
  const today = todayISO();
  const quick = [
    { label: tr("Today", "Heute"), v: today },
    { label: tr("Tomorrow", "Morgen"), v: addDays(today, 1) },
    { label: tr("Next week", "Nächste Woche"), v: nextMonday() },
  ];
  return (
    <div>
      <input id={id} type="date" className="field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onChange(q.v)}
            className={cx(
              "h-7 rounded-full border px-2.5 text-[12.5px] font-semibold transition",
              value === q.v ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {q.label}
          </button>
        ))}
        {value && (
          <button type="button" onClick={() => onChange(null)} className="h-7 rounded-full px-2.5 text-[12.5px] font-semibold text-muted hover:text-ink">
            {tr("Clear", "Entfernen")}
          </button>
        )}
      </div>
    </div>
  );
}

export interface SearchOption {
  id: string;
  label: string;
  hint?: string;
  group?: string;
}

const norm = (t: string) => t.toLocaleLowerCase(getLang()).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Searchable select for long lists (organizations, contacts). Expands inline below the field –
 * no floating popover, so it works reliably inside bottom sheets on phones.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  noneLabel,
  placeholder,
  id,
  label,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  options: SearchOption[];
  noneLabel: string;
  placeholder: string;
  id?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value);
  const hits = useMemo(() => {
    const t = norm(q.trim());
    const list = t ? options.filter((o) => norm(`${o.label} ${o.hint ?? ""}`).includes(t)) : options;
    return list.slice(0, 8);
  }, [q, options]);
  const total = useMemo(() => (q.trim() ? options.filter((o) => norm(`${o.label} ${o.hint ?? ""}`).includes(norm(q.trim()))).length : options.length), [q, options]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const choose = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  if (!open)
    return (
      <div className="relative">
        <button
          type="button"
          id={id}
          aria-label={`${label}: ${selected?.label ?? noneLabel}`}
          onClick={() => setOpen(true)}
          className="field flex items-center gap-2 pr-9 text-left"
        >
          <span className={cx("min-w-0 flex-1 truncate", !selected && "text-muted")}>
            {selected ? selected.label : noneLabel}
            {selected?.group && <span className="text-muted"> ({selected.group})</span>}
          </span>
        </button>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    );

  const rows: (SearchOption | null)[] = [null, ...hits];
  return (
    <div
      ref={box}
      className="rounded-xl border border-line bg-surface p-1.5 shadow-pop"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setQ("");
        }
      }}
    >
      <div className="flex items-center gap-2 px-2">
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(rows.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const r = rows[active];
              choose(r ? r.id : null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setQ("");
            }
          }}
        />
      </div>
      <ul id={listId} role="listbox" aria-label={label} className="mt-1 border-t border-line pt-1">
        {rows.map((o, i) => (
          <li
            key={o?.id ?? "none"}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={(o?.id ?? null) === (value ?? null)}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(o ? o.id : null)}
            className={cx("flex cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-2 text-sm", i === active && "bg-surface2")}
          >
            <span className={cx("min-w-0 flex-1 truncate", !o && "text-muted")}>{o ? o.label : noneLabel}</span>
            {o?.hint && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted">{o.hint}</span>}
            {o?.group && <span className="shrink-0 text-[12px] text-muted">{o.group}</span>}
          </li>
        ))}
      </ul>
      {total > hits.length && <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-muted">{tr(`${total - hits.length} more – keep typing to narrow down`, `${total - hits.length} weitere – tippe weiter, um einzugrenzen`)}</p>}
      {q.trim() && !hits.length && <p className="px-2.5 pb-1 pt-1.5 text-[12px] text-muted">{tr("No matches", "Keine Treffer")}</p>}
    </div>
  );
}

/** Searchable organization picker (investors and partners). */
export function OrgSelect({ value, onChange, id }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string }) {
  const investoren = useOrgs({ kind: "investor" }).data;
  const partner = useOrgs({ kind: "partner" }).data;
  const options = useMemo(
    () =>
      [
        ...(investoren ?? []).map((o) => ({ id: o.id, label: o.name, hint: o.city, group: "Investor" })),
        ...(partner ?? []).map((o) => ({ id: o.id, label: o.name, hint: o.city, group: "Partner" })),
      ].sort((a, b) => a.label.localeCompare(b.label, getLang())),
    [investoren, partner],
  );
  return <SearchSelect id={id} value={value} onChange={onChange} options={options} label={tr("Investor or partner", "Investor oder Partner")} noneLabel={tr("Not linked", "Keine Zuordnung")} placeholder={tr("Search organizations", "Organisation suchen")} />;
}

/** Searchable contact picker (name, company, email). */
export function ContactSelect({ value, onChange, id }: { value: string | null | undefined; onChange: (v: string | null) => void; id?: string }) {
  const { data } = useContacts({});
  const options = useMemo(
    () => (data ?? []).map((c) => ({ id: c.id, label: c.name, hint: [c.company, c.email].filter(Boolean).join(", ") })).sort((a, b) => a.label.localeCompare(b.label, getLang())),
    [data],
  );
  return <SearchSelect id={id} value={value} onChange={onChange} options={options} label={tr("Contact", "Kontakt")} noneLabel={tr("No contact", "Kein Kontakt")} placeholder={tr("Name, company or email", "Name, Firma oder E-Mail")} />;
}
