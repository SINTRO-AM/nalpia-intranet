import { Building2, Flag, Mail, MessageSquare, UserRound } from "lucide-react";
import { toast } from "sonner";
import { dueInfo } from "@/lib/format";
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

export function TaskRow({ task, showAssignee = true, showContext = true }: { task: Task; showAssignee?: boolean; showContext?: boolean }) {
  const users = useUserMap();
  const { open } = useOverlays();
  const toggle = useToggleTask();
  const done = task.status === "erledigt";
  const due = dueInfo(task.dueDate, done);
  const assignee = task.assigneeId ? users.get(task.assigneeId) : undefined;
  return (
    // The whole row is clickable by mouse/touch; for keyboard and screen readers the title is the one button
    // (no nested interactive elements).
    <div onClick={() => open({ kind: "task", id: task.id })} className="group flex w-full cursor-pointer items-start gap-3 border-b border-line py-3 text-left last:border-b-0">
      <div className="pt-px">
        <TaskCheck done={done} onToggle={() => toggle(task)} priority={task.priority} label={done ? tr(`Reopen "${task.title}"`, `„${task.title}“ wieder öffnen`) : tr(`Mark "${task.title}" as done`, `„${task.title}“ erledigen`)} />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open({ kind: "task", id: task.id });
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
          {task.sourceMail && <Mail className="h-3 w-3" aria-label={tr("Created from an e-mail", "Aus einer E-Mail erstellt")} />}
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" aria-hidden />
              <span className="num">{task.commentCount}</span>
            </span>
          )}
        </div>
      </div>
      {showAssignee && (assignee ? <Avatar name={assignee.name} color={assignee.avatarColor} src={assignee.avatarUrl} size={26} /> : <span className="h-[26px] w-[26px]" />)}
    </div>
  );
}
