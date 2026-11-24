import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { CONTACT_CATEGORIES } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { useContact, useContactMeta, useMe } from "@/lib/queries";
import type { Contact, ContactCategory } from "@/lib/types";
import { DueDateField, OrgSelect, Select, UserSelect } from "./pickers";
import { Sheet } from "./Sheet";
import { Button, cx, Field, Skeleton } from "./ui";

export function ContactSheet() {
  const o = useOverlay("contact");
  const { close } = useOverlays();
  return (
    <Sheet open={!!o} onOpenChange={(v) => !v && close("contact")} title={o?.id ? tr("Edit contact", "Kontakt bearbeiten") : tr("New contact", "Neuer Kontakt")} size="md">
      {o && <ContactForm key={o.id ?? "new"} id={o.id} defaults={o.defaults} />}
    </Sheet>
  );
}

function ContactForm({ id, defaults }: { id?: string; defaults?: Partial<Contact> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { close } = useOverlays();
  const me = useMe().data?.user;
  const meta = useContactMeta().data;
  const existing = useContact(id);
  const [f, setF] = useState({
    name: defaults?.name ?? "",
    email: defaults?.email ?? "",
    company: defaults?.company ?? "",
    position: defaults?.position ?? "",
    category: (defaults?.category ?? "investor") as ContactCategory,
    stage: defaults?.stage ?? "",
    ownerId: defaults?.ownerId === undefined ? (me?.id ?? null) : defaults.ownerId,
    phone: defaults?.phone ?? "",
    linkedin: defaults?.linkedin ?? "",
    tags: (defaults?.tags ?? []).join(", "),
    nextStep: defaults?.nextStep ?? "",
    nextDate: defaults?.nextDate ?? (null as string | null),
    notes: defaults?.notes ?? "",
    organizationId: defaults?.organizationId ?? (null as string | null),
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const [dupId, setDupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = existing.data;
    if (c)
      setF({
        name: c.name,
        email: c.email,
        company: c.company,
        position: c.position,
        category: c.category,
        stage: c.stage,
        ownerId: c.ownerId,
        phone: c.phone,
        linkedin: c.linkedin,
        tags: c.tags.join(", "),
        nextStep: c.nextStep,
        nextDate: c.nextDate,
        notes: c.notes,
        organizationId: c.organizationId,
      });
  }, [existing.data]);

  if (id && existing.isLoading) return <Skeleton className="h-64" />;
  const stages = meta?.stages[f.category] ?? [];

  async function submit() {
    setBusy(true);
    setErr({});
    setDupId(null);
    const payload = { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), stage: f.stage || undefined };
    try {
      const c = id ? await api.patch<Contact>(`/api/contacts/${id}`, payload) : await api.post<Contact>("/api/contacts", payload);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact", c.id] });
      qc.invalidateQueries({ queryKey: ["contact-lookup"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      qc.invalidateQueries({ queryKey: ["org"] });
      qc.invalidateQueries({ queryKey: ["orgs"] });
      toast.success(id ? tr("Contact saved", "Kontakt gespeichert") : tr("Contact created", "Kontakt angelegt"), { description: c.name });
      close("contact");
      // New contact created from an organization: stay there
      if (!id && !defaults?.organizationId) navigate(`/kontakte/${c.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr({ ...e.fields, _: e.message });
        if (e.code === "duplicate" && typeof e.data.id === "string") setDupId(e.data.id);
      } else setErr({ _: tr("Couldn't save. Please try again.", "Speichern fehlgeschlagen. Bitte versuch es noch einmal.") });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Name" error={err.name} htmlFor="c-name">
        <input id="c-name" autoFocus={!id} className="field" value={f.name} onChange={set("name")} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Email", "E-Mail")} error={err.email} htmlFor="c-email">
          <input id="c-email" type="email" inputMode="email" className="field" value={f.email} onChange={set("email")} autoComplete="off" />
        </Field>
        <Field label={tr("Phone", "Telefon")} htmlFor="c-phone">
          <input id="c-phone" type="tel" className="field" value={f.phone} onChange={set("phone")} />
        </Field>
        <Field label={tr("Company", "Unternehmen")} htmlFor="c-company">
          <input id="c-company" className="field" value={f.company} onChange={set("company")} />
        </Field>
        <Field label="Position" htmlFor="c-pos">
          <input id="c-pos" className="field" value={f.position} onChange={set("position")} />
        </Field>
        <Field label={tr("Belongs to (client / investor)", "Gehört zu (Kunde / Investor)")} htmlFor="c-org" className="sm:col-span-2">
          <OrgSelect id="c-org" value={f.organizationId} onChange={(v) => setF({ ...f, organizationId: v })} />
        </Field>
      </div>
      <Field label={tr("Category", "Kategorie")}>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {Object.entries(CONTACT_CATEGORIES).map(([k, c]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.category === k}
              onClick={() => setF({ ...f, category: k as ContactCategory, stage: "" })}
              className={cx(
                "h-8 rounded-full border px-3 text-[13px] font-semibold transition",
                f.category === k ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted hover:text-ink",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status" htmlFor="c-stage">
          <Select id="c-stage" value={f.stage || stages[0] || ""} onChange={(e) => setF({ ...f, stage: e.target.value })}>
            {stages.map((s) => (
              <option key={s} value={s}>
                {meta?.stageLabels?.[s] ?? s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Owner", "Zuständig")} htmlFor="c-owner">
          <UserSelect id="c-owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        </Field>
      </div>
      <Field label={tr("Next step", "Nächster Schritt")} htmlFor="c-next">
        <input id="c-next" className="field" value={f.nextStep} onChange={set("nextStep")} placeholder={tr("e.g. Send documents", "z. B. Unterlagen schicken")} />
      </Field>
      <Field label={tr("Due by", "Bis wann")} htmlFor="c-nextdate">
        <DueDateField id="c-nextdate" value={f.nextDate} onChange={(v) => setF({ ...f, nextDate: v })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="LinkedIn" error={err.linkedin} htmlFor="c-li">
          <input id="c-li" type="url" className="field" value={f.linkedin} onChange={set("linkedin")} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label={tr("Tags", "Schlagworte")} hint={tr("Separate with commas", "Mit Komma trennen")} htmlFor="c-tags">
          <input id="c-tags" className="field" value={f.tags} onChange={set("tags")} placeholder="VC, Seed, DACH" />
        </Field>
      </div>
      <Field label={tr("Notes", "Notizen")} htmlFor="c-notes">
        <textarea id="c-notes" className="field min-h-[90px]" value={f.notes} onChange={set("notes")} />
      </Field>
      {err._ && (
        <p className="text-sm font-medium text-neg">
          {err._}{" "}
          {dupId && (
            <Link className="link" to={`/kontakte/${dupId}`} onClick={() => close("contact")}>
              {tr("Go to contact", "Zum Kontakt")}
            </Link>
          )}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => close("contact")}>
          {tr("Cancel", "Abbrechen")}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!f.name.trim()}>
          {id ? tr("Save", "Speichern") : tr("Create contact", "Kontakt anlegen")}
        </Button>
      </div>
    </form>
  );
}
