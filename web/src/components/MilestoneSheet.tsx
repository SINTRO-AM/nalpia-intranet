import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { invalidateWork, useMe, useMilestone } from "@/lib/queries";
import type { Milestone, MilestoneStatus } from "@/lib/types";
import { DueDateField, UserSelect } from "./pickers";
import { Sheet } from "./Sheet";
import { Button, Field, Segmented, Skeleton } from "./ui";
import { tr } from "@/lib/i18n";

export function MilestoneSheet() {
  const o = useOverlay("milestone");
  const { close } = useOverlays();
  return (
    <Sheet open={!!o} onOpenChange={(v) => !v && close("milestone")} title={o?.id ? tr("Edit milestone", "Meilenstein bearbeiten") : tr("New milestone", "Neuer Meilenstein")}>
      {o && <MilestoneForm key={o.id ?? "new"} id={o.id} />}
    </Sheet>
  );
}

function MilestoneForm({ id }: { id?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { close } = useOverlays();
  const me = useMe().data?.user;
  const existing = useMilestone(id);
  const [f, setF] = useState({ title: "", description: "", ownerId: me?.id ?? null, dueDate: null as string | null, status: "aktiv" as MilestoneStatus, area: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const m = existing.data;
    if (m) setF({ title: m.title, description: m.description, ownerId: m.ownerId, dueDate: m.dueDate, status: m.status, area: m.area });
  }, [existing.data]);

  if (id && existing.isLoading) return <Skeleton className="h-48" />;

  async function submit() {
    setBusy(true);
    setErr({});
    try {
      const m = id ? await api.patch<Milestone>(`/api/milestones/${id}`, f) : await api.post<Milestone>("/api/milestones", f);
      invalidateWork(qc);
      toast.success(id ? tr("Milestone saved", "Meilenstein gespeichert") : tr("Milestone created", "Meilenstein angelegt"));
      close("milestone");
      if (!id) navigate(`/aufgaben/meilensteine/${m.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? { ...e.fields, _: e.message } : { _: tr("Saving failed.", "Speichern fehlgeschlagen.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api.del(`/api/milestones/${id}`);
      invalidateWork(qc);
      close("milestone");
      toast(tr("Milestone deleted", "Meilenstein gelöscht"));
      navigate("/aufgaben?ansicht=meilensteine");
    } catch (e) {
      toast.error((e as Error).message);
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
      <Field label={tr("Title", "Titel")} error={err.title} htmlFor="m-title">
        <input id="m-title" autoFocus={!id} className="field text-[16px] font-semibold" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={tr("e.g. Close the seed round", "z. B. Seed-Runde abschließen")} />
      </Field>
      <Field label="Status">
        <Segmented<MilestoneStatus>
          value={f.status}
          onChange={(v) => setF({ ...f, status: v })}
          options={[
            { value: "geplant", label: tr("Planned", "Geplant") },
            { value: "aktiv", label: tr("Active", "Aktiv") },
            { value: "verschoben", label: tr("Postponed", "Verschoben") },
            { value: "erreicht", label: tr("Achieved", "Erreicht") },
          ]}
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Owner", "Verantwortlich")} htmlFor="m-owner">
          <UserSelect id="m-owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        </Field>
        <Field label={tr("Area", "Bereich")} hint={tr("e.g. Fundraising, Product, Compliance", "z. B. Fundraising, Produkt, Compliance")} htmlFor="m-area">
          <input id="m-area" className="field" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} maxLength={60} />
        </Field>
      </div>
      <Field label={tr("Target date", "Zieldatum")} htmlFor="m-due">
        <DueDateField id="m-due" value={f.dueDate} onChange={(v) => setF({ ...f, dueDate: v })} />
      </Field>
      <Field label={tr("Description", "Beschreibung")} htmlFor="m-desc">
        <textarea id="m-desc" className="field min-h-[110px]" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={tr("What does “achieved” mean? Which results are part of it?", "Was bedeutet „erreicht“? Welche Ergebnisse gehören dazu?")} />
      </Field>
      {err._ && <p className="text-sm font-medium text-neg">{err._}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        {id ? (
          confirm ? (
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={remove}>
                {tr("Delete permanently", "Endgültig löschen")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                {tr("Cancel", "Abbrechen")}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="text-neg" onClick={() => setConfirm(true)}>
              {tr("Delete", "Löschen")}
            </Button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => close("milestone")}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!f.title.trim()}>
            {id ? tr("Save", "Speichern") : tr("Create", "Anlegen")}
          </Button>
        </div>
      </div>
    </form>
  );
}
