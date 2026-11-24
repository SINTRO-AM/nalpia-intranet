import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Lock, MapPin, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { Sheet, useIsDesktop } from "@/components/Sheet";
import { Button, cx, EmptyState, Field, IconButton, Segmented, Skeleton, Switch } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import { useMailStatus } from "@/lib/queries";
import { dfLocale, tr } from "@/lib/i18n";

/* ---------- Types ---------- */

interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  canWrite: boolean;
}
interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  startDate?: string;
  endDate?: string;
  location: string;
  description: string;
  organizer: string;
  attendees: { email: string; status: string }[];
  etag: string;
  recurrenceId: string | null;
  isOrganizer: boolean;
}
type View = "tag" | "woche" | "monat" | "liste";

const HOUR = 52; // pixels per hour in the timeline
const WEEK = {
  weekStartsOn: 1 as const,
  get locale() {
    return dfLocale();
  },
};
const HIDDEN_KEY = "nalpia.calendar.hidden";

/* ---------- Helpers ---------- */

const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
/** All-day events come as dates; use local midnight for display */
const evStart = (e: CalEvent) => (e.allDay && e.startDate ? new Date(e.startDate + "T00:00:00") : new Date(e.start));
const evEnd = (e: CalEvent) => (e.allDay && e.endDate ? addDays(new Date(e.endDate + "T00:00:00"), 1) : new Date(e.end));
const occursOn = (e: CalEvent, d: Date) => evStart(e) < addDays(startOfDay(d), 1) && evEnd(e) > startOfDay(d);
const time = (d: Date) => format(d, "HH:mm");
function timeRange(e: CalEvent) {
  const s = evStart(e);
  const en = evEnd(e);
  if (e.allDay) {
    const last = addDays(en, -1);
    return isSameDay(s, last) ? `${format(s, tr("EEEE, d MMMM", "EEEE, d. MMMM"), { locale: dfLocale() })}${tr(" · all day", " · ganztägig")}` : `${format(s, tr("d MMM", "d. MMM"), { locale: dfLocale() })} – ${format(last, tr("d MMM yyyy", "d. MMM yyyy"), { locale: dfLocale() })}${tr(" · all day", " · ganztägig")}`;
  }
  return isSameDay(s, en)
    ? `${format(s, tr("EEEE, d MMMM", "EEEE, d. MMMM"), { locale: dfLocale() })} · ${time(s)}–${time(en)}`
    : `${format(s, tr("d MMM HH:mm", "d. MMM HH:mm"), { locale: dfLocale() })} – ${format(en, tr("d MMM HH:mm", "d. MMM HH:mm"), { locale: dfLocale() })}`;
}

function rangeFor(view: View, cursor: Date): [Date, Date] {
  if (view === "tag") return [startOfDay(cursor), addDays(startOfDay(cursor), 1)];
  if (view === "woche") return [startOfWeek(cursor, WEEK), addDays(startOfWeek(cursor, WEEK), 7)];
  if (view === "monat") {
    const s = startOfWeek(startOfMonth(cursor), WEEK);
    return [s, addDays(s, 42)];
  }
  return [startOfDay(cursor), addDays(startOfDay(cursor), 35)];
}
function titleFor(view: View, cursor: Date) {
  if (view === "tag") return format(cursor, tr("EEEE, d MMMM yyyy", "EEEE, d. MMMM yyyy"), { locale: dfLocale() });
  if (view === "monat") return format(cursor, "MMMM yyyy", { locale: dfLocale() });
  if (view === "woche") {
    const s = startOfWeek(cursor, WEEK);
    const e = endOfWeek(cursor, WEEK);
    return isSameMonth(s, e) ? `${format(s, tr("d", "d."))}–${format(e, tr("d MMMM yyyy", "d. MMMM yyyy"), { locale: dfLocale() })}` : `${format(s, tr("d MMM", "d. MMM"), { locale: dfLocale() })} – ${format(e, tr("d MMM yyyy", "d. MMM yyyy"), { locale: dfLocale() })}`;
  }
  return tr(`From ${format(cursor, "d MMMM", { locale: dfLocale() })}`, `Ab ${format(cursor, "d. MMMM", { locale: dfLocale() })}`);
}
function step(view: View, cursor: Date, dir: 1 | -1) {
  if (view === "tag") return addDays(cursor, dir);
  if (view === "woche") return addWeeks(cursor, dir);
  if (view === "monat") return addMonths(cursor, dir);
  return addDays(cursor, dir * 35);
}

/** Lay out a day's overlapping events side by side */
function layoutDay(events: CalEvent[], day: Date) {
  const s0 = startOfDay(day).getTime();
  const items = events
    .map((e) => {
      const top = Math.max(0, (evStart(e).getTime() - s0) / 3_600_000);
      const bottom = Math.min(24, (evEnd(e).getTime() - s0) / 3_600_000);
      return { e, top, bottom: Math.max(bottom, top + 0.4), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: typeof items = [];
  let groupEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    for (const it of group) {
      let c = colEnds.findIndex((end) => end <= it.top);
      if (c < 0) c = colEnds.length;
      colEnds[c] = it.bottom;
      it.col = c;
    }
    for (const it of group) it.cols = colEnds.length;
  };
  for (const it of items) {
    if (it.top >= groupEnd && group.length) {
      flush();
      group = [];
    }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.bottom);
  }
  if (group.length) flush();
  return items;
}

function loadHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/* ---------- Page ---------- */

export function CalendarPage() {
  const status = useMailStatus();
  if (status.isLoading) return <Skeleton className="h-[70vh]" />;
  if (!status.data?.connected)
    return (
      <EmptyState
        icon={<CalendarDays className="h-5 w-5" />}
        title={tr("Connect calendar", "Kalender verbinden")}
        text={tr("The calendar uses your Zoho sign-in. Connect your mailbox first – calendars and events are then added automatically.", "Der Kalender nutzt deine Zoho-Anmeldung. Verbinde zuerst dein Postfach – Kalender und Termine kommen dann automatisch dazu.")}
        action={
          <Link to="/postfach" className="inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-brand-ink">
            {tr("Go to Mail", "Zum Postfach")}
          </Link>
        }
      />
    );
  return <CalendarView />;
}

function CalendarView() {
  const desktop = useIsDesktop();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = (params.get("ansicht") as View | null) ?? (desktop ? "woche" : "liste");
  const cursor = useMemo(() => {
    const d = params.get("datum");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date();
  }, [params]);
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
    setParams(p, { replace: true });
  };
  const go = (d: Date, v: View = view) => set({ datum: isToday(d) ? null : dayKey(d), ansicht: v });

  const [from, to] = rangeFor(view, cursor);
  const cals = useQuery({ queryKey: ["calendar", "calendars"], queryFn: () => api.get<CalendarInfo[]>("/api/calendar/calendars"), staleTime: 5 * 60_000, retry: false });
  const events = useQuery({
    queryKey: ["calendar", "events", from.toISOString(), to.toISOString()],
    queryFn: () => api.get<CalEvent[]>(`/api/calendar/events${qs({ from: from.toISOString(), to: to.toISOString() })}`),
    enabled: cals.isSuccess,
    placeholderData: (prev) => prev,
    refetchInterval: 120_000,
    retry: false,
  });
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
    } catch {
      /* ignore */
    }
  }, [hidden]);
  const calMap = useMemo(() => new Map((cals.data ?? []).map((c) => [c.id, c])), [cals.data]);
  const visible = useMemo(() => (events.data ?? []).filter((e) => !hidden.includes(e.calendarId)), [events.data, hidden]);
  const color = (e: CalEvent) => calMap.get(e.calendarId)?.color ?? "#2C64A8";

  const [detail, setDetail] = useState<CalEvent | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const newAt = (d: Date, allDay = false) => {
    const s = new Date(d);
    if (!allDay && s.getHours() === 0 && s.getMinutes() === 0) s.setHours(Math.max(9, new Date().getHours() + 1), 0, 0, 0);
    // Round up to the next half hour (e.g. tr("New event", "Neuer Termin") at 07:07 → 07:30)
    if (!allDay && s.getMinutes() % 30) s.setMinutes(Math.ceil(s.getMinutes() / 30) * 30, 0, 0);
    setDraft({ start: s, allDay });
  };

  const err = (cals.error ?? events.error) as ApiError | null;
  if (err) return <CalendarError error={err} onRetry={() => qc.invalidateQueries({ queryKey: ["calendar"] })} />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{tr("Calendar", "Kalender")}</h1>
          <p className="text-[14px] text-muted">{tr("Your events from Zoho Calendar.", "Deine Termine aus Zoho Calendar.")}</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => newAt(view === "tag" ? cursor : new Date())} disabled={!cals.data?.some((c) => c.canWrite)}>
          {tr("New event", "Neuer Termin")}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => go(new Date())}>
          {tr("Today", "Heute")}
        </Button>
        <div className="flex items-center">
          <IconButton label={tr("Previous", "Zurück")} onClick={() => go(step(view, cursor, -1))}>
            <ChevronLeft className="h-5 w-5" />
          </IconButton>
          <IconButton label={tr("Next", "Weiter")} onClick={() => go(step(view, cursor, 1))}>
            <ChevronRight className="h-5 w-5" />
          </IconButton>
        </div>
        <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold capitalize">{titleFor(view, cursor)}</h2>
        <IconButton label={tr("Refresh", "Aktualisieren")} onClick={() => qc.invalidateQueries({ queryKey: ["calendar"] })}>
          <RefreshCw className={cx("h-[18px] w-[18px]", events.isFetching && "animate-spin")} />
        </IconButton>
        <Segmented
          value={view}
          onChange={(v) => set({ ansicht: v })}
          size="sm"
          options={[
            { value: "tag", label: tr("Day", "Tag") },
            ...(desktop ? [{ value: "woche" as View, label: tr("Week", "Woche") }] : []),
            { value: "monat", label: tr("Month", "Monat") },
            { value: "liste", label: tr("List", "Liste") },
          ]}
        />
      </div>

      {(cals.data?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-1.5" aria-label={tr("Show and hide calendars", "Kalender ein- und ausblenden")}>
          {cals.data!.map((c) => {
            const on = !hidden.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setHidden((h) => (on ? [...h, c.id] : h.filter((x) => x !== c.id)))}
                className={cx("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition", on ? "border-line bg-surface text-ink" : "border-dashed border-line text-muted")}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? c.color : "transparent", boxShadow: `inset 0 0 0 2px ${c.color}` }} />
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {cals.isLoading || (events.isLoading && !events.data) ? (
        <Skeleton className="h-[60vh]" />
      ) : view === "monat" ? (
        <MonthGrid cursor={cursor} events={visible} color={color} onOpen={setDetail} onDay={(d) => go(d, "tag")} onCreate={(d) => newAt(d)} />
      ) : view === "liste" ? (
        <Agenda from={from} to={to} events={visible} color={color} onOpen={setDetail} calMap={calMap} />
      ) : (
        <TimeGrid days={view === "tag" ? [startOfDay(cursor)] : Array.from({ length: 7 }, (_, i) => addDays(from, i))} events={visible} color={color} onOpen={setDetail} onCreate={newAt} onDay={(d) => go(d, "tag")} />
      )}

      <EventDetail event={detail} cal={detail ? calMap.get(detail.calendarId) : undefined} onClose={() => setDetail(null)} />
      <EventEditor draft={draft} calendars={(cals.data ?? []).filter((c) => c.canWrite)} onClose={() => setDraft(null)} />
    </div>
  );
}

function CalendarError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  if (error.code === "reconnect" || error.status === 409)
    return (
      <EmptyState
        icon={<Lock className="h-5 w-5" />}
        title={tr("Grant calendar access", "Kalender freigeben")}
        text={error.message}
        action={
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.post<{ url: string }>("/api/mail/connect");
                window.location.href = r.url;
              } catch (e) {
                toast.error((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {tr("Reconnect with Zoho", "Mit Zoho neu verbinden")}
          </Button>
        }
      />
    );
  return <EmptyState icon={<CalendarDays className="h-5 w-5" />} title={tr("Calendar unavailable", "Kalender nicht erreichbar")} text={error.message} action={<Button onClick={onRetry}>{tr("Try again", "Erneut versuchen")}</Button>} />;
}

/* ---------- Timeline (day/week) ---------- */

function TimeGrid({
  days,
  events,
  color,
  onOpen,
  onCreate,
  onDay,
}: {
  days: Date[];
  events: CalEvent[];
  color: (e: CalEvent) => string;
  onOpen: (e: CalEvent) => void;
  onCreate: (d: Date, allDay?: boolean) => void;
  onDay: (d: Date) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // On open, scroll to the working day (7 am or just before the first event)
    const first = events.filter((e) => !e.allDay && days.some((d) => occursOn(e, d))).map((e) => evStart(e).getHours());
    const h = Math.max(0, Math.min(7, ...(first.length ? first : [7])) - 0.5);
    if (scroller.current) scroller.current.scrollTop = h * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.getTime()]);
  const allDay = (d: Date) => events.filter((e) => (e.allDay || evEnd(e).getTime() - evStart(e).getTime() >= 86_400_000) && occursOn(e, d));
  const timed = (d: Date) => events.filter((e) => !e.allDay && evEnd(e).getTime() - evStart(e).getTime() < 86_400_000 && occursOn(e, d));
  const cols = { gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` };
  const hasAllDay = days.some((d) => allDay(d).length);

  return (
    <div className="card overflow-hidden">
      <div className="grid border-b border-line bg-surface" style={cols}>
        <div />
        {days.map((d) => (
          <button key={d.toISOString()} type="button" onClick={() => onDay(d)} className="flex flex-col items-center gap-0.5 border-l border-line py-2 hover:bg-surface2/60">
            <span className={cx("text-[11.5px] font-semibold uppercase", isToday(d) ? "text-accent-ink" : "text-muted")}>{format(d, "EEE", { locale: dfLocale() }).replace(".", "")}</span>
            <span className={cx("num grid h-8 w-8 place-items-center rounded-full text-[16px] font-bold", isToday(d) ? "bg-brand text-brand-ink" : "")}>{format(d, "d")}</span>
          </button>
        ))}
      </div>
      {hasAllDay && (
        <div className="grid border-b border-line bg-surface2/40" style={cols}>
          <div className="pr-1.5 pt-1.5 text-right text-[10.5px] font-semibold text-muted">{tr("all day", "ganztägig")}</div>
          {days.map((d) => (
            <div key={d.toISOString()} className="min-w-0 space-y-1 border-l border-line p-1">
              {allDay(d).map((e) => (
                <button key={e.id + (e.recurrenceId ?? "")} type="button" onClick={() => onOpen(e)} className="block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[12px] font-semibold text-white" style={{ background: color(e) }}>
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div ref={scroller} className="relative max-h-[calc(100dvh-330px)] min-h-[420px] overflow-y-auto">
        <div className="grid" style={{ ...cols, height: HOUR * 24 }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} className="num absolute right-1.5 -translate-y-1/2 text-[11px] text-muted" style={{ top: (h + 1) * HOUR }}>
                {String(h + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const items = layoutDay(timed(d), d);
            return (
              <div
                key={d.toISOString()}
                className={cx("relative border-l border-line", isToday(d) && "bg-info-soft/25")}
                onClick={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  const y = ev.nativeEvent.offsetY;
                  const s = new Date(d);
                  s.setHours(0, Math.floor((y / HOUR) * 2) * 30, 0, 0);
                  onCreate(s);
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: h * HOUR }} />
                ))}
                {items.map(({ e, top, bottom, col, cols: n }) => {
                  const short = (bottom - top) * HOUR < 38;
                  return (
                    <button
                      key={e.id + (e.recurrenceId ?? "")}
                      type="button"
                      onClick={() => onOpen(e)}
                      title={`${e.title} · ${time(evStart(e))}–${time(evEnd(e))}`}
                      className="absolute overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-left shadow-[0_1px_2px_rgb(15_27_45/.12)] transition hover:z-10 hover:brightness-95"
                      style={{
                        top: top * HOUR + 1,
                        height: (bottom - top) * HOUR - 2,
                        left: `calc(${(col / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                        borderLeftColor: color(e),
                        background: `color-mix(in srgb, ${color(e)} 16%, rgb(var(--surface)))`,
                      }}
                    >
                      <span className={cx("block truncate font-semibold leading-tight text-ink", short ? "text-[11.5px]" : "text-[12.5px]")}>
                        {short && <span className="num font-normal text-muted">{time(evStart(e))} </span>}
                        {e.title}
                      </span>
                      {!short && (
                        <span className="num block truncate text-[11px] text-muted">
                          {time(evStart(e))}–{time(evEnd(e))}
                          {e.location ? ` · ${e.location}` : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
                {isToday(d) && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: ((now.getTime() - startOfDay(now).getTime()) / 3_600_000) * HOUR }}>
                    <div className="relative h-0.5 bg-neg">
                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-neg" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Month ---------- */

function MonthGrid({
  cursor,
  events,
  color,
  onOpen,
  onDay: openDay,
  onCreate,
}: {
  cursor: Date;
  events: CalEvent[];
  color: (e: CalEvent) => string;
  onOpen: (e: CalEvent) => void;
  onDay: (d: Date) => void;
  onCreate: (d: Date) => void;
}) {
  const start = startOfWeek(startOfMonth(cursor), WEEK);
  const weeks = Math.ceil((differenceInCalendarDays(endOfMonth(cursor), start) + 1) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const desktop = useIsDesktop();
  const max = desktop ? 3 : 2;
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line bg-surface2/40">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="py-2 text-center text-[11.5px] font-semibold uppercase text-muted">
            {format(d, "EEE", { locale: dfLocale() }).replace(".", "")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = events.filter((e) => occursOn(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
          const other = !isSameMonth(d, cursor);
          return (
            <div
              key={d.toISOString()}
              onClick={(ev) => ev.target === ev.currentTarget && onCreate(d)}
              className={cx("min-h-[88px] min-w-0 border-b border-r border-line p-1 lg:min-h-[116px]", other && "bg-surface2/40", (d.getDay() + 6) % 7 === 6 && "border-r-0")}
            >
              <button type="button" onClick={() => openDay(d)} className={cx("num mb-0.5 grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold", isToday(d) ? "bg-brand text-brand-ink" : other ? "text-muted/70" : "hover:bg-surface2")}>
                {format(d, "d")}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, max).map((e) => (
                  <button
                    key={e.id + (e.recurrenceId ?? "")}
                    type="button"
                    onClick={() => onOpen(e)}
                    className={cx("flex w-full items-center gap-1 truncate rounded px-1 py-px text-left text-[11.5px] leading-snug", e.allDay ? "font-semibold text-white" : "hover:bg-surface2")}
                    style={e.allDay ? { background: color(e) } : undefined}
                  >
                    {!e.allDay && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color(e) }} />}
                    {!e.allDay && desktop && <span className="num shrink-0 text-muted">{time(evStart(e))}</span>}
                    <span className="truncate">{e.title}</span>
                  </button>
                ))}
                {list.length > max && (
                  <button type="button" onClick={() => openDay(d)} className="px-1 text-[11.5px] font-semibold text-muted hover:text-ink">
                    +{tr(`${list.length - max} more`, `${list.length - max} weitere`)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- List ---------- */

function Agenda({ from, to, events, color, onOpen, calMap }: { from: Date; to: Date; events: CalEvent[]; color: (e: CalEvent) => string; onOpen: (e: CalEvent) => void; calMap: Map<string, CalendarInfo> }) {
  const days: { d: Date; list: CalEvent[] }[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const list = events.filter((e) => occursOn(e, d)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
    if (list.length) days.push({ d, list });
  }
  if (!days.length) return <EmptyState icon={<CalendarDays className="h-5 w-5" />} title={tr("No events", "Keine Termine")} text={tr("Nothing is on the calendar for the next five weeks.", "In den nächsten fünf Wochen steht nichts im Kalender.")} />;
  return (
    <div className="space-y-4">
      {days.map(({ d, list }) => (
        <section key={d.toISOString()} className="grid grid-cols-[56px_1fr] gap-3">
          <div className="pt-1 text-center">
            <p className={cx("text-[11.5px] font-semibold uppercase", isToday(d) ? "text-accent-ink" : "text-muted")}>{format(d, "EEE", { locale: dfLocale() }).replace(".", "")}</p>
            <p className={cx("num mx-auto mt-0.5 grid h-9 w-9 place-items-center rounded-full text-[18px] font-bold", isToday(d) && "bg-brand text-brand-ink")}>{format(d, "d")}</p>
            <p className="text-[11px] text-muted">{format(d, "MMM", { locale: dfLocale() })}</p>
          </div>
          <ul className="card divide-y divide-line overflow-hidden">
            {list.map((e) => (
              <li key={e.id + (e.recurrenceId ?? "")}>
                <button type="button" onClick={() => onOpen(e)} className="flex w-full items-start gap-3 px-3.5 py-3 text-left transition hover:bg-surface2/60">
                  <span className="mt-1 h-9 w-1 shrink-0 rounded-full" style={{ background: color(e) }} />
                  <span className="num w-[86px] shrink-0 pt-0.5 text-[13px] text-muted">{e.allDay ? tr("all day", "ganztägig") : `${time(evStart(e))}–${time(evEnd(e))}`}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{e.title}</span>
                    <span className="block truncate text-[12.5px] text-muted">{[e.location, calMap.size > 1 ? calMap.get(e.calendarId)?.name : ""].filter(Boolean).join(" · ") || " "}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ---------- Details & delete ---------- */

function EventDetail({ event: e, cal, onClose }: { event: CalEvent | null; cal?: CalendarInfo; onClose: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [e]);
  const del = useMutation({
    mutationFn: (ev: CalEvent) => api.del(`/api/calendar/events/${encodeURIComponent(ev.calendarId)}/${encodeURIComponent(ev.id)}${qs({ etag: ev.etag, recurrenceId: ev.recurrenceId ?? undefined })}`),
    onSuccess: () => {
      toast.success(tr("Event deleted", "Termin gelöscht"));
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      onClose();
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const row = (icon: ReactNode, content: ReactNode) => (
    <div className="flex gap-3 text-[14.5px]">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  );
  return (
    <Sheet
      open={!!e}
      onOpenChange={(v) => !v && onClose()}
      title={tr("Event", "Termin")}
      footer={
        e && cal?.canWrite ? (
          <div className="flex items-center justify-between gap-2">
            {confirm ? (
              <>
                <span className="text-[13px] text-muted">{e.recurrenceId ? tr("Delete only this occurrence of the series?", "Nur diesen Termin der Serie löschen?") : e.attendees.length ? tr("Delete? Attendees won't be notified.", "Löschen? Teilnehmende werden nicht benachrichtigt.") : tr("Delete this event?", "Wirklich löschen?")}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    {tr("Cancel", "Abbrechen")}
                  </Button>
                  <Button variant="danger" loading={del.isPending} onClick={() => del.mutate(e)}>
                    {tr("Delete", "Löschen")}
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="ghost" className="text-neg" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm(true)}>
                {tr("Delete event", "Termin löschen")}
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {e && (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ background: cal?.color ?? "#2C64A8" }} />
            <div>
              <h2 className="text-[21px] font-extrabold leading-snug tracking-[-0.015em]">{e.title}</h2>
              {cal && <p className="text-[13px] text-muted">{cal.name}</p>}
            </div>
          </div>
          {row(<Clock className="h-4 w-4" />, <span>{timeRange(e)}</span>)}
          {e.location && row(<MapPin className="h-4 w-4" />, /^https?:\/\//.test(e.location) ? <a className="link break-all" href={e.location} target="_blank" rel="noopener noreferrer">{e.location}</a> : e.location)}
          {e.attendees.length > 0 &&
            row(
              <Users className="h-4 w-4" />,
              <ul className="space-y-0.5">
                {e.attendees.map((a) => (
                  <li key={a.email} className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.email}</span>
                    <span className="shrink-0 text-[12px] text-muted">{(
                      {
                        ACCEPTED: tr("accepted", "zugesagt"),
                        DECLINED: tr("declined", "abgesagt"),
                        TENTATIVE: tr("maybe", "vielleicht"),
                        "NEEDS-ACTION": tr("pending", "offen"),
                      } as Record<string, string>
                    )[a.status] ?? ""}</span>
                  </li>
                ))}
              </ul>,
            )}
          {e.description && <p className="whitespace-pre-wrap rounded-xl bg-surface2/60 p-3 text-[14px]">{e.description}</p>}
          {e.organizer && !e.isOrganizer && <p className="text-[13px] text-muted">{tr(`Organized by ${e.organizer}`, `Organisiert von ${e.organizer}`)}</p>}
        </div>
      )}
    </Sheet>
  );
}

/* ---------- New event ---------- */

interface Draft {
  start: Date;
  allDay: boolean;
}

function EventEditor({ draft, calendars, onClose }: { draft: Draft | null; calendars: CalendarInfo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", calendarId: "", allDay: false, date: "", from: "09:00", to: "10:00", endDate: "", location: "", attendees: "", notify: false, description: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!draft) return;
    const s = draft.start;
    const e = new Date(s.getTime() + 60 * 60_000);
    setF({
      title: "",
      calendarId: (calendars.find((c) => c.isDefault) ?? calendars[0])?.id ?? "",
      allDay: draft.allDay,
      date: dayKey(s),
      from: time(s),
      to: isSameDay(s, e) ? time(e) : "23:59",
      endDate: dayKey(s),
      location: "",
      attendees: "",
      notify: false,
      description: "",
    });
    setError(null);
  }, [draft, calendars]);
  const save = useMutation({
    mutationFn: () => {
      const attendees = f.attendees
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const startAt = new Date(`${f.date}T${f.from}:00`);
      let endAt = new Date(`${f.date}T${f.to}:00`);
      if (endAt <= startAt) endAt = new Date(startAt.getTime() + 30 * 60_000);
      return api.post<CalEvent>("/api/calendar/events", {
        calendarId: f.calendarId,
        title: f.title.trim(),
        allDay: f.allDay,
        ...(f.allDay ? { startDate: f.date, endDate: f.endDate && f.endDate >= f.date ? f.endDate : f.date } : { start: startAt.toISOString(), end: endAt.toISOString() }),
        location: f.location.trim() || undefined,
        description: f.description.trim() || undefined,
        attendees: attendees.length ? attendees : undefined,
        notify: attendees.length ? f.notify : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    onSuccess: () => {
      toast.success(tr("Event created", "Termin angelegt"));
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });
  const up = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const hasAttendees = f.attendees.trim().length > 0;
  return (
    <Sheet
      open={!!draft}
      onOpenChange={(v) => !v && onClose()}
      title={tr("New event", "Neuer Termin")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.title.trim() || !f.calendarId || !f.date} onClick={() => save.mutate()}>
            {tr("Create event", "Termin anlegen")}
          </Button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.title.trim()) save.mutate();
        }}
      >
        <Field label={tr("Title", "Titel")} htmlFor="ev-title">
          <input id="ev-title" className="field" autoFocus value={f.title} onChange={(e) => up({ title: e.target.value })} placeholder={tr("e.g. Call with Alpha Ventures", "z. B. Call mit Alpha Ventures")} maxLength={200} />
        </Field>
        {calendars.length > 1 && (
          <Field label={tr("Calendar", "Kalender")} htmlFor="ev-cal">
            <Select id="ev-cal" value={f.calendarId} onChange={(e) => up({ calendarId: e.target.value })}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Switch checked={f.allDay} onChange={(v) => up({ allDay: v })} label={tr("All day", "Ganztägig")} />
        {f.allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("From", "Von")} htmlFor="ev-d1">
              <input id="ev-d1" type="date" className="field" value={f.date} onChange={(e) => up({ date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} />
            </Field>
            <Field label={tr("To", "Bis")} htmlFor="ev-d2">
              <input id="ev-d2" type="date" className="field" min={f.date} value={f.endDate} onChange={(e) => up({ endDate: e.target.value })} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
            <Field label={tr("Date", "Datum")} htmlFor="ev-d">
              <input id="ev-d" type="date" className="field" value={f.date} onChange={(e) => up({ date: e.target.value })} />
            </Field>
            <Field label={tr("From", "Von")} htmlFor="ev-t1">
              <input
                id="ev-t1"
                type="time"
                className="field"
                value={f.from}
                onChange={(e) => {
                  // keep the duration
                  const [h1, m1] = f.from.split(":").map(Number);
                  const [h2, m2] = f.to.split(":").map(Number);
                  const dur = h2! * 60 + m2! - (h1! * 60 + m1!);
                  const [h, m] = e.target.value.split(":").map(Number);
                  const end = Math.min(23 * 60 + 59, h! * 60 + m! + (dur > 0 ? dur : 60));
                  up({ from: e.target.value, to: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` });
                }}
              />
            </Field>
            <Field label={tr("To", "Bis")} htmlFor="ev-t2">
              <input id="ev-t2" type="time" className="field" value={f.to} onChange={(e) => up({ to: e.target.value })} />
            </Field>
          </div>
        )}
        <Field label={tr("Location or link", "Ort oder Link")} htmlFor="ev-loc">
          <input id="ev-loc" className="field" value={f.location} onChange={(e) => up({ location: e.target.value })} placeholder={tr("Frankfurt office, Teams link …", "Büro Frankfurt, Teams-Link …")} maxLength={255} />
        </Field>
        <Field label={tr("Attendees", "Teilnehmende")} htmlFor="ev-att" hint={tr("E-mail addresses, separated by commas (optional).", "E-Mail-Adressen, durch Komma getrennt (optional).")}>
          <input id="ev-att" className="field" value={f.attendees} onChange={(e) => up({ attendees: e.target.value })} placeholder={tr("name@company.com", "name@firma.de")} />
        </Field>
        {hasAttendees && (
          <Switch
            checked={f.notify}
            onChange={(v) => up({ notify: v })}
            label={tr("Send invitation by e-mail", "Einladung per E-Mail senden")}
            description={tr("Zoho sends the attendees an invitation. When off, the event is only added to your calendar.", "Zoho schickt den Teilnehmenden eine Einladung. Ausgeschaltet steht der Termin nur in deinem Kalender.")}
          />
        )}
        <Field label={tr("Description", "Beschreibung")} htmlFor="ev-desc">
          <textarea id="ev-desc" className="field min-h-[90px]" value={f.description} onChange={(e) => up({ description: e.target.value })} maxLength={5000} />
        </Field>
        {error && <p className="rounded-xl bg-neg-soft px-3 py-2 text-[13.5px] text-neg">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  );
}
