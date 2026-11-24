import { ArrowLeft, Diamond, Pencil, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, Pill, Progress, Skeleton } from "@/components/ui";
import { countdown, dateLong, dueInfo, MILESTONE_STATUS } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useMilestone, useUserMap } from "@/lib/queries";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

export function MilestoneDetailPage() {
  const { id } = useParams();
  const { data: m, isLoading, error } = useMilestone(id);
  const users = useUserMap();
  const { open } = useOverlays();
  if (isLoading) return <Skeleton className="h-72" />;
  if (error || !m) return <EmptyState title={tr("Milestone not found", "Meilenstein nicht gefunden")} text={(error as Error)?.message} action={<Link to="/aufgaben?ansicht=meilensteine" className="link">{tr("Back to overview", "Zur Übersicht")}</Link>} />;
  const owner = m.ownerId ? users.get(m.ownerId) : undefined;
  const d = dueInfo(m.dueDate);
  const openTasks = m.tasks.filter((t) => t.status !== "erledigt");
  const done = m.tasks.filter((t) => t.status === "erledigt");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/aufgaben?ansicht=meilensteine" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {tr("Milestones", "Meilensteine")}
      </Link>
      <header className="card p-5">
        <div className="flex items-start gap-3">
          <Diamond className={cx("mt-1.5 h-5 w-5 shrink-0", m.status === "erreicht" ? "fill-pos text-pos" : "fill-accent text-accent")} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-extrabold leading-tight tracking-[-0.02em]"><Tx text={m.title} /></h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill className={MILESTONE_STATUS[m.status]?.tone}>{MILESTONE_STATUS[m.status]?.label}</Pill>
              {m.area && <Pill>{m.area}</Pill>}
            </div>
          </div>
          <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => open({ kind: "milestone", id: m.id })}>
            {tr("Edit", "Bearbeiten")}
          </Button>
        </div>
        <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[12.5px] font-semibold text-muted">{tr("Owner", "Verantwortlich")}</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm font-semibold">
              {owner ? (
                <>
                  <Avatar name={owner.name} color={owner.avatarColor} src={owner.avatarUrl} size={24} /> {owner.name}
                </>
              ) : (
                tr("No one", "Niemand")
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] font-semibold text-muted">{tr("Target date", "Zieldatum")}</dt>
            <dd className="mt-1 text-sm font-semibold">
              {m.dueDate ? dateLong(m.dueDate) : tr("Not set", "Offen")}
              {m.dueDate && m.status !== "erreicht" && (
                <span className={cx("block text-[12.5px]", d.tone === "over" ? "text-neg" : d.tone === "soon" || d.tone === "today" ? "text-accent-ink" : "font-normal text-muted")}>{countdown(m.dueDate)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] font-semibold text-muted">{tr("Progress", "Fortschritt")}</dt>
            <dd className="mt-1.5">
              <Progress label={`${tr("Progress", "Fortschritt")}: ${m.title}`} value={m.progress} tone={m.progress >= 1 ? "pos" : "brand"} />
              <span className="num mt-1 block text-[12.5px] text-muted">
                {tr(`${m.taskDone} of ${m.taskTotal} ${m.taskTotal === 1 ? "task" : "tasks"} done`, `${m.taskDone} von ${m.taskTotal} ${m.taskTotal === 1 ? "Aufgabe" : "Aufgaben"} erledigt`)}
              </span>
            </dd>
          </div>
        </dl>
        {m.description && <p className="mt-5 whitespace-pre-wrap border-t border-line pt-4 text-[15px] leading-relaxed"><Tx text={m.description} /></p>}
      </header>
      <section className="card px-4 pb-2 pt-3.5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{tr("Tasks", "Aufgaben")}</h2>
          <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "task", defaults: { milestoneId: m.id } })}>
            {tr("Task", "Aufgabe")}
          </Button>
        </div>
        {m.tasks.length === 0 ? (
          <EmptyState title={tr("No tasks yet", "Noch keine Aufgaben")} text={tr("Break the milestone down into concrete steps, each with an owner.", "Zerlege den Meilenstein in konkrete Schritte mit Zuständigkeit.")} />
        ) : (
          <>
            {openTasks.map((t) => (
              <TaskRow key={t.id} task={t} showContext={false} />
            ))}
            {done.length > 0 && <p className="pt-3 text-[12.5px] font-semibold text-muted">{tr("Done", "Erledigt")}</p>}
            {done.map((t) => (
              <TaskRow key={t.id} task={t} showContext={false} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}
