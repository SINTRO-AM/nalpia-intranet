import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, Diamond, Flag, Hourglass, ListChecks, MessageSquare, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select, TopicSelect, UserSelect } from "@/components/pickers";
import { QuickAdd, type QuickAddHandle } from "@/components/QuickAdd";
import { nextMonday, TaskRow, TopicChip } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, Pill, Progress, Segmented, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { checklistStats } from "@/lib/checklist";
import { addDays, countdown, dueInfo, MILESTONE_STATUS, PRIORITY, todayISO } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { invalidateWork, useMe, useMilestones, useTasks, useTopics, useUpdateTask, useUserMap, useUsers } from "@/lib/queries";
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
  ({
    Overdue: tr("Overdue", "Überfällig"),
    Today: tr("Today", "Heute"),
    "This week": tr("This week", "Diese Woche"),
    Later: tr("Later", "Später"),
    "No date": tr("No date", "Ohne Datum"),
    Waiting: tr("Waiting on others", "Wartet auf andere"),
  })[k] ?? k;

/** Keyboard: "n" focuses the quick entry, "/" the search (outside of input fields). */
function useListKeys(quick: RefObject<QuickAddHandle>, search: RefObject<HTMLInputElement>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "n") {
        e.preventDefault();
        quick.current?.focus();
      } else if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quick, search]);
}

/** Multi-select with shift-click ranges over the visible order. */
function useSelection(order: string[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const last = useRef<string | null>(null);
  const toggle = useCallback(
    (id: string, e: MouseEvent) => {
      setSel((cur) => {
        const next = new Set(cur);
        if (e.shiftKey && last.current && order.includes(last.current)) {
          const [i, j] = [order.indexOf(last.current), order.indexOf(id)].sort((x, y) => x - y);
          for (const x of order.slice(i!, j! + 1)) next.add(x);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      last.current = id;
    },
    [order],
  );
  // Forget selected tasks that are no longer visible
  useEffect(() => setSel((cur) => (cur.size && [...cur].some((x) => !order.includes(x)) ? new Set([...cur].filter((x) => order.includes(x))) : cur)), [order]);
  return { sel, toggle, clear: () => setSel(new Set()), setAll: (ids: string[]) => setSel(new Set(ids)) };
}

/** Bar for bulk changes to the selected tasks. */
function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const today = todayISO();
  async function apply(patch: Record<string, unknown>, label: string) {
    setBusy(true);
    try {
      await api.post("/api/tasks/bulk", { ids, patch });
      invalidateWork(qc);
      toast.success(label, { description: tr(`${ids.length} tasks`, `${ids.length} Aufgaben`) });
      onClear();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-white/90 hover:bg-white/10 disabled:opacity-50";
  return (
    <div className="fixed inset-x-3 bottom-[calc(80px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[880px] flex-wrap items-center gap-1 rounded-2xl bg-brand px-3 py-2 text-white shadow-pop lg:bottom-6 lg:left-[248px]" role="toolbar" aria-label={tr("Bulk actions", "Sammelaktionen")}>
      <span className="mr-1 text-[13px] font-bold">{tr(`${ids.length} selected`, `${ids.length} ausgewählt`)}</span>
      <button type="button" className={btn} disabled={busy} onClick={() => apply({ status: "erledigt" }, tr("Done", "Erledigt"))}>
        <Check className="h-4 w-4" /> {tr("Done", "Erledigt")}
      </button>
      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
      <CalendarDays className="h-4 w-4 text-white/70" aria-hidden />
      <button type="button" className={btn} disabled={busy} onClick={() => apply({ dueDate: today }, tr("Due today", "Heute fällig"))}>{tr("Today", "Heute")}</button>
      <button type="button" className={btn} disabled={busy} onClick={() => apply({ dueDate: addDays(today, 1) }, tr("Due tomorrow", "Morgen fällig"))}>{tr("Tomorrow", "Morgen")}</button>
      <button type="button" className={btn} disabled={busy} onClick={() => apply({ dueDate: nextMonday() }, tr("Moved to next week", "Auf nächste Woche verschoben"))}>{tr("Next week", "Nächste Woche")}</button>
      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
      <UserSelect className="w-[150px] [&_select]:h-8 [&_select]:bg-surface [&_select]:text-[13px] [&_select]:text-ink [&_svg]:text-muted" value={null} noneLabel={tr("Assign to …", "Zuweisen an …")} onChange={(v) => v && apply({ assigneeId: v }, tr("Reassigned", "Neu zugewiesen"))} />
      <TopicSelect className="w-[170px] [&_select]:h-8 [&_select]:bg-surface [&_select]:text-[13px] [&_select]:text-ink [&_svg]:text-muted" value={null} noneLabel={tr("Move to topic …", "Zu Thema …")} onChange={(v) => v && apply({ topicId: v }, tr("Filed under topic", "Thema zugeordnet"))} />
      <span className="flex-1" />
      <button type="button" className={btn} onClick={onClear} aria-label={tr("Clear selection", "Auswahl aufheben")}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MyTasks() {
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const quick = useRef<QuickAddHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  useListKeys(quick, search);
  const open = useTasks({ assignee: "me", status: "open", q: q || undefined });
  const done = useTasks({ assignee: "me", status: "done" });
  const created = useTasks({ status: "open" });
  const me = useMe().data?.user;
  const delegated = (created.data ?? []).filter((t) => t.createdBy === me?.id && t.assigneeId && t.assigneeId !== me?.id);
  const myTopics = useTopics({ owner: "me", state: "open" }).data ?? [];
  const { open: openOverlay } = useOverlays();

  const groups = useMemo(() => {
    const g: Record<string, Task[]> = { Overdue: [], Today: [], "This week": [], Later: [], "No date": [], Waiting: [] };
    for (const t of open.data ?? []) {
      if (t.status === "wartet") {
        g["Waiting"]!.push(t);
        continue;
      }
      const d = dueInfo(t.dueDate);
      if (d.tone === "none") g["No date"]!.push(t);
      else if (d.tone === "over") g["Overdue"]!.push(t);
      else if (d.tone === "today") g["Today"]!.push(t);
      else if ((d.days ?? 99) <= 7) g["This week"]!.push(t);
      else g["Later"]!.push(t);
    }
    return g;
  }, [open.data]);
  const order = useMemo(() => Object.values(groups).flat().map((t) => t.id), [groups]);
  const { sel, toggle, clear, setAll } = useSelection(order);
  const selectMode = sel.size > 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <QuickAdd ref={quick} />
        <div className="card px-4 pb-2">
          <div className="sticky top-14 z-10 -mx-4 flex items-center gap-2 rounded-t-2xl border-b border-line bg-surface px-4 py-2.5 lg:top-16">
            <Search className="h-4 w-4 text-muted" />
            <input ref={search} className="h-8 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70" placeholder={tr("Search my tasks  ( / )", "In meinen Aufgaben suchen  ( / )")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search", "Suchen")} />
            {order.length > 0 && (
              <button type="button" className="shrink-0 text-[12.5px] font-semibold text-muted hover:text-ink" onClick={() => (selectMode ? clear() : setAll(order))}>
                {selectMode ? tr("Clear selection", "Auswahl aufheben") : tr("Select all", "Alle auswählen")}
              </button>
            )}
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
                    <p className={cx("pt-3 text-[12.5px] font-semibold", label === "Overdue" ? "text-neg" : label === "Today" ? "text-accent-ink" : label === "Waiting" ? "text-accent-ink" : "text-muted")}>
                      {label === "Waiting" && <Hourglass className="mr-1 inline h-3.5 w-3.5 -translate-y-px" aria-hidden />}
                      {groupLabel(label)} <span className="num">{list.length}</span>
                    </p>
                    {list.map((t) => (
                      <TaskRow key={t.id} task={t} showAssignee={false} selected={sel.has(t.id)} onSelect={toggle} selectMode={selectMode} />
                    ))}
                  </div>
                ),
            )
          )}
          <button className="mt-2 flex w-full items-center gap-1.5 border-t border-line py-3 text-[13px] font-semibold text-muted" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            <ChevronDown className={cx("h-4 w-4 transition", showDone && "rotate-180")} />
            {tr("Done", "Erledigt")} <span className="num">{done.data?.length ?? 0}</span>
          </button>
          {showDone && (done.data ?? []).slice(0, 30).map((t) => <TaskRow key={t.id} task={t} showAssignee={false} quickActions={false} />)}
        </div>
        <p className="hidden px-1 text-[12px] text-muted lg:block">
          {tr("Shortcuts: ", "Tastenkürzel: ")}
          <b>n</b> {tr("new task", "neue Aufgabe")} · <b>/</b> {tr("search", "suchen")} · <b>⇧ {tr("click", "Klick")}</b> {tr("select several", "mehrere auswählen")}
        </p>
      </div>
      <aside className="space-y-4">
        {myTopics.length > 0 && (
          <div className="card px-4 py-3.5">
            <h2 className="section-title">{tr("My topics", "Meine Themen")}</h2>
            <ul className="mt-1">
              {myTopics.slice(0, 8).map((tp) => (
                <li key={tp.id}>
                  <button type="button" onClick={() => openOverlay({ kind: "topic", id: tp.id })} className="flex w-full items-center gap-2 border-b border-line py-2 text-left last:border-0">
                    <span className={cx("h-2 w-2 shrink-0 rounded-full", { idee: "bg-muted/50", geplant: "bg-brand/60", in_arbeit: "bg-info", wartet: "bg-accent", erledigt: "bg-pos", verworfen: "bg-muted/40" }[tp.stage])} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{tp.title}</span>
                    {tp.taskTotal > 0 && <span className="num shrink-0 text-[11.5px] text-muted">{tp.taskDone}/{tp.taskTotal}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="card px-4 py-3.5">
          <h2 className="section-title">{tr("Delegated by me", "Von mir delegiert")}</h2>
          <p className="text-[13px] text-muted">{tr("Open tasks you assigned to others.", "Offene Aufgaben, die du anderen zugewiesen hast.")}</p>
          {delegated.length === 0 ? (
            <p className="py-3 text-sm text-muted">{tr("Nothing open.", "Nichts offen.")}</p>
          ) : (
            delegated.slice(0, 12).map((t) => <TaskRow key={t.id} task={t} showContext={false} quickActions={false} />)
          )}
        </div>
      </aside>
      {selectMode && <BulkBar ids={[...sel]} onClear={clear} />}
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

const COLUMNS: { status: TaskStatus; readonly label: string; readonly hint: string }[] = [
  { status: "offen", get label() { return tr("Open", "Offen"); }, get hint() { return tr("Not started yet", "Noch nicht begonnen"); } },
  { status: "in_arbeit", get label() { return tr("In progress", "In Arbeit"); }, get hint() { return tr("Someone is on it", "Jemand ist dran"); } },
  { status: "wartet", get label() { return tr("Waiting", "Wartet"); }, get hint() { return tr("Waiting on someone else", "Wartet auf andere"); } },
  { status: "erledigt", get label() { return tr("Done", "Erledigt"); }, get hint() { return tr("Last 14 days", "Letzte 14 Tage"); } },
];

function Board() {
  const [params, setParams] = useSearchParams();
  const person = params.get("person") ?? "all";
  const topic = params.get("themenfilter") ?? "";
  const ms = params.get("meilenstein") ?? "";
  const prio = params.get("prio") ?? "";
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const tasks = useTasks({ status: "all", assignee: person, milestone: ms || undefined, topic: topic || undefined });
  const milestones = useMilestones().data;
  const { data: users } = useUsers();
  const update = useUpdateTask();
  const userMap = useUserMap();
  const me = useMe().data?.user;
  const { open } = useOverlays();
  const qc = useQueryClient();
  const quick = useRef<QuickAddHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  useListKeys(quick, search);
  const [q, setQ] = useState("");
  const [over, setOver] = useState<TaskStatus | null>(null);
  const dragging = useRef<string | null>(null);
  const recentDone = Date.now() - 14 * 86400_000;
  const needle = q.trim().toLowerCase();
  const list = (tasks.data ?? []).filter(
    (t) => (t.status !== "erledigt" || (t.completedAt ?? 0) > recentDone) && (!prio || t.priority === prio) && (!needle || t.title.toLowerCase().includes(needle) || (t.topicTitle ?? "").toLowerCase().includes(needle)),
  );

  function move(t: Task, status: TaskStatus) {
    if (t.status === status) return;
    update.mutate(
      { id: t.id, patch: { status } },
      {
        onSuccess: () => {
          if (status === "erledigt") toast.success(tr("Done", "Erledigt"), { description: t.title, action: { label: tr("Undo", "Rückgängig"), onClick: () => update.mutate({ id: t.id, patch: { status: t.status } }) } });
          if (status === "wartet" && !t.waitingOn) toast(tr("Waiting – on whom?", "Wartet – auf wen?"), { description: t.title, action: { label: tr("Add note", "Eintragen"), onClick: () => open({ kind: "task", id: t.id }) } });
        },
        onError: (err) => toast.error((err as Error).message),
        onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
      },
    );
  }

  function onDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/task") || e.dataTransfer.getData("text/plain") || dragging.current || "";
    dragging.current = null;
    const t = list.find((x) => x.id === id);
    if (t) move(t, status);
  }

  const filtered = person !== "all" || topic || ms || prio || needle;
  return (
    <div className="space-y-3">
      <QuickAdd
        ref={quick}
        defaults={{ topicId: topic || null, assigneeId: person === "me" ? me?.id : person !== "all" ? person : undefined }}
        placeholder={tr("Add a task to the board … (@person #topic !high tomorrow)", "Aufgabe aufs Board … (@Person #Thema !hoch morgen)")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-[170px]" value={person} onChange={(e) => set("person", e.target.value === "all" ? null : e.target.value)} aria-label="Person">
          <option value="all">{tr("Everyone", "Alle Personen")}</option>
          <option value="me">{tr("Only mine", "Nur meine")}</option>
          <option value="none">{tr("No owner", "Ohne Zuständigkeit")}</option>
          {(users ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <TopicSelect className="w-[200px]" value={topic || null} noneLabel={tr("All topics", "Alle Themen")} onChange={(v) => set("themenfilter", v)} />
        <Select className="w-[150px]" value={prio} onChange={(e) => set("prio", e.target.value || null)} aria-label={tr("Priority", "Priorität")}>
          <option value="">{tr("All priorities", "Alle Prioritäten")}</option>
          <option value="hoch">{PRIORITY.hoch?.label}</option>
          <option value="mittel">{PRIORITY.mittel?.label}</option>
          <option value="niedrig">{PRIORITY.niedrig?.label}</option>
        </Select>
        {(milestones ?? []).length > 0 && (
          <Select className="w-[200px]" value={ms} onChange={(e) => set("meilenstein", e.target.value || null)} aria-label={tr("Milestone", "Meilenstein")}>
            <option value="">{tr("All milestones", "Alle Meilensteine")}</option>
            {(milestones ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        )}
        <label className="flex h-10 min-w-[150px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 sm:max-w-[240px]">
          <Search className="h-4 w-4 text-muted" />
          <input ref={search} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70" placeholder={tr("Filter  ( / )", "Filtern  ( / )")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Filter tasks", "Aufgaben filtern")} />
        </label>
        {filtered && (
          <button type="button" className="text-[13px] font-semibold text-muted hover:text-ink" onClick={() => { setParams({ ansicht: "board" }, { replace: true }); setQ(""); }}>
            {tr("Reset filters", "Filter zurücksetzen")}
          </button>
        )}
      </div>
      <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-2.5 lg:overflow-visible lg:px-0">
        {COLUMNS.map((col) => {
          const items = list.filter((t) => t.status === col.status);
          const overdue = col.status !== "erledigt" ? items.filter((t) => dueInfo(t.dueDate).tone === "over").length : 0;
          return (
            <section
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === col.status ? null : o));
              }}
              onDrop={(e) => onDrop(e, col.status)}
              className={cx("flex w-[84vw] max-w-[340px] shrink-0 snap-start flex-col rounded-2xl bg-surface2/70 p-2 transition lg:w-auto lg:max-w-none", over === col.status && "ring-2 ring-info")}
            >
              <h2 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-sm font-bold" title={col.hint}>
                {col.status === "wartet" && <Hourglass className="h-3.5 w-3.5 text-accent-ink" aria-hidden />}
                {col.label} <span className="num text-[12px] font-medium text-muted">{items.length}</span>
                {overdue > 0 && <span className="num text-[11.5px] font-semibold text-neg">{tr(`${overdue} overdue`, `${overdue} überfällig`)}</span>}
              </h2>
              <div className="flex min-h-[140px] flex-col gap-2">
                {items.length === 0 && <p className="px-2 py-6 text-center text-[12.5px] text-muted/80">{col.hint}</p>}
                {items.map((t) => {
                  const u = t.assigneeId ? userMap.get(t.assigneeId) : undefined;
                  const d = dueInfo(t.dueDate, t.status === "erledigt");
                  const check = checklistStats(t.description);
                  return (
                    <article
                      key={t.id}
                      draggable
                      tabIndex={0}
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter") open({ kind: "task", id: t.id });
                        // Arrow keys move the card to the neighbouring column
                        const i = COLUMNS.findIndex((c) => c.status === t.status);
                        if (e.key === "ArrowRight" && i < COLUMNS.length - 1) move(t, COLUMNS[i + 1]!.status);
                        if (e.key === "ArrowLeft" && i > 0) move(t, COLUMNS[i - 1]!.status);
                      }}
                      aria-label={`${t.title}, ${col.label}. ${tr("Arrow keys move the card.", "Pfeiltasten verschieben die Karte.")}`}
                      className="group cursor-pointer rounded-xl border border-line bg-surface p-3 transition hover:border-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:scale-[.99]"
                    >
                      <div className="flex items-start gap-2">
                        <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY[t.priority]?.dot)} aria-label={tr(`Priority ${PRIORITY[t.priority]?.label}`, `Priorität ${PRIORITY[t.priority]?.label}`)} />
                        <p className={cx("min-w-0 flex-1 text-[14px] font-semibold leading-snug", t.status === "erledigt" && "text-muted line-through")}><Tx text={t.title} /></p>
                        {t.status !== "erledigt" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              move(t, "erledigt");
                            }}
                            className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted opacity-0 transition hover:bg-pos-soft hover:text-pos focus:opacity-100 group-hover:opacity-100"
                            aria-label={tr(`Mark "${t.title}" as done`, `„${t.title}“ erledigen`)}
                            title={tr("Done", "Erledigt")}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {t.status === "wartet" && t.waitingOn && (
                        <p className="mt-1.5 truncate rounded-md bg-accent-soft px-1.5 py-0.5 text-[12px] font-semibold text-accent-ink">
                          {tr("Waiting on ", "Wartet auf ")}<Tx text={t.waitingOn} />
                        </p>
                      )}
                      {t.topicTitle && (
                        <div className="mt-1.5">
                          <TopicChip task={t} className="max-w-full" />
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                        {t.dueDate && <span className={cx(d.tone === "over" && "font-semibold text-neg", d.tone === "today" && "font-semibold text-accent-ink")}>{d.label}</span>}
                        {check.total > 0 && (
                          <span className={cx("inline-flex items-center gap-0.5", check.done === check.total && "text-pos")}>
                            <ListChecks className="h-3 w-3" aria-hidden />
                            <span className="num">{check.done}/{check.total}</span>
                          </span>
                        )}
                        {t.commentCount > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <MessageSquare className="h-3 w-3" aria-hidden />
                            <span className="num">{t.commentCount}</span>
                          </span>
                        )}
                        {t.milestoneTitle && <span className="min-w-0 flex-1 truncate"><Tx text={t.milestoneTitle} /></span>}
                        <span className="flex-1" />
                        {u && <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={22} />}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 lg:hidden" onClick={(e) => e.stopPropagation()}>
                        {COLUMNS.filter((c) => c.status !== t.status).map((c) => (
                          <button key={c.status} className="h-7 rounded-full border border-line px-2.5 text-[11.5px] font-semibold text-muted" onClick={() => move(t, c.status)}>
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
      <p className="hidden px-1 text-[12px] text-muted lg:block">
        {tr("Drag cards between columns – or focus a card and use ← →. ", "Karten zwischen Spalten ziehen – oder Karte auswählen und ← → drücken. ")}
        <b>n</b> {tr("new task", "neue Aufgabe")} · <b>/</b> {tr("filter", "filtern")}
      </p>
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
