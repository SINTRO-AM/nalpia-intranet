import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Diamond, Flag, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, Pill, Progress, Segmented, Skeleton } from "@/components/ui";
import { countdown, dueInfo, MILESTONE_STATUS, PRIORITY } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useMe, useMilestones, useTasks, useUpdateTask, useUserMap, useUsers } from "@/lib/queries";
import type { Task, TaskStatus } from "@/lib/types";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

type View = "meine" | "team" | "board" | "meilensteine";

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("ansicht") as View) || "meine";
  const setView = (v: View) => setParams(v === "meine" ? {} : { ansicht: v }, { replace: true });
  const { open } = useOverlays();
  const mine = useTasks({ assignee: "me", status: "open" }).data;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{tr("Tasks", "Aufgaben")}</h1>
          <p className="text-[14px] text-muted">{tr("Who does what, by when.", "Wer macht was bis wann.")}</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          {view === "meilensteine" ? (
            <Button variant="primary" icon={<Flag className="h-4 w-4" />} onClick={() => open({ kind: "milestone" })}>
              {tr("New milestone", "Neuer Meilenstein")}
            </Button>
          ) : (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "task" })}>
              {tr("New task", "Neue Aufgabe")}
            </Button>
          )}
        </div>
      </header>
      <Segmented<View>
        value={view}
        onChange={setView}
        options={[
          { value: "meine", label: tr("Mine", "Meine"), count: mine?.length },
          { value: "team", label: "Team" },
          { value: "board", label: "Board" },
          { value: "meilensteine", label: tr("Milestones", "Meilensteine") },
        ]}
      />
      {view === "meine" && <MyTasks />}
      {view === "team" && <TeamTasks />}
      {view === "board" && <Board />}
      {view === "meilensteine" && <Milestones />}
    </div>
  );
}

/** Display label for the internal group keys of MyTasks */
const groupLabel = (k: string) =>
  ({ Overdue: tr("Overdue", "Überfällig"), Today: tr("Today", "Heute"), "This week": tr("This week", "Diese Woche"), Later: tr("Later", "Später"), "No date": tr("No date", "Ohne Datum") })[k] ?? k;

function MyTasks() {
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const open = useTasks({ assignee: "me", status: "open", q: q || undefined });
  const done = useTasks({ assignee: "me", status: "done" });
  const created = useTasks({ status: "open" });
  const me = useMe().data?.user;
  const delegated = (created.data ?? []).filter((t) => t.createdBy === me?.id && t.assigneeId && t.assigneeId !== me?.id);

  const groups = useMemo(() => {
    const g: Record<string, Task[]> = { Overdue: [], Today: [], "This week": [], Later: [], "No date": [] };
    for (const t of open.data ?? []) {
      const d = dueInfo(t.dueDate);
      if (d.tone === "none") g["No date"]!.push(t);
      else if (d.tone === "over") g["Overdue"]!.push(t);
      else if (d.tone === "today") g["Today"]!.push(t);
      else if ((d.days ?? 99) <= 7) g["This week"]!.push(t);
      else g["Later"]!.push(t);
    }
    return g;
  }, [open.data]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div className="card px-4 pb-2">
        <div className="sticky top-14 z-10 -mx-4 flex items-center gap-2 rounded-t-2xl border-b border-line bg-surface px-4 py-2.5 lg:top-16">
          <Search className="h-4 w-4 text-muted" />
          <input className="h-8 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70" placeholder={tr("Search my tasks", "In meinen Aufgaben suchen")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search", "Suchen")} />
        </div>
        {open.isLoading ? (
          <div className="space-y-2 py-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (open.data ?? []).length === 0 ? (
          <EmptyState title={q ? tr("No results", "Keine Treffer") : tr("All done", "Alles erledigt")} text={q ? tr("Try a different term.", "Versuch einen anderen Begriff.") : tr("Treat yourself to a coffee – or create the next task.", "Gönn dir einen Kaffee – oder leg die nächste Aufgabe an.")} />
        ) : (
          Object.entries(groups).map(
            ([label, list]) =>
              list.length > 0 && (
                <div key={label}>
                  <p className={cx("pt-3 text-[12.5px] font-semibold", label === "Overdue" ? "text-neg" : label === "Today" ? "text-accent-ink" : "text-muted")}>
                    {groupLabel(label)} <span className="num">{list.length}</span>
                  </p>
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} showAssignee={false} />
                  ))}
                </div>
              ),
          )
        )}
        <button className="mt-2 flex w-full items-center gap-1.5 border-t border-line py-3 text-[13px] font-semibold text-muted" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
          <ChevronDown className={cx("h-4 w-4 transition", showDone && "rotate-180")} />
          {tr("Done", "Erledigt")} <span className="num">{done.data?.length ?? 0}</span>
        </button>
        {showDone && (done.data ?? []).slice(0, 30).map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}
      </div>
      <aside className="space-y-4">
        <div className="card px-4 py-3.5">
          <h2 className="section-title">{tr("Delegated by me", "Von mir delegiert")}</h2>
          <p className="text-[13px] text-muted">{tr("Open tasks you assigned to others.", "Offene Aufgaben, die du anderen zugewiesen hast.")}</p>
          {delegated.length === 0 ? (
            <p className="py-3 text-sm text-muted">{tr("Nothing open.", "Nichts offen.")}</p>
          ) : (
            delegated.slice(0, 12).map((t) => <TaskRow key={t.id} task={t} showContext={false} />)
          )}
        </div>
      </aside>
    </div>
  );
}

function TeamTasks() {
  const { data: users } = useUsers();
  const tasks = useTasks({ status: "open" });
  const byUser = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks.data ?? []) {
      const k = t.assigneeId ?? "none";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tasks.data]);
  const unassigned = byUser.get("none") ?? [];
  if (tasks.isLoading) return <Skeleton className="h-64" />;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(users ?? []).map((u) => {
        const list = byUser.get(u.id) ?? [];
        const over = list.filter((t) => dueInfo(t.dueDate).tone === "over").length;
        return (
          <section key={u.id} className="card flex flex-col px-4 py-3.5">
            <div className="flex items-center gap-3">
              <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{u.name}</p>
                <p className="truncate text-[13px] text-muted"><Tx text={u.title} /></p>
              </div>
              <div className="text-right">
                <p className="num text-[18px] font-semibold leading-none">{list.length}</p>
                <p className="text-[11.5px] text-muted">{tr("open", "offen")}</p>
              </div>
            </div>
            {u.responsibilities.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {u.responsibilities.map((r) => (
                  <span key={r} className="rounded-md bg-surface2 px-1.5 py-0.5 text-[11.5px] font-semibold text-muted">
                    <Tx text={r} />
                  </span>
                ))}
              </div>
            )}
            {over > 0 && <p className="mt-2 text-[12.5px] font-semibold text-neg">{tr(`${over} overdue`, `${over} überfällig`)}</p>}
            <div className="mt-1">
              {list.length === 0 ? <p className="py-3 text-sm text-muted">{tr("No open tasks.", "Keine offenen Aufgaben.")}</p> : list.slice(0, 6).map((t) => <TaskRow key={t.id} task={t} showAssignee={false} />)}
              {list.length > 6 && <p className="pt-2 text-[12.5px] text-muted">{tr(`and ${list.length - 6} more`, `und ${list.length - 6} weitere`)}</p>}
            </div>
          </section>
        );
      })}
      {unassigned.length > 0 && (
        <section className="card px-4 py-3.5">
          <p className="font-bold">{tr("No owner", "Ohne Zuständigkeit")}</p>
          <p className="text-[13px] text-muted">{tr("Who takes it on?", "Wer übernimmt?")}</p>
          {unassigned.map((t) => (
            <TaskRow key={t.id} task={t} showAssignee={false} />
          ))}
        </section>
      )}
    </div>
  );
}

const COLUMNS: { status: TaskStatus; readonly label: string }[] = [
  { status: "offen", get label() { return tr("Open", "Offen"); } },
  { status: "in_arbeit", get label() { return tr("In progress", "In Arbeit"); } },
  { status: "erledigt", get label() { return tr("Done", "Erledigt"); } },
];

function Board() {
  const [person, setPerson] = useState<string>("all");
  const [ms, setMs] = useState<string>("");
  const tasks = useTasks({ status: "all", assignee: person, milestone: ms || undefined });
  const milestones = useMilestones().data;
  const { data: users } = useUsers();
  const update = useUpdateTask();
  const userMap = useUserMap();
  const { open } = useOverlays();
  const qc = useQueryClient();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const dragging = useRef<string | null>(null);
  const recentDone = Date.now() - 14 * 86400_000;
  const list = (tasks.data ?? []).filter((t) => t.status !== "erledigt" || (t.completedAt ?? 0) > recentDone);

  function onDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/task") || e.dataTransfer.getData("text/plain") || dragging.current || "";
    dragging.current = null;
    const t = list.find((x) => x.id === id);
    if (!t || t.status === status) return;
    update.mutate({ id, patch: { status } }, { onError: (err) => toast.error((err as Error).message), onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select className="w-[200px]" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="all">{tr("Everyone", "Alle Personen")}</option>
          <option value="me">{tr("Only mine", "Nur meine")}</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select className="w-[240px]" value={ms} onChange={(e) => setMs(e.target.value)} aria-label={tr("Milestone", "Meilenstein")}>
          <option value="">{tr("All milestones", "Alle Meilensteine")}</option>
          {(milestones ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              <Tx text={m.title} />
            </option>
          ))}
        </Select>
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
        {COLUMNS.map((col) => {
          const items = list.filter((t) => t.status === col.status);
          return (
            <section
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.status);
              }}
              onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
              onDrop={(e) => onDrop(e, col.status)}
              className={cx("flex w-[84vw] max-w-[360px] shrink-0 snap-start flex-col rounded-2xl bg-surface2/70 p-2.5 transition lg:w-auto lg:max-w-none", over === col.status && "ring-2 ring-info")}
            >
              <h2 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-sm font-bold">
                {col.label} <span className="num text-[12px] font-medium text-muted">{items.length}</span>
              </h2>
              <div className="flex min-h-[120px] flex-col gap-2">
                {items.map((t) => {
                  const u = t.assigneeId ? userMap.get(t.assigneeId) : undefined;
                  const d = dueInfo(t.dueDate, t.status === "erledigt");
                  return (
                    <article
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        dragging.current = t.id;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/task", t.id);
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragEnd={() => {
                        dragging.current = null;
                        setOver(null);
                      }}
                      onClick={() => open({ kind: "task", id: t.id })}
                      className="cursor-pointer rounded-xl border border-line bg-surface p-3 transition hover:border-muted/40 active:scale-[.99]"
                    >
                      <div className="flex items-start gap-2">
                        <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY[t.priority]?.dot)} aria-label={tr(`Priority ${PRIORITY[t.priority]?.label}`, `Priorität ${PRIORITY[t.priority]?.label}`)} />
                        <p className={cx("min-w-0 flex-1 text-[14px] font-semibold leading-snug", t.status === "erledigt" && "text-muted line-through")}><Tx text={t.title} /></p>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                        {t.dueDate && <span className={cx(d.tone === "over" && "font-semibold text-neg", d.tone === "today" && "font-semibold text-accent-ink")}>{d.label}</span>}
                        {t.milestoneTitle && <span className="min-w-0 flex-1 truncate"><Tx text={t.milestoneTitle} /></span>}
                        <span className="flex-1" />
                        {u && <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={22} />}
                      </div>
                      <div className="mt-2 flex gap-1 lg:hidden" onClick={(e) => e.stopPropagation()}>
                        {COLUMNS.filter((c) => c.status !== t.status).map((c) => (
                          <button key={c.status} className="h-7 rounded-full border border-line px-2.5 text-[11.5px] font-semibold text-muted" onClick={() => update.mutate({ id: t.id, patch: { status: c.status } })}>
                            → {c.label}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Milestones() {
  const { data, isLoading } = useMilestones();
  const users = useUserMap();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const [showDone, setShowDone] = useState(false);
  if (isLoading) return <Skeleton className="h-64" />;
  const active = (data ?? []).filter((m) => m.status !== "erreicht");
  const reached = (data ?? []).filter((m) => m.status === "erreicht");
  if (!data?.length)
    return (
      <EmptyState
        icon={<Flag className="h-5 w-5" />}
        title={tr("No milestones yet", "Noch keine Meilensteine")}
        text={tr("Milestones group tasks into a goal with a date and an owner.", "Meilensteine bündeln Aufgaben zu einem Ziel mit Datum und Verantwortlichen.")}
        action={
          <Button variant="primary" onClick={() => open({ kind: "milestone" })}>
            {tr("Create first milestone", "Ersten Meilenstein anlegen")}
          </Button>
        }
      />
    );
  const card = (m: (typeof active)[number]) => {
    const o = m.ownerId ? users.get(m.ownerId) : undefined;
    const d = dueInfo(m.dueDate);
    return (
      <button key={m.id} onClick={() => navigate(`/aufgaben/meilensteine/${m.id}`)} className="card flex flex-col p-4 text-left transition hover:border-muted/40">
        <div className="flex items-start gap-2.5">
          <Diamond className={cx("mt-0.5 h-4 w-4 shrink-0", m.status === "erreicht" ? "fill-pos text-pos" : "fill-accent text-accent")} />
          <p className="min-w-0 flex-1 text-[15.5px] font-bold leading-snug"><Tx text={m.title} /></p>
          <Pill className={MILESTONE_STATUS[m.status]?.tone}>{MILESTONE_STATUS[m.status]?.label}</Pill>
        </div>
        {m.description && <p className="mt-1.5 line-clamp-2 pl-[26px] text-[13px] text-muted"><Tx text={m.description} /></p>}
        <div className="mt-auto pl-[26px] pt-3">
          <div className="flex items-center gap-3">
            <Progress label={tr(`Progress: ${m.title}`, `Fortschritt: ${m.title}`)} value={m.progress} className="flex-1" tone={m.progress >= 1 ? "pos" : "brand"} />
            <span className="num text-[12px] text-muted">
              {m.taskDone}/{m.taskTotal}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[12.5px]">
            {o && <Avatar name={o.name} color={o.avatarColor} src={o.avatarUrl} size={22} />}
            <span className="min-w-0 flex-1 truncate text-muted">{o?.name ?? tr("No owner", "Niemand verantwortlich")}</span>
            <span className={cx("shrink-0", m.status !== "erreicht" && d.tone === "over" ? "font-semibold text-neg" : m.status !== "erreicht" && (d.tone === "today" || d.tone === "soon") ? "font-semibold text-accent-ink" : "text-muted")}>
              {m.dueDate ? (m.status === "erreicht" ? d.label : countdown(m.dueDate)) : tr("no date", "ohne Datum")}
            </span>
          </div>
        </div>
      </button>
    );
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{active.map(card)}</div>
      {reached.length > 0 && (
        <div>
          <button className="flex items-center gap-1.5 text-[13px] font-semibold text-muted" onClick={() => setShowDone((v) => !v)}>
            <ChevronDown className={cx("h-4 w-4 transition", showDone && "rotate-180")} /> {tr("Achieved", "Erreicht")} <span className="num">{reached.length}</span>
          </button>
          {showDone && <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{reached.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
