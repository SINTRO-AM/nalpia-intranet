import { useQueryClient } from "@tanstack/react-query";
import { Building2, Hourglass, Pencil, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { daysSince, orgHref, relTime, TOPIC_AREAS, TOPIC_STAGE, TOPIC_STAGES } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { useMe, useTopic, useTopicAreas, useUpdateTopic, useUserMap } from "@/lib/queries";
import { TxNote } from "@/lib/translate";
import type { Topic, TopicKind, TopicStage } from "@/lib/types";
import { Timeline } from "./History";
import { Markdown } from "./Markdown";
import { DueDateField, OrgSelect, UserSelect } from "./pickers";
import { QuickAdd } from "./QuickAdd";
import { Sheet } from "./Sheet";
import { TaskRow } from "./TaskRow";
import { Button, cx, Field, Progress, Segmented, Skeleton } from "./ui";

export function TopicSheet() {
  const o = useOverlay("topic");
  const { close } = useOverlays();
  return (
    <Sheet open={!!o} onOpenChange={(v) => !v && close("topic")} title={o?.id ? tr("Topic", "Thema") : tr("New topic", "Neues Thema")} size="lg">
      {o && (o.id ? <EditTopic key={o.id} id={o.id} /> : <CreateTopic defaults={o.defaults} />)}
    </Sheet>
  );
}

function AreaInput({ id, value, onChange, onCommit }: { id: string; value: string; onChange: (v: string) => void; onCommit?: () => void }) {
  const used = useTopicAreas().data ?? [];
  const options = [...new Set([...used, ...TOPIC_AREAS])];
  return (
    <>
      <input
        id={id}
        list={`${id}-list`}
        className="field"
        value={value}
        maxLength={60}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        placeholder={tr("e.g. Funding, Product", "z. B. Förderung, Produkt")}
      />
      <datalist id={`${id}-list`}>
        {options.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </>
  );
}

function KindToggle({ value, onChange }: { value: TopicKind; onChange: (v: TopicKind) => void }) {
  return (
    <Segmented<TopicKind>
      value={value}
      onChange={onChange}
      options={[
        { value: "intern", label: tr("Internal", "Intern") },
        { value: "extern", label: tr("External", "Extern") },
      ]}
      className="w-full [&>button]:flex-1 [&>button]:justify-center"
    />
  );
}

function CreateTopic({ defaults }: { defaults?: Partial<Topic> }) {
  const qc = useQueryClient();
  const { close, open } = useOverlays();
  const me = useMe().data?.user;
  const [f, setF] = useState({
    title: defaults?.title ?? "",
    kind: (defaults?.kind ?? "intern") as TopicKind,
    stage: (defaults?.stage ?? "geplant") as TopicStage,
    area: defaults?.area ?? "",
    ownerId: defaults?.ownerId === undefined ? (me?.id ?? null) : defaults.ownerId,
    counterpart: defaults?.counterpart ?? "",
    organizationId: defaults?.organizationId ?? null,
    dueDate: defaults?.dueDate ?? null,
    followUp: defaults?.followUp ?? null,
    description: defaults?.description ?? "",
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr({});
    try {
      const t = await api.post<Topic>("/api/topics", { ...f, counterpart: f.kind === "extern" ? f.counterpart : "", organizationId: f.kind === "extern" ? f.organizationId : null });
      qc.invalidateQueries({ queryKey: ["topics"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      toast.success(tr("Topic created", "Thema angelegt"), { description: t.title });
      close("topic");
      open({ kind: "topic", id: t.id });
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
          placeholder={tr("What is it about? E.g. “EXIST application”, “Upvest integration”", "Worum geht es? Z. B. „EXIST-Antrag“, „Upvest-Anbindung“")}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          aria-label={tr("Title", "Titel")}
          maxLength={200}
        />
      </Field>
      <KindToggle value={f.kind} onChange={(kind) => setF({ ...f, kind })} />
      {f.kind === "extern" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Counterpart", "Gegenüber")} htmlFor="tp-cp" hint={tr("Authority, partner, university …", "Behörde, Partner, Hochschule …")}>
            <input id="tp-cp" className="field" value={f.counterpart} maxLength={160} onChange={(e) => setF({ ...f, counterpart: e.target.value })} placeholder={tr("e.g. IBB, Projektträger Jülich", "z. B. IBB, Projektträger Jülich")} />
          </Field>
          <Field label={tr("Organization in the CRM", "Institution im CRM")} htmlFor="tp-org">
            <OrgSelect id="tp-org" value={f.organizationId} onChange={(v) => setF({ ...f, organizationId: v })} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Owner", "Verantwortlich")} htmlFor="tp-owner">
          <UserSelect id="tp-owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        </Field>
        <Field label={tr("Area", "Bereich")} htmlFor="tp-area">
          <AreaInput id="tp-area" value={f.area} onChange={(area) => setF({ ...f, area })} />
        </Field>
      </div>
      <Field label={tr("Stage", "Phase")}>
        <StagePicker value={f.stage} onChange={(stage) => setF({ ...f, stage })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Target date", "Zieltermin")} htmlFor="tp-due">
          <DueDateField id="tp-due" value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v })} />
        </Field>
        <Field label={tr("Follow-up", "Wiedervorlage")} htmlFor="tp-fu" hint={tr("Shows up on Home when it is due.", "Erscheint auf der Startseite, wenn sie fällig ist.")}>
          <DueDateField id="tp-fu" value={f.followUp} onChange={(v) => setF({ ...f, followUp: v })} />
        </Field>
      </div>
      <Field label={tr("Description", "Beschreibung")} htmlFor="tp-desc">
        <textarea id="tp-desc" className="field min-h-[96px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={tr("Goal, context, links …", "Ziel, Kontext, Links …")} />
      </Field>
      {err._ && <p className="text-sm font-medium text-neg">{err._}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={() => close("topic")}>
          {tr("Cancel", "Abbrechen")}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!f.title.trim()}>
          {tr("Create topic", "Thema anlegen")}
        </Button>
      </div>
    </form>
  );
}

export function StagePicker({ value, onChange }: { value: TopicStage; onChange: (v: TopicStage) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tr("Stage", "Phase")}>
      {[...TOPIC_STAGES, "verworfen" as const].map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={cx(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition",
            value === s ? cx("border-transparent", TOPIC_STAGE[s]?.tone) : "border-line bg-surface text-muted hover:text-ink",
          )}
          title={TOPIC_STAGE[s]?.hint}
        >
          <span className={cx("h-2 w-2 rounded-full", TOPIC_STAGE[s]?.dot)} aria-hidden />
          {TOPIC_STAGE[s]?.label}
        </button>
      ))}
    </div>
  );
}

function EditTopic({ id }: { id: string }) {
  const qc = useQueryClient();
  const { close } = useOverlays();
  const { data: t, isLoading, error } = useTopic(id);
  const me = useMe().data?.user;
  const users = useUserMap();
  const update = useUpdateTopic();
  const [f, setF] = useState({ title: "", description: "", area: "", counterpart: "", waitingOn: "", nextStep: "" });
  const [editDesc, setEditDesc] = useState(false);
  const [comment, setComment] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (t && !loaded.current) {
      setF({ title: t.title, description: t.description, area: t.area, counterpart: t.counterpart, waitingOn: t.waitingOn, nextStep: t.nextStep });
      setEditDesc(!t.description.trim());
      loaded.current = true;
    }
  }, [t]);

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  if (error || !t) return <p className="text-sm text-neg">{(error as Error)?.message ?? tr("Not found.", "Nicht gefunden.")}</p>;

  const save = (patch: Partial<Topic>) => update.mutate({ id, patch }, { onError: (e) => toast.error((e as Error).message) });
  const commit = (k: keyof typeof f) => {
    const v = k === "description" ? f[k] : f[k].trim();
    if (v !== (t[k] ?? "")) save({ [k]: v } as Partial<Topic>);
  };
  const canDelete = me && (me.role === "admin" || t.createdBy === me.id || t.ownerId === me.id);
  const creator = t.createdBy ? users.get(t.createdBy) : undefined;
  const open = t.tasks.filter((x) => x.status !== "erledigt");
  const done = t.tasks.filter((x) => x.status === "erledigt");
  const waitDays = daysSince(t.waitingSince);

  async function addUpdate() {
    if (!comment.trim()) return;
    try {
      await api.post(`/api/topics/${id}/updates`, { body: comment.trim() });
      setComment("");
      qc.invalidateQueries({ queryKey: ["topic", id] });
      qc.invalidateQueries({ queryKey: ["topics"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function deleteUpdate(uid: string) {
    try {
      await api.del(`/api/topics/${id}/updates/${uid}`);
      qc.invalidateQueries({ queryKey: ["topic", id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function remove() {
    try {
      await api.del(`/api/topics/${id}`);
      for (const k of ["topics", "tasks", "home"]) qc.invalidateQueries({ queryKey: [k] });
      toast(tr("Topic deleted – its tasks remain", "Thema gelöscht – die Aufgaben bleiben"));
      close("topic");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <textarea
          rows={1}
          className="field min-h-0 resize-none text-[19px] font-bold leading-snug"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          onBlur={() => f.title.trim() && commit("title")}
          aria-label={tr("Title", "Titel")}
          maxLength={200}
        />
        <TxNote text={t.title} />
        <p className="mt-1.5 text-[12.5px] text-muted">
          {creator ? tr(`Created by ${creator.name}, `, `Angelegt von ${creator.name}, `) : ""}
          {relTime(t.createdAt)}
          {t.lastActivity > t.createdAt + 60_000 && <> · {tr("last activity", "zuletzt aktiv")} {relTime(t.lastActivity)}</>}
        </p>
      </div>

      <StagePicker value={t.stage} onChange={(stage) => save({ stage })} />

      {t.stage === "wartet" && (
        <div className="rounded-xl bg-accent-soft/60 p-3 ring-1 ring-accent/30">
          <label htmlFor="tp-wait" className="flex items-center gap-1.5 text-[13px] font-bold text-accent-ink">
            <Hourglass className="h-4 w-4" /> {tr("Waiting on", "Wartet auf")}
            {waitDays !== null && <span className="font-semibold">· {waitDays === 0 ? tr("since today", "seit heute") : tr(`for ${waitDays} days`, `seit ${waitDays} ${waitDays === 1 ? "Tag" : "Tagen"}`)}</span>}
          </label>
          <input
            id="tp-wait"
            className="field mt-1.5"
            value={f.waitingOn}
            maxLength={300}
            onChange={(e) => setF({ ...f, waitingOn: e.target.value })}
            onBlur={() => commit("waitingOn")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder={tr("Who has the ball? E.g. “Decision of the university”", "Wer ist am Zug? Z. B. „Entscheidung der Hochschule“")}
          />
          {!t.followUp && (
            <p className="mt-1.5 text-[12px] text-accent-ink">{tr("Tip: set a follow-up date so it does not get lost.", "Tipp: Setz eine Wiedervorlage, damit es nicht untergeht.")}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Type", "Art")}>
          <KindToggle value={t.kind} onChange={(kind) => save({ kind })} />
        </Field>
        <Field label={tr("Owner", "Verantwortlich")} htmlFor="tp-e-owner">
          <UserSelect id="tp-e-owner" value={t.ownerId} onChange={(v) => save({ ownerId: v })} />
        </Field>
        {t.kind === "extern" && (
          <>
            <Field label={tr("Counterpart", "Gegenüber")} htmlFor="tp-e-cp">
              <input id="tp-e-cp" className="field" value={f.counterpart} maxLength={160} onChange={(e) => setF({ ...f, counterpart: e.target.value })} onBlur={() => commit("counterpart")} placeholder={tr("Authority, partner, university …", "Behörde, Partner, Hochschule …")} />
            </Field>
            <Field label={tr("Organization in the CRM", "Institution im CRM")} htmlFor="tp-e-org">
              <OrgSelect id="tp-e-org" value={t.organizationId} onChange={(v) => save({ organizationId: v })} />
            </Field>
          </>
        )}
        <Field label={tr("Area", "Bereich")} htmlFor="tp-e-area">
          <AreaInput id="tp-e-area" value={f.area} onChange={(area) => setF({ ...f, area })} onCommit={() => commit("area")} />
        </Field>
        <Field label={tr("Next step", "Nächster Schritt")} htmlFor="tp-e-next">
          <input id="tp-e-next" className="field" value={f.nextStep} maxLength={300} onChange={(e) => setF({ ...f, nextStep: e.target.value })} onBlur={() => commit("nextStep")} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder={tr("What happens next?", "Was passiert als Nächstes?")} />
        </Field>
        <Field label={tr("Target date", "Zieltermin")} htmlFor="tp-e-due">
          <DueDateField id="tp-e-due" value={t.dueDate} onChange={(v) => save({ dueDate: v })} />
        </Field>
        <Field label={tr("Follow-up", "Wiedervorlage")} htmlFor="tp-e-fu">
          <DueDateField id="tp-e-fu" value={t.followUp} onChange={(v) => save({ followUp: v })} />
        </Field>
      </div>
      {t.organizationId && (
        <Link to={orgHref(t.organizationKind, t.organizationId)} onClick={() => close("topic")} className="flex items-center gap-2 text-sm font-semibold text-info">
          <Building2 className="h-4 w-4" /> {tr("Open in the CRM:", "Im CRM öffnen:")} {t.organizationName}
        </Link>
      )}

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="label mb-0">{tr("Description", "Beschreibung")}</h3>
          <span className="flex-1" />
          {!editDesc && (
            <button type="button" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink" onClick={() => setEditDesc(true)}>
              <Pencil className="h-3.5 w-3.5" /> {tr("Edit", "Bearbeiten")}
            </button>
          )}
        </div>
        {editDesc ? (
          <textarea
            autoFocus={!!t.description}
            className="field min-h-[110px]"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            onBlur={() => {
              commit("description");
              if (f.description.trim()) setEditDesc(false);
            }}
            placeholder={tr("Goal, context, links … (Markdown)", "Ziel, Kontext, Links … (Markdown)")}
            aria-label={tr("Description", "Beschreibung")}
          />
        ) : (
          <div className="rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-line" onDoubleClick={() => setEditDesc(true)}>
            <Markdown className="text-[14px]">{f.description}</Markdown>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="label mb-0">{tr("Tasks", "Aufgaben")}</h3>
          {t.taskTotal > 0 && (
            <>
              <Progress value={t.taskTotal ? t.taskDone / t.taskTotal : 0} className="max-w-[180px] flex-1" tone={t.taskDone === t.taskTotal ? "pos" : "brand"} label={tr("Task progress", "Fortschritt der Aufgaben")} />
              <span className="num text-[12px] text-muted">
                {t.taskDone}/{t.taskTotal}
              </span>
            </>
          )}
        </div>
        <QuickAdd compact defaults={{ topicId: t.id }} placeholder={tr("Add a task to this topic … (@person tomorrow !high)", "Aufgabe zu diesem Thema … (@Person morgen !hoch)")} onCreated={() => qc.invalidateQueries({ queryKey: ["topic", id] })} />
        <div className="mt-1">
          {open.length === 0 && done.length === 0 && <p className="py-3 text-sm text-muted">{tr("No tasks yet. Break the topic into the next steps.", "Noch keine Aufgaben. Zerleg das Thema in die nächsten Schritte.")}</p>}
          {open.map((x) => (
            <TaskRow key={x.id} task={x} showContext={false} />
          ))}
          {done.length > 0 && (
            <button type="button" className="mt-1 text-[12.5px] font-semibold text-muted" onClick={() => setShowDone((v) => !v)}>
              {showDone ? tr("Hide done", "Erledigte ausblenden") : tr(`Show ${done.length} done`, `${done.length} erledigte zeigen`)}
            </button>
          )}
          {showDone && done.map((x) => <TaskRow key={x.id} task={x} showContext={false} quickActions={false} />)}
        </div>
      </div>

      <div>
        <h3 className="label">{tr("Updates & history", "Updates & Verlauf")}</h3>
        <div className="space-y-3">
          <Timeline comments={t.updates} events={t.events} onDeleteComment={deleteUpdate} />
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              className="field min-h-[42px] flex-1 resize-none"
              placeholder={tr("Write an update … (e.g. result of a call)", "Update schreiben … (z. B. Ergebnis eines Telefonats)")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addUpdate();
              }}
            />
            <Button variant="primary" size="md" icon={<Send className="h-4 w-4" />} onClick={addUpdate} disabled={!comment.trim()} aria-label={tr("Post update", "Update senden")} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
        {canDelete ? (
          confirmDel ? (
            <div className="flex items-center gap-2">
              <Button variant="danger" size="sm" onClick={remove}>
                {tr("Delete topic", "Thema löschen")}
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
        <Button variant="primary" onClick={() => close("topic")}>
          {tr("Done", "Fertig")}
        </Button>
      </div>
    </div>
  );
}
