import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock, MoreHorizontal, Phone, StickyNote, Users } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, cx, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dueInfo, ORG_KIND, PRIORITY, relTime } from "@/lib/format";
import { locale, tr } from "@/lib/i18n";
import { useOrgDashboard, useUserMap } from "@/lib/queries";
import type { DashCard, DashLane, MailDir, OrgDashboard as Dash, OrgKind, OrgMeta } from "@/lib/types";
import { Tx } from "@/lib/translate";

const DAY = 86_400_000;
const LANE_STEP = 8;

const LANES: Record<DashLane, { readonly title: string; hint: (k: OrgKind) => string; bar: string }> = {
  antwort: { get title() { return tr("Reply pending", "Antwort offen"); }, hint: () => tr("They replied – your move", "Hat geantwortet – du bist dran"), bar: "bg-accent" },
  faellig: { get title() { return tr("Follow-up due", "Nachfassen fällig"); }, hint: () => tr("Overdue and upcoming next steps", "Überfällige und anstehende nächste Schritte"), bar: "bg-neg" },
  gespraech: { get title() { return tr("In conversation", "In Gesprächen"); }, hint: (k) => (k === "investor" ? tr("First meeting to term sheet", "Erstgespräch bis Term Sheet") : tr("First meeting to proposal", "Erstgespräch bis Angebot")), bar: "bg-info" },
  wartet: { get title() { return tr("Awaiting reply", "Wartet auf Antwort"); }, hint: () => tr("Contacted, no response yet", "Angeschrieben, noch keine Rückmeldung"), bar: "bg-muted/45" },
  gewonnen: { get title() { return tr("Won", "Gewonnen"); }, hint: (k) => (k === "investor" ? tr("Commitments and investments", "Zusagen und Investments") : tr("Invested clients", "Investierte Kunden")), bar: "bg-pos" },
};
const LANE_ORDER: DashLane[] = ["antwort", "faellig", "gespraech", "wartet", "gewonnen"];

const n = (x: number) => x.toLocaleString(locale());
const pct = (x: number | null) => (x === null ? "–" : tr(`${Math.round(x * 100)}%`, `${Math.round(x * 100)} %`));
const daysSince = (ts: number | null) => (ts ? Math.max(0, Math.floor((Date.now() - ts) / DAY)) : null);

export function OrgDashboardView({ kind, meta }: { kind: OrgKind; meta: OrgMeta }) {
  const { data, isLoading } = useOrgDashboard(kind);
  if (isLoading || !data) return <Skeleton className="h-[520px]" />;
  return (
    <div className="space-y-4">
      <Kpis kind={kind} d={data} />
      <WorkflowBoard kind={kind} d={data} meta={meta} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Funnel d={data} />
        <Weekly d={data} />
        <ByType kind={kind} d={data} meta={meta} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Recent kind={kind} d={data} />
        <section className="card p-4 sm:p-5" aria-label={tr("Open tasks", "Offene Aufgaben")}>
          <h2 className="text-[15px] font-bold">{tr("Open tasks", "Offene Aufgaben")}</h2>
          {data.tasks.length ? (
            <div className="-mx-2 mt-2">
              {data.tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted">{tr(`No open tasks for ${ORG_KIND[kind].plural.toLowerCase()}. Create them from an organization's detail view.`, `Keine offenen Aufgaben zu ${ORG_KIND[kind].plural}. Lege sie in der Detailansicht einer Organisation an.`)}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- KPIs ---------- */

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <p className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
        {tone && <span className={cx("h-2 w-2 shrink-0 rounded-full", tone)} aria-hidden />}
        {label}
      </p>
      <p className="mt-1 text-[26px] font-bold leading-none tracking-[-0.02em]">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev && !now) return <>{tr("same as last week", "wie in der Vorwoche")}</>;
  const diff = now - prev;
  return (
    <>
      {tr("Last week", "Vorwoche")} {n(prev)}
      {diff !== 0 && <span className="ml-1 font-semibold text-ink">{diff > 0 ? `+${n(diff)}` : n(diff)}</span>}
    </>
  );
}

function Kpis({ kind, d }: { kind: OrgKind; d: Dash }) {
  const k = d.kpis;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={LANES.antwort.title} tone={LANES.antwort.bar} value={n(d.lanes.antwort.total)} hint={tr("Last email came from the other side", "Letzte Mail kam von der Gegenseite")} />
      <Tile label={LANES.faellig.title} tone={LANES.faellig.bar} value={n(d.lanes.faellig.total)} hint={tr(`${n(d.lanes.wartet.total)} awaiting reply`, `${n(d.lanes.wartet.total)} warten auf Antwort`)} />
      <Tile label={tr("Sent, 7 days", "Gesendet, 7 Tage")} value={n(k.sent7)} hint={<Delta now={k.sent7} prev={k.sentPrev7} />} />
      <Tile
        label={tr("Response rate", "Antwortquote")}
        value={pct(k.responseRate)}
        hint={tr(
          `${n(k.replied)} of ${n(k.contacted)} contacted ${kind === "investor" ? "investors" : "partners"}, ${n(k.received7)} ${k.received7 === 1 ? "reply" : "replies"} in 7 days`,
          `${n(k.replied)} von ${n(k.contacted)} kontaktierten ${kind === "investor" ? "Investoren" : "Partnern"}, ${n(k.received7)} ${k.received7 === 1 ? "Antwort" : "Antworten"} in 7 Tagen`,
        )}
      />
    </div>
  );
}

/* ---------- Workflow board ---------- */

function WorkflowBoard({ kind, d, meta }: { kind: OrgKind; d: Dash; meta: OrgMeta }) {
  const [shown, setShown] = useState<Record<string, number>>({});
  const lanes = LANE_ORDER.filter((l) => l !== "gewonnen" || d.lanes.gewonnen.total > 0);
  return (
    <section aria-label={tr("Current workflows", "Aktuelle Workflows")} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold">{tr("Current workflows", "Aktuelle Workflows")}</h2>
        <p className="hidden text-[12.5px] text-muted sm:block">
          {tr(`${n(d.kpis.backlog)} identified and not yet contacted, ${n(d.kpis.closed)} paused or declined`, `${n(d.kpis.backlog)} identifiziert und noch nicht angeschrieben, ${n(d.kpis.closed)} pausiert oder abgesagt`)}
        </p>
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:-mx-8 lg:px-8">
        {lanes.map((l) => {
          const lane = d.lanes[l];
          const limit = shown[l] ?? LANE_STEP;
          return (
            <section key={l} aria-label={LANES[l].title} className="flex w-[80vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl bg-surface2/70 sm:w-[272px] xl:w-auto xl:min-w-[212px] xl:max-w-none xl:flex-1 xl:shrink">
              <div className={cx("h-1 rounded-t-2xl", LANES[l].bar)} aria-hidden />
              <header className="px-3 pb-2 pt-2.5">
                <h3 className="flex items-baseline gap-2">
                  <span className="text-sm font-bold">{LANES[l].title}</span>
                  <span className="text-[12px] font-semibold text-muted">{n(lane.total)}</span>
                </h3>
                <p className="text-[12px] leading-snug text-muted">{LANES[l].hint(kind)}</p>
              </header>
              <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                {lane.items.slice(0, limit).map((c) => (
                  <WorkCard key={c.id} c={c} lane={l} kind={kind} meta={meta} />
                ))}
                {!lane.total && <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[12.5px] text-muted">{tr("Nothing open", "Nichts offen")}</p>}
                {lane.items.length > limit && (
                  <button
                    type="button"
                    onClick={() => setShown((s) => ({ ...s, [l]: limit + 20 }))}
                    className="rounded-xl border border-dashed border-line py-2.5 text-[13px] font-semibold text-muted hover:border-muted/50 hover:text-ink"
                  >
                    {tr(`Show ${n(Math.min(20, lane.items.length - limit))} more`, `${n(Math.min(20, lane.items.length - limit))} weitere zeigen`)}
                  </button>
                )}
                {lane.total > lane.items.length && limit >= lane.items.length && (
                  <p className="px-1 text-[12px] text-muted">
                    {tr(`and ${n(lane.total - lane.items.length)} more –`, `und ${n(lane.total - lane.items.length)} weitere –`)}{" "}
                    <Link className="link" to={`${ORG_KIND[kind].path}?ansicht=liste&sortierung=naechster`}>
                      {tr("in the list", "in der Liste")}
                    </Link>
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function DirIcon({ kind, dir, className = "h-3.5 w-3.5" }: { kind: string; dir: MailDir; className?: string }) {
  if (dir === "in") return <ArrowDownLeft className={cx(className, "text-viz-in")} aria-label={tr("Received", "Erhalten")} />;
  if (dir === "out") return <ArrowUpRight className={cx(className, "text-viz-out")} aria-label={tr("Sent", "Gesendet")} />;
  if (kind === "anruf") return <Phone className={cx(className, "text-muted")} aria-label={tr("Call", "Anruf")} />;
  if (kind === "meeting") return <Users className={cx(className, "text-muted")} aria-label="Meeting" />;
  if (kind === "status") return <ChevronRight className={cx(className, "text-muted")} aria-label="Status" />;
  return <StickyNote className={cx(className, "text-muted")} aria-label={tr("Note", "Notiz")} />;
}

function WorkCard({ c, lane, kind, meta }: { c: DashCard; lane: DashLane; kind: OrgKind; meta: OrgMeta }) {
  const navigate = useNavigate();
  const users = useUserMap();
  const qc = useQueryClient();
  const owner = c.ownerId ? users.get(c.ownerId) : undefined;
  const href = `${ORG_KIND[kind].path}/${c.id}`;
  const stage = meta.stages[kind].find((s) => s.id === c.stage);
  const due = dueInfo(c.nextDate);
  const waiting = daysSince(c.lastOut);

  async function setStage(id: string) {
    try {
      await api.patch(`/api/orgs/${c.id}`, { stage: id });
      toast.success(`${c.name}: ${meta.stages[kind].find((s) => s.id === id)?.label}`);
      qc.invalidateQueries({ queryKey: ["orgs"] });
      qc.invalidateQueries({ queryKey: ["org", c.id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  let footer: ReactNode = null;
  if (lane === "antwort" && c.lastIn) footer = <span className="font-semibold text-accent-ink">{tr("Replied", "Antwort")} {relTime(c.lastIn)}</span>;
  else if (lane === "faellig" || (lane === "gespraech" && c.nextDate))
    footer = (
      <span className="min-w-0 truncate">
        <span className={cx("font-semibold", due.tone === "over" ? "text-neg" : due.tone === "today" ? "text-accent-ink" : "text-ink")}>{due.label}</span>
        {c.nextStep && <span className="text-muted">: <Tx text={c.nextStep} /></span>}
      </span>
    );
  else if (lane === "wartet")
    footer = (
      <span className="min-w-0 truncate text-muted">
        {waiting !== null ? (waiting === 0 ? tr("Contacted today", "Heute angeschrieben") : tr(`Waiting for ${waiting} ${waiting === 1 ? "day" : "days"}`, `Wartet seit ${waiting} ${waiting === 1 ? "Tag" : "Tagen"}`)) : stage?.label}
        {c.nextDate && <>, {tr("follow up", "nachfassen")} {due.label.toLowerCase()}</>}
      </span>
    );
  else if (stage) footer = <span className="text-muted">{stage.label}</span>;

  return (
    <article
      onClick={() => navigate(href)}
      className="group cursor-pointer rounded-xl border border-line bg-surface p-3 transition hover:border-muted/40 active:scale-[.99]"
    >
      <div className="flex items-start gap-2">
        <Link to={href} onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1 rounded text-[14px] font-semibold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          {c.name}
        </Link>
        {c.priority === "hoch" && <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY.hoch?.dot)} aria-label={tr("High priority", "Hohe Priorität")} />}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={tr(`Change stage of ${c.name}`, `Status von ${c.name} ändern`)}
              className="-mr-1 -mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} onClick={(e) => e.stopPropagation()} className="z-50 min-w-[200px] rounded-xl border border-line bg-surface p-1.5 shadow-pop">
              <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold text-muted">{tr("Set stage", "Status setzen")}</DropdownMenu.Label>
              {meta.stages[kind].map((s) => (
                <DropdownMenu.Item
                  key={s.id}
                  disabled={s.id === c.stage}
                  onSelect={() => void setStage(s.id)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[disabled]:cursor-default data-[disabled]:font-semibold data-[highlighted]:bg-surface2"
                >
                  {s.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <p className="mt-0.5 truncate text-[12.5px] text-muted">{[meta.types[kind][c.type], c.contact && c.contact !== c.name ? c.contact : c.city].filter(Boolean).join(", ")}</p>
      {c.last && (
        <p className="mt-2 flex gap-1.5 text-[12.5px] leading-snug">
          <DirIcon kind={c.last.kind} dir={c.last.dir} className="mt-[2px] h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0">{c.last.text ? <Tx text={c.last.text} /> : tr("(no subject)", "(ohne Betreff)")}</span>
        </p>
      )}
      {(footer || owner) && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[12px]">
          <span className="flex min-w-0 flex-1">{footer}</span>
          {owner && <Avatar name={owner.name} color={owner.avatarColor} src={owner.avatarUrl} size={22} />}
        </div>
      )}
    </article>
  );
}

/* ---------- Funnel ---------- */

function Funnel({ d }: { d: Dash }) {
  const steps = d.funnel.filter((f, i) => i === 0 || f.reached > 0 || f.current > 0 || i < 3);
  const max = Math.max(1, steps[0]?.reached ?? 1);
  return (
    <section className="card p-4 sm:p-5" aria-label={tr("Funnel", "Trichter")}>
      <h2 className="text-[15px] font-bold">{tr("Funnel", "Trichter")}</h2>
      <p className="text-[12.5px] text-muted">{tr("How many reached at least this stage", "Wie viele mindestens diesen Status erreicht haben")}</p>
      <ol className="mt-3 space-y-2.5">
        {steps.map((f, i) => {
          const prev = i > 0 ? steps[i - 1]!.reached : null;
          const conv = prev ? f.reached / prev : null;
          return (
            <li key={f.stage} title={tr(`${f.label}: ${n(f.reached)} reached, ${n(f.current)} currently at this stage`, `${f.label}: ${n(f.reached)} erreicht, ${n(f.current)} aktuell in diesem Status`)}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium">{f.label}</span>
                <span className="text-muted">
                  <span className="font-semibold text-ink">{n(f.reached)}</span>
                  {conv !== null && <span className="ml-1.5">{pct(conv)}</span>}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface2">
                <div className="h-2 rounded-full bg-viz-out" style={{ width: `${Math.max(f.reached ? 1.5 : 0, (f.reached / max) * 100)}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------- Activity per week ---------- */

const weekLabel = (iso: string) => {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
};

function Weekly({ d }: { d: Dash }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...d.weekly.map((w) => Math.max(w.sent, w.received)));
  const top = niceTop(max);
  const total = d.weekly.reduce((a, w) => ({ s: a.s + w.sent, r: a.r + w.received }), { s: 0, r: 0 });
  const h = hover !== null ? d.weekly[hover] : null;
  return (
    <section className="card p-4 sm:p-5" aria-label={tr("Emails per week", "Mails pro Woche")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold">{tr("Emails per week", "Mails pro Woche")}</h2>
        <ul className="flex gap-3 text-[12px] text-muted" aria-label={tr("Legend", "Legende")}>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-viz-out" aria-hidden /> {tr("Sent", "Gesendet")}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-viz-in" aria-hidden /> {tr("Received", "Erhalten")}
          </li>
        </ul>
      </div>
      <p className="h-[18px] text-[12.5px] text-muted" aria-live="polite">
        {h ? (
          <>
            {tr("Week of", "Woche ab")} {weekLabel(h.week)}: <b className="text-ink">{n(h.sent)}</b> {tr("sent", "gesendet")}, <b className="text-ink">{n(h.received)}</b> {tr("received", "erhalten")}
          </>
        ) : (
          tr(`Last 10 weeks: ${n(total.s)} sent, ${n(total.r)} received`, `Letzte 10 Wochen: ${n(total.s)} gesendet, ${n(total.r)} erhalten`)
        )}
      </p>
      <div className="relative mt-3 h-[150px] pl-7">
        {[top, top / 2, 0].map((v) => (
          <div key={v} className="absolute left-7 right-0 border-t border-line" style={{ bottom: `${(v / top) * 100}%` }}>
            <span className="absolute -left-7 -top-2 w-6 text-right text-[11px] text-muted">{n(v)}</span>
          </div>
        ))}
        <div className="relative flex h-full items-end gap-1">
          {d.weekly.map((w, i) => (
            <div
              key={w.week}
              className={cx("flex h-full flex-1 items-end justify-center gap-[2px] rounded-md", hover === i && "bg-surface2/80")}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
            >
              <div className="w-[38%] max-w-[14px] rounded-t-[4px] bg-viz-out" style={{ height: `${(w.sent / top) * 100}%` }} />
              <div className="w-[38%] max-w-[14px] rounded-t-[4px] bg-viz-in" style={{ height: `${(w.received / top) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-1 pl-7 text-[10.5px] text-muted" aria-hidden>
        {d.weekly.map((w, i) => (
          <span key={w.week} className="flex-1 text-center">
            {i % 2 === 1 || d.weekly.length <= 6 ? weekLabel(w.week) : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{tr("Emails per week", "Mails pro Woche")}</caption>
        <thead>
          <tr>
            <th>{tr("Week of", "Woche ab")}</th>
            <th>{tr("Sent", "Gesendet")}</th>
            <th>{tr("Received", "Erhalten")}</th>
          </tr>
        </thead>
        <tbody>
          {d.weekly.map((w) => (
            <tr key={w.week}>
              <td>{weekLabel(w.week)}</td>
              <td>{w.sent}</td>
              <td>{w.received}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function niceTop(max: number) {
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/* ---------- By type ---------- */

function ByType({ kind, d, meta }: { kind: OrgKind; d: Dash; meta: OrgMeta }) {
  const rows = d.byType.slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className="card p-4 sm:p-5" aria-label={tr("By type", "Nach Art")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold">{tr("By type", "Nach Art")}</h2>
        <ul className="flex gap-3 text-[12px] text-muted" aria-label={tr("Legend", "Legende")}>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-viz-out" aria-hidden /> {tr("In progress", "In Arbeit")}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-viz-out/25" aria-hidden /> {tr("Total", "Gesamt")}
          </li>
        </ul>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.type} title={tr(`${meta.types[kind][r.type] ?? r.type}: ${n(r.total)} total, ${n(r.active + r.won)} in progress or won`, `${meta.types[kind][r.type] ?? r.type}: ${n(r.total)} gesamt, ${n(r.active + r.won)} in Arbeit oder gewonnen`)}>
            <Link to={`${ORG_KIND[kind].path}?ansicht=liste&art=${r.type}`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate font-medium">{meta.types[kind][r.type] ?? r.type}</span>
                <span className="shrink-0 text-muted">
                  <span className="font-semibold text-ink">{n(r.active + r.won)}</span> {tr("of", "von")} {n(r.total)}
                </span>
              </div>
              <div className="mt-1 flex h-2 gap-[2px]">
                <div className="h-2 rounded-l-full bg-viz-out" style={{ width: `${((r.active + r.won) / max) * 100}%` }} />
                <div className="h-2 rounded-r-full bg-viz-out/25" style={{ width: `${((r.total - r.active - r.won) / max) * 100}%` }} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Recent activity ---------- */

function Recent({ kind, d }: { kind: OrgKind; d: Dash }) {
  const users = useUserMap();
  const items = useMemo(() => d.recent, [d.recent]);
  return (
    <section className="card p-4 sm:p-5 lg:col-span-2" aria-label={tr("Recent activity", "Letzte Aktivitäten")}>
      <h2 className="text-[15px] font-bold">{tr("Recent activity", "Letzte Aktivitäten")}</h2>
      {items.length ? (
        <ul className="mt-2 divide-y divide-line">
          {items.map((a, i) => {
            const u = a.userId ? users.get(a.userId) : undefined;
            return (
              <li key={`${a.orgId}-${a.at}-${i}`}>
                <Link to={`${ORG_KIND[kind].path}/${a.orgId}`} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface2/60">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface2">
                    <DirIcon kind={a.kind} dir={a.dir} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">
                      <span className="font-semibold">{a.orgName}</span>
                      {a.contactName && a.contactName !== a.orgName && <span className="text-muted">, {a.contactName}</span>}
                    </span>
                    <span className="block truncate text-[13px] text-muted">{a.text ? <Tx text={a.text} /> : tr("(no subject)", "(ohne Betreff)")}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted">
                    <Clock className="h-3 w-3" aria-hidden />
                    {relTime(a.at)}
                    {u && <span className="sr-only">, {u.name}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-muted">{tr("No activity yet. Emails you link to a contact in Mail show up here.", "Noch keine Aktivitäten. Mails, die du im Postfach einem Kontakt zuordnest, erscheinen hier.")}</p>
      )}
    </section>
  );
}
