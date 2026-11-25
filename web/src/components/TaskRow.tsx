import { Building2, CalendarDays, Flag, Hash, Hourglass, ListChecks, Mail, MessageSquare, Play, UserRound } from "lucide-react";
import type { MouseEvent } from "react";
import { toast } from "sonner";
import { checklistStats } from "@/lib/checklist";
import { addDays, dueInfo, todayISO } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useUpdateTask, useUserMap } from "@/lib/queries";
import type { Task } from "@/lib/types";
import { Avatar, cx, TaskCheck } from "./ui";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

const DUE_TONE: Record<string, string> = {
  over: "text-neg font-semibold",
  today: "text-accent-ink font-semibold",
  soon: "text-ink",
  later: "text-muted",
  none: "text-muted",
};

export function useToggleTask() {
  const update = useUpdateTask();
  return (t: Task) => {
    const next = t.status === "erledigt" ? "offen" : "erledigt";
    update.mutate(
      { id: t.id, patch: { status: next } },
      {
        onSuccess: () => {
          if (next === "erledigt")
            toast.success(tr("Done", "Erledigt"), {
              description: t.title,
              action: { label: tr("Undo", "Rückgängig"), onClick: () => update.mutate({ id: t.id, patch: { status: t.status } }) },
            });
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };
}

export function nextMonday() {
  const d = new Date();
  const diff = ((8 - d.getDay()) % 7) || 7;
  return addDays(todayISO(), diff);
}

/** Small chip with the topic of a task (colour by internal/external). */
export function TopicChip({ task, className }: { task: Pick<Task, "topicTitle" | "topicKind">; className?: string }) {
  if (!task.topicTitle) return null;
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-0.5 rounded-md px-1.5 py-px text-[11.5px] font-semibold", task.topicKind === "extern" ? "bg-info-soft text-info" : "bg-surface2 text-brand", className)}>
      <Hash className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">
        <Tx text={task.topicTitle} />
      </span>
    </span>
  );
}

export function TaskRow({
  task,
  showAssignee = true,
  showContext = true,
  selected,
  onSelect,
  selectMode,
  quickActions = true,
}: {
  task: Task;
  showAssignee?: boolean;
  showContext?: boolean;
  /** Multi-select: checkbox state and handler (shift-click selects a range) */
  selected?: boolean;
  onSelect?: (id: string, e: MouseEvent) => void;
  /** Selection is active somewhere in the list: show the checkboxes permanently */
  selectMode?: boolean;
  quickActions?: boolean;
}) {
  const users = useUserMap();
  const { open } = useOverlays();
  const toggle = useToggleTask();
  const update = useUpdateTask();
  const done = task.status === "erledigt";
  const due = dueInfo(task.dueDate, done);
  const assignee = task.assigneeId ? users.get(task.assigneeId) : undefined;
  const check = checklistStats(task.description);
  const today = todayISO();
  const setDue = (v: string) =>
    update.mutate({ id: task.id, patch: { dueDate: v } }, { onSuccess: () => toast(tr("Rescheduled", "Verschoben"), { description: `${task.title} → ${dueInfo(v).label}` }) });
  const quick = !done && quickActions
    ? [
        { key: "today", label: tr("Today", "Heute"), hidden: task.dueDate === today, run: () => setDue(today) },
        { key: "tomorrow", label: tr("Tomorrow", "Morgen"), hidden: task.dueDate === addDays(today, 1), run: () => setDue(addDays(today, 1)) },
        { key: "week", label: tr("Next week", "Nächste Woche"), hidden: task.dueDate === nextMonday(), run: () => setDue(nextMonday()) },
      ].filter((q) => !q.hidden)
    : [];
  return (
    // The whole row is clickable by mouse/touch; for keyboard and screen readers the title is the one button
    // (no nested interactive elements).
    <div
      onClick={(e) => {
        if (onSelect && (selectMode || e.shiftKey || e.metaKey || e.ctrlKey)) {
          onSelect(task.id, e);
          return;
        }
        open({ kind: "task", id: task.id });
      }}
      className={cx("group relative flex w-full cursor-pointer items-start gap-3 border-b border-line py-3 text-left last:border-b-0", selected && "-mx-2 rounded-lg bg-info-soft/60 px-2")}
    >
      {onSelect && (
        <label
          onClick={(e) => e.stopPropagation()}
          className={cx("grid h-6 w-5 shrink-0 cursor-pointer place-items-center transition", selectMode || selected ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100")}
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#05224B]"
            checked={!!selected}
            onChange={() => undefined}
            onClick={(e) => onSelect(task.id, e)}
            aria-label={tr(`Select "${task.title}"`, `„${task.title}“ auswählen`)}
          />
        </label>
      )}
      <div className="pt-px">
        <TaskCheck done={done} onToggle={() => toggle(task)} priority={task.priority} label={done ? tr(`Reopen "${task.title}"`, `„${task.title}“ wieder öffnen`) : tr(`Mark "${task.title}" as done`, `„${task.title}“ erledigen`)} />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onSelect && (selectMode || e.shiftKey || e.metaKey || e.ctrlKey)) onSelect(task.id, e);
            else open({ kind: "task", id: task.id });
          }}
          className={cx(
            "block max-w-full rounded text-left text-[15px] font-semibold leading-snug transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
            done && "text-muted line-through decoration-muted/60",
          )}
        >
          <Tx text={task.title} />
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          {task.dueDate && <span className={cx(DUE_TONE[due.tone])}>{due.label}</span>}
          {task.status === "in_arbeit" && <span className="font-semibold text-info">{tr("In progress", "In Arbeit")}</span>}
          {task.status === "wartet" && (
            <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-accent-ink">
              <Hourglass className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{task.waitingOn ? <>{tr("Waiting on ", "Wartet auf ")}<Tx text={task.waitingOn} /></> : tr("Waiting", "Wartet")}</span>
            </span>
          )}
          {showContext && <TopicChip task={task} className="max-w-[220px]" />}
          {showContext && task.milestoneTitle && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Flag className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate"><Tx text={task.milestoneTitle} /></span>
            </span>
          )}
          {showContext && task.organizationName && !task.contactName && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{task.organizationName}</span>
            </span>
          )}
          {showContext && task.contactName && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <UserRound className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{task.contactName}</span>
            </span>
          )}
          {check.total > 0 && (
            <span className={cx("inline-flex items-center gap-1", check.done === check.total && "text-pos")} aria-label={tr(`Checklist ${check.done} of ${check.total}`, `Checkliste ${check.done} von ${check.total}`)}>
              <ListChecks className="h-3 w-3" aria-hidden />
              <span className="num">{check.done}/{check.total}</span>
            </span>
          )}
          {task.sourceMail && <Mail className="h-3 w-3" aria-label={tr("Created from an e-mail", "Aus einer E-Mail erstellt")} />}
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" aria-hidden />
              <span className="num">{task.commentCount}</span>
            </span>
          )}
        </div>
      </div>
      {quick.length > 0 && !selectMode && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-none absolute right-0 top-2 hidden items-center gap-1 rounded-lg bg-surface/95 p-0.5 opacity-0 shadow-sm ring-1 ring-line transition group-hover:pointer-events-auto group-hover:opacity-100 lg:flex"
        >
          <CalendarDays className="ml-1 h-3.5 w-3.5 text-muted" aria-hidden />
          {quick.map((q) => (
            <button key={q.key} type="button" onClick={q.run} className="h-7 rounded-md px-2 text-[12px] font-semibold text-muted hover:bg-surface2 hover:text-ink">
              {q.label}
            </button>
          ))}
          {task.status !== "in_arbeit" ? (
            <button type="button" onClick={() => update.mutate({ id: task.id, patch: { status: "in_arbeit" } })} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface2 hover:text-info" title={tr("Start", "Starten")} aria-label={tr("Start", "Starten")}>
              <Play className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button type="button" onClick={() => update.mutate({ id: task.id, patch: { status: "wartet" } })} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface2 hover:text-accent-ink" title={tr("Waiting on someone", "Wartet auf andere")} aria-label={tr("Waiting on someone", "Wartet auf andere")}>
              <Hourglass className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      {showAssignee && (assignee ? <Avatar name={assignee.name} color={assignee.avatarColor} src={assignee.avatarUrl} size={26} /> : <span className="h-[26px] w-[26px]" />)}
    </div>
  );
}
