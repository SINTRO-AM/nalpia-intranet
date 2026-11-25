import { useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarClock, ChevronRight, CircleDot, Hourglass, Kanban, List, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { Avatar, Button, cx, EmptyState, Progress, Segmented, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { daysSince, dueInfo, relTime, todayISO, TOPIC_KIND, TOPIC_STAGE, TOPIC_STAGES } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlays } from "@/lib/overlays";
import { useMe, useTopicAreas, useTopics, useUpdateTopic, useUserMap, useUsers } from "@/lib/queries";
import { Tx } from "@/lib/translate";
import type { Topic, TopicKind, TopicStage } from "@/lib/types";

type View = "board" | "liste";

export function TopicsPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("ansicht") as View) || "board";
  const kind = (params.get("art") as TopicKind | null) ?? undefined;
  const owner = params.get("person") ?? "all";
  const area = params.get("bereich") ?? "";
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const { open } = useOverlays();
  const { data: users } = useUsers();
  const areas = useTopicAreas().data ?? [];
  const topics = useTopics({ kind, owner, area: area || undefined, q: q || undefined, state: view === "liste" && showClosed ? "all" : "board" });
  const list = topics.data ?? [];

  // "n" opens a new topic (outside of input fields)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault();
      open({ kind: "topic", defaults: kind ? { kind } : undefined });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, kind]);

  const today = todayISO();
  const openTopics = list.filter((t) => !["erledigt", "verworfen"].includes(t.stage));
  const waiting = openTopics.filter((t) => t.stage === "wartet");
  const dueFollow = openTopics.filter((t) => t.followUp && t.followUp <= today);
  const overdueTasks = openTopics.reduce((n, t) => n + t.taskOverdue, 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{tr("Topics", "Themen")}</h1>
          <p className="text-[14px] text-muted">{tr("Internal and external matters at a glance – from inbox to done.", "Interne und externe Themen im Blick – vom Eingang bis zum Abschluss.")}</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "topic", defaults: kind ? { kind } : undefined })} className="hidden sm:inline-flex">
          {tr("New topic", "Neues Thema")}
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<"alle" | TopicKind>
          value={kind ?? "alle"}
          onChange={(v) => set("art", v === "alle" ? null : v)}
          options={[
            { value: "alle", label: tr("All", "Alle") },
            { value: "intern", label: tr("Internal", "Intern") },
            { value: "extern", label: tr("External", "Extern") },
          ]}
        />
        <Select className="w-[170px]" value={owner} onChange={(e) => set("person", e.target.value === "all" ? null : e.target.value)} aria-label={tr("Owner", "Verantwortlich")}>
          <option value="all">{tr("Everyone", "Alle Personen")}</option>
          <option value="me">{tr("Mine", "Meine")}</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        {areas.length > 0 && (
          <Select className="w-[170px]" value={area} onChange={(e) => set("bereich", e.target.value || null)} aria-label={tr("Area", "Bereich")}>
            <option value="">{tr("All areas", "Alle Bereiche")}</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        )}
        <label className="flex h-10 min-w-[160px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 sm:max-w-[260px]">
          <Search className="h-4 w-4 text-muted" />
          <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70" placeholder={tr("Search topics", "Themen suchen")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search topics", "Themen suchen")} />
        </label>
        <span className="flex-1" />
        <Segmented<View>
          value={view}
          onChange={(v) => set("ansicht", v === "board" ? null : v)}
          options={[
            { value: "board", label: <span className="inline-flex items-center gap-1.5"><Kanban className="h-4 w-4" />Board</span> },
            { value: "liste", label: <span className="inline-flex items-center gap-1.5"><List className="h-4 w-4" />{tr("List", "Liste")}</span> },
          ]}
        />
      </div>

      {list.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
          <span>
            <b className="num text-ink">{openTopics.length}</b> {tr("open", "offen")}
          </span>
          {waiting.length > 0 && (
            <span>
              <b className="num text-accent-ink">{waiting.length}</b> {tr("waiting", "warten")}
              {waiting.some((t) => (daysSince(t.waitingSince) ?? 0) >= 14) && <span className="text-neg"> {tr("(some for 2+ weeks)", "(teils seit 2+ Wochen)")}</span>}
            </span>
          )}
          {dueFollow.length > 0 && (
            <span>
              <b className="num text-neg">{dueFollow.length}</b> {tr("follow-ups due", "Wiedervorlagen fällig")}
            </span>
          )}
          {overdueTasks > 0 && (
            <span>
              <b className="num text-neg">{overdueTasks}</b> {tr("overdue tasks in topics", "überfällige Aufgaben in Themen")}
            </span>
          )}
        </div>
      )}

      {topics.isLoading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : list.length === 0 && !q && !area && owner === "all" && !kind ? (
        <EmptyState
          icon={<Kanban className="h-5 w-5" />}
          title={tr("No topics yet", "Noch keine Themen")}
          text={tr(
            "Topics bundle what runs over weeks: a funding application, a partner talk, the architecture rebuild. Each has a stage, an owner, tasks and a follow-up date.",
            "Themen bündeln, was über Wochen läuft: einen Förderantrag, ein Partnergespräch, den Architektur-Umbau. Jedes hat eine Phase, Verantwortliche, Aufgaben und eine Wiedervorlage.",
          )}
          action={
            <Button variant="primary" onClick={() => open({ kind: "topic" })}>
              {tr("Create first topic", "Erstes Thema anlegen")}
            </Button>
          }
        />
      ) : view === "board" ? (
        <Board topics={list} kind={kind} />
      ) : (
        <ListView topics={list} showClosed={showClosed} setShowClosed={setShowClosed} />
      )}
    </div>
  );
}

/* ---------- Board ---------- */

function Board({ topics, kind }: { topics: Topic[]; kind?: TopicKind }) {
  const update = useUpdateTopic();
  const [drop, setDrop] = useState<{ stage: TopicStage; before: string | null } | null>(null);
  const dragging = useRef<string | null>(null);
  const byStage = useMemo(() => {
    const m = new Map<TopicStage, Topic[]>();
    for (const s of TOPIC_STAGES) m.set(s, []);
    for (const t of topics) m.get(t.stage)?.push(t);
    for (const l of m.values()) l.sort((a, b) => a.sortOrder - b.sortOrder);
    return m;
  }, [topics]);

  function onDrop(e: DragEvent, stage: TopicStage) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/topic") || dragging.current;
    const target = drop;
    setDrop(null);
    dragging.current = null;
    if (!id) return;
    const t = topics.find((x) => x.id === id);
    if (!t) return;
    const col = (byStage.get(stage) ?? []).filter((x) => x.id !== id);
    const idx = target?.stage === stage && target.before ? col.findIndex((x) => x.id === target.before) : col.length;
    const i = idx < 0 ? col.length : idx;
    const prev = col[i - 1]?.sortOrder;
    const next = col[i]?.sortOrder;
    const sortOrder = prev === undefined && next === undefined ? Date.now() : prev === undefined ? next! - 1000 : next === undefined ? prev + 1000 : (prev + next) / 2;
    if (t.stage === stage && t.sortOrder === sortOrder) return;
    update.mutate(
      { id, patch: { stage, sortOrder } },
      {
        onSuccess: () => {
          if (t.stage !== stage) toast(tr(`Moved to ${TOPIC_STAGE[stage]?.label}`, `Nach ${TOPIC_STAGE[stage]?.label} verschoben`), { description: t.title, action: { label: tr("Undo", "Rückgängig"), onClick: () => update.mutate({ id, patch: { stage: t.stage, sortOrder: t.sortOrder } }) } });
        },
        onError: (err) => toast.error((err as Error).message),
      },
    );
  }

  return (
    <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:gap-2.5 lg:overflow-visible lg:px-0">
      {TOPIC_STAGES.map((stage) => {
        const items = byStage.get(stage) ?? [];
        const active = drop?.stage === stage;
        return (
          <section
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              setDrop((d) => (d?.stage === stage && d.before === null ? d : { stage, before: null }));
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.stage === stage ? null : d));
            }}
            onDrop={(e) => onDrop(e, stage)}
            className={cx("relative flex w-[80vw] max-w-[320px] shrink-0 snap-start flex-col rounded-2xl bg-surface2/70 p-2 transition lg:w-auto lg:max-w-none", active && "ring-2 ring-info")}
          >
            <header className="flex items-center gap-2 px-1.5 pb-2 pt-1" title={TOPIC_STAGE[stage]?.hint}>
              <span className={cx("h-2 w-2 rounded-full", TOPIC_STAGE[stage]?.dot)} aria-hidden />
              <h2 className="text-sm font-bold">{TOPIC_STAGE[stage]?.label}</h2>
              <span className="num text-[12px] font-medium text-muted">{items.length}</span>
              <span className="flex-1" />
              <QuickTopic stage={stage} kind={kind} />
            </header>
            <div className="flex min-h-[140px] flex-1 flex-col">
              {items.map((t) => (
                <div
                  key={t.id}
                  className="pb-2"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const upper = e.clientY < r.top + r.height / 2;
                    const idx = items.findIndex((x) => x.id === t.id);
                    const before = upper ? t.id : (items[idx + 1]?.id ?? null);
                    setDrop((d) => (d?.stage === stage && d.before === before ? d : { stage, before }));
                  }}
                >
                  {active && drop?.before === t.id && <div className="mb-1.5 h-1 rounded-full bg-info" />}
                  <TopicCard
                    topic={t}
                    onDragStart={(e) => {
                      dragging.current = t.id;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/topic", t.id);
                    }}
                    onDragEnd={() => {
                      dragging.current = null;
                      setDrop(null);
                    }}
                  />
                </div>
              ))}
              {active && !drop?.before && items.length > 0 && <div className="h-1 shrink-0 rounded-full bg-info" />}
              {items.length === 0 && <p className="px-2 py-6 text-center text-[12.5px] text-muted/80">{TOPIC_STAGE[stage]?.hint}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** "+" in the column header: a topic with just a title, straight into this stage. */
function QuickTopic({ stage, kind }: { stage: TopicStage; kind?: TopicKind }) {
  const qc = useQueryClient();
  const { open } = useOverlays();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  async function create() {
    const v = title.trim();
    if (!v) return setEditing(false);
    try {
      await api.post("/api/topics", { title: v, stage, kind });
      setTitle("");
      qc.invalidateQueries({ queryKey: ["topics"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  if (!editing)
    return (
      <button type="button" onClick={() => setEditing(true)} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink" aria-label={tr(`New topic in ${TOPIC_STAGE[stage]?.label}`, `Neues Thema in ${TOPIC_STAGE[stage]?.label}`)}>
        <Plus className="h-4 w-4" />
      </button>
    );
  return (
    <div className="absolute left-2 right-2 top-10 z-10">
      <input
        autoFocus
        className="field h-10 text-[14px] shadow-pop"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") {
            setTitle("");
            setEditing(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) setEditing(false);
        }}
        placeholder={tr("Title, Enter – details later", "Titel, Enter – Details später")}
        aria-label={tr("Title of the new topic", "Titel des neuen Themas")}
      />
      <button type="button" className="mt-1 text-[12px] font-semibold text-info" onMouseDown={(e) => e.preventDefault()} onClick={() => open({ kind: "topic", defaults: { stage, kind, title } })}>
        {tr("With details …", "Mit Details …")}
      </button>
    </div>
  );
}

export function TopicCard({ topic: t, onDragStart, onDragEnd }: { topic: Topic; onDragStart?: (e: DragEvent) => void; onDragEnd?: () => void }) {
  const users = useUserMap();
  const { open } = useOverlays();
  const owner = t.ownerId ? users.get(t.ownerId) : undefined;
  const today = todayISO();
  const follow = t.followUp ? dueInfo(t.followUp) : null;
  const waitDays = daysSince(t.waitingSince);
  const closed = t.stage === "erledigt" || t.stage === "verworfen";
  const next = t.nextTask;
  const nextDue = next?.dueDate ? dueInfo(next.dueDate) : null;
  return (
    <article
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => open({ kind: "topic", id: t.id })}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open({ kind: "topic", id: t.id }))}
      tabIndex={0}
      role="button"
      aria-label={t.title}
      className="relative cursor-pointer rounded-xl border border-line bg-surface p-3 transition hover:border-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-[.99]"
    >
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
        <span className={cx("rounded-md px-1.5 py-px", TOPIC_KIND[t.kind]?.tone)}>{TOPIC_KIND[t.kind]?.label}</span>
        {t.area && <span className="truncate text-muted">{t.area}</span>}
        <span className="flex-1" />
        {follow && !closed && (
          <span className={cx("inline-flex shrink-0 items-center gap-0.5", t.followUp! < today ? "text-neg" : t.followUp === today ? "text-accent-ink" : "text-muted")} title={tr("Follow-up", "Wiedervorlage")}>
            <CalendarClock className="h-3 w-3" aria-hidden />
            {follow.label}
          </span>
        )}
      </div>
      <p className={cx("mt-1.5 line-clamp-3 text-[14px] font-bold leading-snug", closed && "text-muted")}>
        <Tx text={t.title} />
      </p>
      {(t.counterpart || t.organizationName) && (
        <p className="mt-1 flex min-w-0 items-center gap-1 text-[12.5px] text-muted">
          <Building2 className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{t.counterpart || t.organizationName}</span>
        </p>
      )}
      {t.stage === "wartet" && (
        <p className={cx("mt-1.5 flex items-start gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold", (waitDays ?? 0) >= 14 ? "bg-neg-soft text-neg" : "bg-accent-soft text-accent-ink")}>
          <Hourglass className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0">
            {waitDays === null || waitDays === 0 ? tr("Waiting since today", "Wartet seit heute") : tr(`Waiting for ${waitDays} days`, `Wartet seit ${waitDays} ${waitDays === 1 ? "Tag" : "Tagen"}`)}
            {t.waitingOn && (
              <span className="font-normal">
                {" · "}
                <Tx text={t.waitingOn} />
              </span>
            )}
          </span>
        </p>
      )}
      {!closed && (next || t.nextStep) && (
        <p className="mt-1.5 flex min-w-0 items-start gap-1 text-[12.5px]">
          <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0">
            <span className="line-clamp-2">
              <Tx text={next ? next.title : t.nextStep} />
            </span>
            {nextDue && <span className={cx("text-[11.5px]", nextDue.tone === "over" ? "font-semibold text-neg" : nextDue.tone === "today" ? "font-semibold text-accent-ink" : "text-muted")}>{nextDue.label}</span>}
          </span>
        </p>
      )}
      {t.taskTotal > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <Progress value={t.taskDone / t.taskTotal} className="flex-1" tone={t.taskDone === t.taskTotal ? "pos" : "brand"} label={tr(`Progress: ${t.title}`, `Fortschritt: ${t.title}`)} />
          <span className="num text-[11.5px] text-muted">
            {t.taskDone}/{t.taskTotal}
          </span>
          {t.taskOverdue > 0 && <span className="num text-[11.5px] font-semibold text-neg" title={tr("overdue", "überfällig")}>!{t.taskOverdue}</span>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
        {owner ? <Avatar name={owner.name} color={owner.avatarColor} src={owner.avatarUrl} size={20} /> : <span className="h-5 w-5 rounded-full border border-dashed border-line" title={tr("No owner", "Niemand verantwortlich")} />}
        <span className="min-w-0 flex-1 truncate">{owner?.name.split(" ")[0] ?? tr("No owner", "Niemand")}</span>
        <span className="shrink-0">{relTime(t.lastActivity)}</span>
      </div>
    </article>
  );
}

/* ---------- List ---------- */

function ListView({ topics, showClosed, setShowClosed }: { topics: Topic[]; showClosed: boolean; setShowClosed: (v: boolean) => void }) {
  const users = useUserMap();
  const me = useMe().data?.user;
  const { open } = useOverlays();
  const today = todayISO();
  const stages = [...TOPIC_STAGES, "verworfen" as const];
  return (
    <div className="space-y-4">
      {stages.map((stage) => {
        const items = topics.filter((t) => t.stage === stage).sort((a, b) => a.sortOrder - b.sortOrder);
        if (!items.length) return null;
        return (
          <section key={stage} className="card overflow-hidden">
            <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-bold">
              <span className={cx("h-2 w-2 rounded-full", TOPIC_STAGE[stage]?.dot)} aria-hidden />
              {TOPIC_STAGE[stage]?.label} <span className="num text-[12px] font-medium text-muted">{items.length}</span>
            </h2>
            <ul>
              {items.map((t) => {
                const o = t.ownerId ? users.get(t.ownerId) : undefined;
                const f = t.followUp ? dueInfo(t.followUp) : null;
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => open({ kind: "topic", id: t.id })} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface2/50 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_120px_110px_100px_20px]">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className={cx("shrink-0 rounded-md px-1.5 py-px text-[11px] font-semibold", TOPIC_KIND[t.kind]?.tone)}>{TOPIC_KIND[t.kind]?.label}</span>
                          <span className="truncate text-[14.5px] font-semibold">
                            <Tx text={t.title} />
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                          {[t.area, t.counterpart || t.organizationName].filter(Boolean).join(" · ")}
                          {t.stage === "wartet" && t.waitingOn && <span className="text-accent-ink"> · {tr("waiting on", "wartet auf")} <Tx text={t.waitingOn} /></span>}
                        </span>
                      </span>
                      <span className="hidden min-w-0 truncate text-[12.5px] text-muted md:block">{t.nextTask ? <Tx text={t.nextTask.title} /> : t.nextStep ? <Tx text={t.nextStep} /> : "–"}</span>
                      <span className="hidden items-center gap-2 md:flex">
                        {t.taskTotal > 0 ? (
                          <>
                            <Progress value={t.taskDone / t.taskTotal} className="flex-1" tone={t.taskDone === t.taskTotal ? "pos" : "brand"} label={tr(`Progress: ${t.title}`, `Fortschritt: ${t.title}`)} />
                            <span className="num text-[11.5px] text-muted">{t.taskDone}/{t.taskTotal}</span>
                          </>
                        ) : (
                          <span className="text-[12px] text-muted">{tr("no tasks", "keine Aufgaben")}</span>
                        )}
                      </span>
                      <span className={cx("hidden text-[12.5px] md:block", f && t.followUp! < today ? "font-semibold text-neg" : "text-muted")}>{f ? f.label : "–"}</span>
                      <span className="flex items-center justify-end gap-1.5 md:justify-start">
                        {o && <Avatar name={o.name} color={o.avatarColor} src={o.avatarUrl} size={22} />}
                        <span className={cx("hidden truncate text-[12.5px] sm:inline", o?.id === me?.id ? "font-semibold" : "text-muted")}>{o?.name.split(" ")[0] ?? "–"}</span>
                      </span>
                      <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <button type="button" className="text-[13px] font-semibold text-muted hover:text-ink" onClick={() => setShowClosed(!showClosed)}>
        {showClosed ? tr("Hide older and dropped topics", "Ältere und verworfene Themen ausblenden") : tr("Show all finished and dropped topics", "Alle abgeschlossenen und verworfenen Themen zeigen")}
      </button>
    </div>
  );
}
