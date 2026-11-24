import { format, getISOWeek, isWeekend, parseISO } from "date-fns";
import { Diamond } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDays, countdown } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useUserMap } from "@/lib/queries";
import type { HomeData } from "@/lib/types";
import { Avatar, cx, Segmented } from "./ui";
import { dfLocale, tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

type H = HomeData["horizon"];

/**
 * The horizon: the next four weeks as a timeline – team due dates as dots,
 * milestones as diamonds. Tapping a day shows what's due then.
 */
export function Horizon({ horizon, meId }: { horizon: H; meId: string }) {
  const users = useUserMap();
  const { open } = useOverlays();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"team" | "mine">("team");
  const days = useMemo(() => Array.from({ length: 28 }, (_, i) => addDays(horizon.start, i)), [horizon.start]);

  const tasks = horizon.tasks.filter((t) => scope === "team" || t.assigneeId === meId);
  const ms = horizon.milestones.filter((m) => scope === "team" || m.ownerId === meId);
  const overdue = tasks.filter((t) => t.dueDate < horizon.start);
  const byDay = (d: string) => ({ tasks: tasks.filter((t) => t.dueDate === d), ms: ms.filter((m) => m.dueDate === d) });

  const firstBusy = days.find((d) => byDay(d).tasks.length || byDay(d).ms.length) ?? horizon.start;
  const [sel, setSel] = useState<string | null>(null);
  const selected = sel ?? (overdue.length ? "overdue" : firstBusy);
  const selItems =
    selected === "overdue" ? { tasks: overdue, ms: ms.filter((m) => m.dueDate < horizon.start) } : byDay(selected);

  return (
    <section className="card overflow-hidden" aria-labelledby="horizon-title">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <div>
          <h2 id="horizon-title" className="section-title">
            {tr("The next four weeks", "Die nächsten vier Wochen")}
          </h2>
          <p className="text-[13px] text-muted">
            <span className="num">{tasks.length - overdue.length}</span> {tasks.length - overdue.length === 1 ? tr("item due", "Fälligkeit") : tr("items due", "Fälligkeiten")}, <span className="num">{ms.length}</span>{" "}
            {ms.length === 1 ? tr("milestone", "Meilenstein") : tr("milestones", "Meilensteine")}
          </p>
        </div>
        <Segmented
          size="sm"
          value={scope}
          onChange={(v) => {
            setScope(v);
            setSel(null);
          }}
          options={[
            { value: "team", label: "Team" },
            { value: "mine", label: tr("Mine", "Meine") },
          ]}
        />
      </div>

      <div className="scrollbar-none mt-2 overflow-x-auto px-2 pb-1 pt-4">
        <div className="flex min-w-max gap-[3px] lg:min-w-0">
          {overdue.length > 0 && (
            <DayCell
              label={tr("Late", "Überf.")}
              date={String(overdue.length)}
              active={selected === "overdue"}
              onClick={() => setSel("overdue")}
              tone="over"
              dots={overdue.map((t) => ({ mine: t.assigneeId === meId, hi: t.priority === "hoch" }))}
              diamonds={0}
            />
          )}
          {days.map((d, i) => {
            const it = byDay(d);
            const dt = parseISO(d);
            const monday = dt.getDay() === 1;
            return (
              <div key={d} className={cx("relative flex", monday && i > 0 && "ml-1.5 border-l border-line pl-1.5")}>
                {monday && <span className="tnum absolute -top-4 left-1.5 whitespace-nowrap text-[10.5px] font-semibold text-muted">{tr("W", "KW ")}{getISOWeek(dt)}</span>}
                <DayCell
                  label={i === 0 ? tr("Today", "Heute") : format(dt, "EEEEEE", { locale: dfLocale() })}
                  date={format(dt, "d")}
                  today={i === 0}
                  weekend={isWeekend(dt)}
                  active={selected === d}
                  onClick={() => setSel(d)}
                  dots={it.tasks.map((t) => ({ mine: t.assigneeId === meId, hi: t.priority === "hoch" }))}
                  diamonds={it.ms.length}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="mb-1.5 text-[13px] font-semibold text-muted">
          {selected === "overdue" ? tr("Overdue", "Überfällig") : format(parseISO(selected), tr("EEEE, d MMMM", "EEEE, d. MMMM"), { locale: dfLocale() })}
        </p>
        {selItems.tasks.length === 0 && selItems.ms.length === 0 ? (
          <p className="py-1 text-sm text-muted">{tr("Nothing due on this day.", "Nichts fällig an diesem Tag.")}</p>
        ) : (
          <ul className="space-y-1">
            {selItems.ms.map((m) => (
              <li key={m.id}>
                <button onClick={() => navigate(`/aufgaben/meilensteine/${m.id}`)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-surface2">
                  <Diamond className="h-4 w-4 shrink-0 fill-accent text-accent" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold"><Tx text={m.title} /></span>
                  <span className="shrink-0 text-[12.5px] text-muted">{countdown(m.dueDate)}</span>
                </button>
              </li>
            ))}
            {selItems.tasks.map((t) => {
              const u = t.assigneeId ? users.get(t.assigneeId) : undefined;
              return (
                <li key={t.id}>
                  <button onClick={() => open({ kind: "task", id: t.id })} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-surface2">
                    <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", t.priority === "hoch" ? "bg-neg" : t.assigneeId === meId ? "bg-brand" : "border-2 border-brand/50")} />
                    <span className="min-w-0 flex-1 truncate text-sm"><Tx text={t.title} /></span>
                    {u && <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={22} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function DayCell({
  label,
  date,
  today,
  weekend,
  active,
  onClick,
  dots,
  diamonds,
  tone,
}: {
  label: string;
  date: string;
  today?: boolean;
  weekend?: boolean;
  active: boolean;
  onClick: () => void;
  dots: { mine: boolean; hi: boolean }[];
  diamonds: number;
  tone?: "over";
}) {
  const shown = dots.slice(0, 4);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "relative flex w-[42px] shrink-0 flex-col items-center rounded-xl pb-2 pt-3.5 transition lg:w-auto lg:min-w-[34px] lg:flex-1",
        active ? "bg-brand text-brand-ink" : weekend ? "bg-surface2/60 hover:bg-surface2" : "hover:bg-surface2",
        tone === "over" && !active && "bg-neg-soft text-neg",
      )}
    >
      {today && !active && <span className="absolute inset-x-2 top-1 h-[3px] rounded-full bg-accent" aria-hidden />}
      <span className={cx("text-[10.5px] font-semibold", active ? "text-brand-ink/80" : today ? "text-accent-ink" : "text-muted")}>{label}</span>
      <span className={cx("num mt-0.5 text-[15px] font-medium leading-none", today && !active && "font-bold")}>{date}</span>
      <span className="mt-2 flex h-[34px] flex-col items-center gap-[3px]">
        {Array.from({ length: Math.min(diamonds, 2) }).map((_, i) => (
          <span key={`d${i}`} className={cx("h-[9px] w-[9px] rotate-45 rounded-[2px]", active ? "bg-accent" : "bg-accent")} />
        ))}
        {shown.slice(0, Math.max(0, 4 - Math.min(diamonds, 2))).map((d, i) => (
          <span
            key={i}
            className={cx(
              "h-[7px] w-[7px] rounded-full",
              active ? (d.hi ? "bg-[#ff8f88]" : d.mine ? "bg-brand-ink" : "border border-brand-ink/80") : d.hi ? "bg-neg" : d.mine ? "bg-brand" : "border-[1.5px] border-brand/50",
            )}
          />
        ))}
        {dots.length + diamonds > 4 && <span className={cx("num text-[9px] leading-none", active ? "text-brand-ink/80" : "text-muted")}>+{dots.length + diamonds - 4}</span>}
      </span>
    </button>
  );
}
