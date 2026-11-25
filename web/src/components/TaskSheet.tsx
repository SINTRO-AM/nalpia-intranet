import { useQueryClient } from "@tanstack/react-query";
import { Building2, Hash, Hourglass, ListChecks, Mail, Pencil, Send, Trash2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { orgHref, relTime } from "@/lib/format";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { invalidateWork, useMe, useTask, useUpdateTask, useUserMap } from "@/lib/queries";
import type { Task, TaskStatus } from "@/lib/types";
import { bulletsToChecklist, checklistStats, toggleChecklistLine } from "@/lib/checklist";
import { Timeline } from "./History";
import { Markdown } from "./Markdown";
import { ContactSelect, DueDateField, MilestoneSelect, OrgSelect, PriorityPicker, TopicSelect, UserSelect } from "./pickers";
import { Sheet } from "./Sheet";
import { Button, cx, Field, Segmented, Skeleton } from "./ui";
import { tr } from "@/lib/i18n";
import { Tx, TxNote } from "@/lib/translate";

export function TaskSheet() {
  const o = useOverlay("task");
  const { close } = useOverlays();
  const isOpen = !!o;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => !v && close("task")} title={o?.id ? tr("Task", "Aufgabe") : tr("New task", "Neue Aufgabe")} size="md">
      {o && (o.id ? <EditTask key={o.id} id={o.id} /> : <CreateTask defaults={o.defaults} />)}
    </Sheet>
  );
}


function CreateTask({ defaults }: { defaults?: Partial<Task> }) {
  const qc = useQueryClient();
  const { close } = useOverlays();
  const me = useMe().data?.user;
  const [f, setF] = useState({
    title: defaults?.title ?? "",
    description: defaults?.description ?? "",
    assigneeId: defaults?.assigneeId === undefined ? (me?.id ?? null) : defaults.assigneeId,
    dueDate: defaults?.dueDate ?? null,
    priority: defaults?.priority ?? "mittel",
    milestoneId: defaults?.milestoneId ?? null,
    topicId: defaults?.topicId ?? null,
    contactId: defaults?.contactId ?? null,
    organizationId: defaults?.organizationId ?? null,
    sourceMail: defaults?.sourceMail ?? null,
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr({});
    try {
      const { sourceMail, ...rest } = f;
      await api.post<Task>("/api/tasks", {
        ...rest,
        sourceMail: sourceMail ? { messageId: sourceMail.messageId, folderId: sourceMail.folderId, subject: sourceMail.subject, from: sourceMail.from } : undefined,
      });
      invalidateWork(qc);
      toast.success(tr("Task created", "Aufgabe angelegt"), { description: f.title });
      close("task");
    } catch (e) {
      if (e instanceof ApiError) setErr(e.fields.title ? e.fields : { _: e.message });
      else setErr({ _: tr("Couldn't save. Please try again.", "Speichern fehlgeschlagen.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field error={err.title}>
        <input
          autoFocus
          className="field text-[17px] font-semibold"
          placeholder={tr("What needs to be done?", "Was ist zu tun?")}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          aria-label={tr("Title", "Titel")}
          maxLength={200}
        />
      </Field>
      {f.sourceMail && (
        <p className="flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2 text-[13px] text-muted">
          <Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{tr("From e-mail:", "Aus E-Mail:")} {f.sourceMail.subject}</span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Owner", "Zuständig")} htmlFor="t-assignee">
          <UserSelect id="t-assignee" value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} />
        </Field>
        <Field label={tr("Priority", "Priorität")}>
          <PriorityPicker value={f.priority} onChange={(v) => setF({ ...f, priority: v })} />
        </Field>
      </div>
      <Field label={tr("Due date", "Fällig am")} htmlFor="t-due">
        <DueDateField id="t-due" value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Topic", "Thema")} htmlFor="t-topic">
          <TopicSelect id="t-topic" value={f.topicId} onChange={(v) => setF({ ...f, topicId: v })} />
        </Field>
        <Field label={tr("Milestone", "Meilenstein")} htmlFor="t-ms">
          <MilestoneSelect id="t-ms" value={f.milestoneId} onChange={(v) => setF({ ...f, milestoneId: v })} />
        </Field>
        <Field label={tr("Contact", "Kontakt")}>
          <ContactSelect value={f.contactId} onChange={(v) => setF({ ...f, contactId: v })} />
        </Field>
        <Field label={tr("Client / investor", "Kunde / Investor")} htmlFor="t-org">
          <OrgSelect id="t-org" value={f.organizationId} onChange={(v) => setF({ ...f, organizationId: v })} />
        </Field>
      </div>
      <Field label={tr("Description", "Beschreibung")} htmlFor="t-desc">
        <textarea id="t-desc" className="field min-h-[96px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={tr("Details, links, context …", "Details, Links, Kontext …")} />
      </Field>
      {err._ && <p className="text-sm font-medium text-neg">{err._}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => close("task")}>
          {tr("Cancel", "Abbrechen")}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!f.title.trim()}>
          {tr("Create task", "Aufgabe anlegen")}
        </Button>
      </div>
    </form>
  );
}

function EditTask({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { close, open } = useOverlays();
  const { data: t, isLoading, error } = useTask(id);
  const me = useMe().data?.user;
  const users = useUserMap();
  const update = useUpdateTask();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [comment, setComment] = useState("");
  const [waiting, setWaiting] = useState("");
  const [editDesc, setEditDesc] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (t && !loaded.current) {
      setTitle(t.title);
      setDesc(t.description);
      setWaiting(t.waitingOn);
      setEditDesc(!t.description.trim());
      loaded.current = true;
    }
  }, [t]);

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-24" /><Skeleton className="h-10" /></div>;
  if (error || !t) return <p className="text-sm text-neg">{(error as Error)?.message ?? tr("Not found.", "Nicht gefunden.")}</p>;

  const save = (patch: Partial<Task>) =>
    update.mutate(
      { id, patch },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: ["task", id] }),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  const canDelete = me && (me.role === "admin" || t.createdBy === me.id || t.assigneeId === me.id);
  const creator = t.createdBy ? users.get(t.createdBy) : undefined;
  const check = checklistStats(desc);
  const hasBullets = /^\s*[-*+]\s+(?!\[)/m.test(desc);

  function toggleLine(line: number) {
    const next = toggleChecklistLine(desc, line);
    if (next === desc) return;
    setDesc(next);
    save({ description: next });
  }

  async function deleteComment(cid: string) {
    try {
      await api.del(`/api/tasks/${id}/comments/${cid}`);
      qc.invalidateQueries({ queryKey: ["task", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addComment() {
    if (!comment.trim()) return;
    try {
      await api.post(`/api/tasks/${id}/comments`, { body: comment.trim() });
      setComment("");
      qc.invalidateQueries({ queryKey: ["task", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove() {
    try {
      await api.del(`/api/tasks/${id}`);
      invalidateWork(qc);
      toast(tr("Task deleted", "Aufgabe gelöscht"));
      close("task");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <textarea
          rows={1}
          className="field min-h-0 resize-none text-[18px] font-bold leading-snug"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== t.title && save({ title: title.trim() })}
          aria-label={tr("Title", "Titel")}
          maxLength={200}
        />
        <TxNote text={t.title} />
        <p className="mt-1.5 text-[12.5px] text-muted">
          {creator ? tr(`Created by ${creator.name}, `, `Angelegt von ${creator.name}, `) : ""}
          {relTime(t.createdAt)}
        </p>
      </div>
      <Segmented<TaskStatus>
        value={t.status}
        onChange={(v) => save({ status: v })}
        options={[
          { value: "offen", label: tr("Open", "Offen") },
          { value: "in_arbeit", label: tr("In progress", "In Arbeit") },
          { value: "wartet", label: tr("Waiting", "Wartet") },
          { value: "erledigt", label: tr("Done", "Erledigt") },
        ]}
        className="w-full [&>button]:flex-1 [&>button]:justify-center"
      />
      {t.status === "wartet" && (
        <Field label={tr("Waiting on", "Wartet auf")} htmlFor="e-waiting" hint={tr("Who has the ball? E.g. “Reply from IBB”, “Carlo's review”.", "Wer ist am Zug? Z. B. „Rückmeldung der IBB“, „Review von Carlo“.")}>
          <div className="relative">
            <Hourglass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent-ink" aria-hidden />
            <input
              id="e-waiting"
              className="field pl-9"
              value={waiting}
              maxLength={300}
              onChange={(e) => setWaiting(e.target.value)}
              onBlur={() => waiting !== t.waitingOn && save({ waitingOn: waiting.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder={tr("Who or what are we waiting for?", "Auf wen oder was warten wir?")}
            />
          </div>
        </Field>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Owner", "Zuständig")} htmlFor="e-assignee">
          <UserSelect id="e-assignee" value={t.assigneeId} onChange={(v) => save({ assigneeId: v })} />
        </Field>
        <Field label={tr("Priority", "Priorität")}>
          <PriorityPicker value={t.priority} onChange={(v) => save({ priority: v })} />
        </Field>
      </div>
      <Field label={tr("Due date", "Fällig am")} htmlFor="e-due">
        <DueDateField id="e-due" value={t.dueDate} onChange={(v) => save({ dueDate: v })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Topic", "Thema")} htmlFor="e-topic">
          <TopicSelect id="e-topic" value={t.topicId} onChange={(v) => save({ topicId: v })} />
        </Field>
        <Field label={tr("Milestone", "Meilenstein")} htmlFor="e-ms">
          <MilestoneSelect id="e-ms" value={t.milestoneId} onChange={(v) => save({ milestoneId: v })} />
        </Field>
        <Field label={tr("Contact", "Kontakt")}>
          <ContactSelect value={t.contactId} onChange={(v) => save({ contactId: v })} />
        </Field>
        <Field label={tr("Client / investor", "Kunde / Investor")} htmlFor="e-org">
          <OrgSelect id="e-org" value={t.organizationId} onChange={(v) => save({ organizationId: v })} />
        </Field>
      </div>
      {t.topicId && (
        <button type="button" onClick={() => open({ kind: "topic", id: t.topicId! })} className="flex items-center gap-2 text-sm font-semibold text-info">
          <Hash className="h-4 w-4" /> {tr("Open topic:", "Thema öffnen:")} <Tx text={t.topicTitle} />
        </button>
      )}
      {t.contactId && (
        <Link to={`/kontakte/${t.contactId}`} onClick={() => close("task")} className="flex items-center gap-2 text-sm font-semibold text-info">
          <UserRound className="h-4 w-4" /> {tr("Open contact:", "Kontakt öffnen:")} {t.contactName}
        </Link>
      )}
      {t.organizationId && (
        <Link
          to={orgHref(t.organizationKind, t.organizationId)}
          onClick={() => close("task")}
          className="flex items-center gap-2 text-sm font-semibold text-info"
        >
          <Building2 className="h-4 w-4" />{" "}
          {t.organizationKind === "investor" ? tr("Open investor:", "Investor öffnen:") : tr("Open partner:", "Partner öffnen:")} {t.organizationName}
        </Link>
      )}
      {t.sourceMail && (
        <div className="flex items-center gap-2 rounded-xl bg-surface2 px-3 py-2.5 text-[13px]">
          <Mail className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-muted">
            {tr(`From e-mail by ${t.sourceMail.from}:`, `Aus E-Mail von ${t.sourceMail.from}:`)} {t.sourceMail.subject}
          </span>
          {t.sourceMail.ownerId === me?.id && (
            <button
              className="link shrink-0"
              onClick={() => {
                close("task");
                navigate(`/postfach?f=${t.sourceMail!.folderId}&m=${t.sourceMail!.messageId}`);
              }}
            >
              {tr("Open", "Öffnen")}
            </button>
          )}
        </div>
      )}
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="label mb-0">{tr("Description", "Beschreibung")}</h3>
          {check.total > 0 && (
            <span className={cx("inline-flex items-center gap-1 text-[12px] font-semibold", check.done === check.total ? "text-pos" : "text-muted")}>
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
              <span className="num">{check.done}/{check.total}</span>
            </span>
          )}
          <span className="flex-1" />
          {!editDesc && hasBullets && check.total === 0 && (
            <button type="button" className="text-[12.5px] font-semibold text-info" onClick={() => {
              const next = bulletsToChecklist(desc);
              setDesc(next);
              save({ description: next });
            }}>
              {tr("Make checklist", "Als Checkliste")}
            </button>
          )}
          {!editDesc && (
            <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink" onClick={() => setEditDesc(true)}>
              <Pencil className="h-3.5 w-3.5" /> {tr("Edit", "Bearbeiten")}
            </button>
          )}
        </div>
        {editDesc ? (
          <>
            <textarea
              id="e-desc"
              autoFocus={!!t.description}
              className="field min-h-[120px] font-[inherit]"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={() => {
                if (desc !== t.description) save({ description: desc });
                if (desc.trim()) setEditDesc(false);
              }}
              placeholder={tr("Details, links, context … Checklists: “- [ ] step”", "Details, Links, Kontext … Checklisten: „- [ ] Schritt“")}
              aria-label={tr("Description", "Beschreibung")}
            />
            <p className="mt-1 text-[12px] text-muted">{tr("Markdown works: **bold**, lists, links, “- [ ]” for checklists.", "Markdown geht: **fett**, Listen, Links, „- [ ]“ für Checklisten.")}</p>
          </>
        ) : (
          <div className="rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-line" onDoubleClick={() => setEditDesc(true)}>
            <Markdown className="text-[14px]" onToggleCheck={toggleLine}>
              {desc}
            </Markdown>
          </div>
        )}
        <TxNote text={t.description} />
      </div>

      <div>
        <h3 className="label">{tr("History & comments", "Verlauf & Kommentare")}</h3>
        <div className="space-y-3">
          <Timeline comments={t.comments} events={t.events ?? []} onDeleteComment={deleteComment} />
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              className="field min-h-[42px] flex-1 resize-none"
              placeholder={tr("Write a comment …", "Kommentar schreiben …")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addComment();
              }}
            />
            <Button variant="primary" size="md" icon={<Send className="h-4 w-4" />} onClick={addComment} disabled={!comment.trim()} aria-label={tr("Send comment", "Kommentar senden")} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
        {canDelete ? (
          confirmDel ? (
            <div className="flex items-center gap-2">
              <Button variant="danger" size="sm" onClick={remove}>
                {tr("Delete permanently", "Endgültig löschen")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>
                {tr("Cancel", "Abbrechen")}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDel(true)} className="text-neg">
              {tr("Delete", "Löschen")}
            </Button>
          )
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={() => close("task")}>
          {tr("Done", "Fertig")}
        </Button>
      </div>
    </div>
  );
}
