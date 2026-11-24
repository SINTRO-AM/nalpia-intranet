import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { amountInput, ORG_KIND, parseAmount } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { useMe, useOrg, useOrgMeta } from "@/lib/queries";
import type { Org, OrgKind, Priority } from "@/lib/types";
import { DueDateField, PriorityPicker, Select, UserSelect } from "./pickers";
import { Sheet } from "./Sheet";
import { Button, Field, Skeleton } from "./ui";

export function OrgSheet() {
  const o = useOverlay("org");
  const { close } = useOverlays();
  const kind: OrgKind = o?.orgKind ?? "investor";
  return (
    <Sheet
      open={!!o}
      onOpenChange={(v) => !v && close("org")}
      title={o?.id ? tr(`Edit ${ORG_KIND[kind].noun.toLowerCase()}`, `${ORG_KIND[kind].noun} bearbeiten`) : kind === "partner" ? tr("New partner", "Neuer Partner") : tr("New investor", "Neuer Investor")}
      size="lg"
    >
      {o && <OrgForm key={o.id ?? `new-${kind}`} id={o.id} kind={kind} defaults={o.defaults} />}
    </Sheet>
  );
}

/** Amount field in €m – accepts comma or point. */
function Amount({ id, label, hint, value, onChange, error }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <div className="relative">
        <input id={id} inputMode="decimal" className="field pr-[72px]" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{tr("€m", "Mio. €")}</span>
      </div>
    </Field>
  );
}

function OrgForm({ id, kind, defaults }: { id?: string; kind: OrgKind; defaults?: Partial<Org> }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { close } = useOverlays();
  const me = useMe().data?.user;
  const meta = useOrgMeta().data;
  const existing = useOrg(id);
  const empty = {
    name: defaults?.name ?? "",
    type: defaults?.type ?? "",
    stage: defaults?.stage ?? "identifiziert",
    priority: (defaults?.priority ?? "mittel") as Priority,
    ownerId: defaults?.ownerId === undefined ? (me?.id ?? null) : defaults.ownerId,
    city: defaults?.city ?? "",
    country: defaults?.country ?? tr("Germany", "Deutschland"),
    website: defaults?.website ?? "",
    linkedin: defaults?.linkedin ?? "",
    aumMio: amountInput(defaults?.aumMio),
    potentialMio: amountInput(defaults?.potentialMio),
    ticketMinMio: amountInput(defaults?.ticketMinMio),
    ticketMaxMio: amountInput(defaults?.ticketMaxMio),
    committedMio: amountInput(defaults?.committedMio),
    probability: defaults?.probability === null || defaults?.probability === undefined ? "" : String(defaults.probability),
    focus: defaults?.focus ?? "",
    focusTags: (defaults?.focusTags ?? []) as string[],
    stageFocus: (defaults?.stageFocus ?? []) as string[],
    regionFocus: defaults?.regionFocus ?? "",
    priorOutcome: defaults?.priorOutcome ?? "",
    history: defaults?.history ?? "",
    source: defaults?.source ?? "",
    tags: (defaults?.tags ?? []).join(", "),
    nextStep: defaults?.nextStep ?? "",
    nextDate: defaults?.nextDate ?? (null as string | null),
    notes: defaults?.notes ?? "",
  };
  const [f, setF] = useState(empty);
  const [contact, setContact] = useState({ name: "", email: "", position: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [dupId, setDupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const o = existing.data;
    if (o)
      setF({
        name: o.name,
        type: o.type,
        stage: o.stage,
        priority: o.priority,
        ownerId: o.ownerId,
        city: o.city,
        country: o.country,
        website: o.website,
        linkedin: o.linkedin,
        aumMio: amountInput(o.aumMio),
        potentialMio: amountInput(o.potentialMio),
        ticketMinMio: amountInput(o.ticketMinMio),
        ticketMaxMio: amountInput(o.ticketMaxMio),
        committedMio: amountInput(o.committedMio),
        probability: o.probability === null ? "" : String(o.probability),
        focus: o.focus,
        focusTags: o.focusTags ?? [],
        stageFocus: o.stageFocus ?? [],
        regionFocus: o.regionFocus ?? "",
        priorOutcome: o.priorOutcome ?? "",
        history: o.history ?? "",
        source: o.source,
        tags: o.tags.join(", "),
        nextStep: o.nextStep,
        nextDate: o.nextDate,
        notes: o.notes,
      });
  }, [existing.data]);

  if (id && existing.isLoading) return <Skeleton className="h-72" />;
  const types = meta?.types[kind] ?? {};
  const stages = meta?.stages[kind] ?? [];
  const toggle = (k: "focusTags" | "stageFocus", id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    const amounts = ["aumMio", "potentialMio", "ticketMinMio", "ticketMaxMio", "committedMio"] as const;
    const bad: Record<string, string> = {};
    for (const k of amounts) if (f[k].trim() && parseAmount(f[k]) === null) bad[k] = tr("Enter a number, e.g. 2.5", "Bitte eine Zahl angeben, z. B. 2,5");
    const prob = f.probability.trim() ? Number(f.probability) : null;
    if (prob !== null && (!Number.isInteger(prob) || prob < 0 || prob > 100)) bad.probability = tr("Enter a whole number from 0 to 100", "Bitte eine ganze Zahl von 0 bis 100 angeben");
    if (Object.keys(bad).length) return setErr(bad);
    setBusy(true);
    setErr({});
    setDupId(null);
    const payload = {
      ...f,
      ...(id ? {} : { kind }),
      type: f.type || "sonstige",
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      probability: prob,
      ...(kind === "investor" ? {} : { focusTags: [], stageFocus: [], regionFocus: "", priorOutcome: "", history: "" }),
      ...Object.fromEntries(amounts.map((k) => [k, parseAmount(f[k])])),
    };
    try {
      const o = id ? await api.patch<Org>(`/api/orgs/${id}`, payload) : await api.post<Org>("/api/orgs", payload);
      if (!id && (contact.name.trim() || contact.email.trim())) {
        try {
          await api.post("/api/contacts", {
            name: contact.name.trim() || contact.email.trim(),
            email: contact.email.trim(),
            position: contact.position.trim(),
            organizationId: o.id,
            ownerId: f.ownerId,
          });
        } catch (e) {
          toast.error(tr(`Contact not created: ${(e as Error).message}`, `Ansprechpartner nicht angelegt: ${(e as Error).message}`));
        }
      }
      for (const k of ["orgs", "org", "contacts", "home", "search"]) qc.invalidateQueries({ queryKey: [k] });
      toast.success(id ? tr("Saved", "Gespeichert") : tr("Created", "Angelegt"), { description: o.name });
      close("org");
      if (!id) navigate(`${ORG_KIND[kind].path}/${o.id}`);
    } catch (e) {
      if (e instanceof ApiError) {
        setErr({ ...e.fields, _: e.message });
        if (e.code === "duplicate" && typeof e.data.id === "string") setDupId(e.data.id);
      } else setErr({ _: tr("Couldn't save. Please try again.", "Speichern fehlgeschlagen. Bitte versuch es noch einmal.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={kind !== "investor" ? tr("Partner name", "Name des Partners") : tr("Name (fund, firm or person)", "Name (Fonds, Firma oder Person)")} error={err.name} htmlFor="o-name">
        <input id="o-name" autoFocus={!id} className="field text-[16px] font-semibold" value={f.name} onChange={set("name")} autoComplete="off" placeholder={kind !== "investor" ? tr("e.g. Example Broker", "z. B. Muster Broker") : tr("e.g. Example Ventures", "z. B. Muster Ventures")} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={tr("Type", "Art")} htmlFor="o-type">
          <Select id="o-type" value={f.type || "sonstige"} onChange={set("type")}>
            {Object.entries(types).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="o-stage">
          <Select id="o-stage" value={f.stage} onChange={set("stage")}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Owner", "Zuständig")} htmlFor="o-owner">
          <UserSelect id="o-owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} />
        </Field>
      </div>
      <Field label={tr("Priority", "Priorität")}>
        <PriorityPicker value={f.priority} onChange={(v) => setF({ ...f, priority: v })} />
      </Field>

      <fieldset className="space-y-4 rounded-2xl border border-line p-4">
        <legend className="px-1 text-[13px] font-bold">{kind !== "investor" ? tr("Partnership", "Partnerschaft") : "Investment"}</legend>
        {kind !== "investor" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Amount id="o-pot" label={tr("Potential volume", "Mögliches Volumen")} hint={tr("e.g. expected fees or contract value per year", "z. B. erwartete Gebühren oder Vertragswert pro Jahr")} value={f.potentialMio} onChange={(v) => setF({ ...f, potentialMio: v })} error={err.potentialMio} />
            <Amount id="o-com" label={tr("Contract value", "Vertragswert")} value={f.committedMio} onChange={(v) => setF({ ...f, committedMio: v })} error={err.committedMio} />
            <Field label={tr("Probability of closing", "Abschluss-Wahrscheinlichkeit")} error={err.probability} htmlFor="o-prob">
              <div className="relative">
                <input id="o-prob" inputMode="numeric" className="field pr-10" value={f.probability} onChange={set("probability")} placeholder={tr("e.g. 30", "z. B. 30")} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">%</span>
              </div>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Amount id="o-tmin" label={tr("Ticket from", "Ticket von")} value={f.ticketMinMio} onChange={(v) => setF({ ...f, ticketMinMio: v })} error={err.ticketMinMio} />
            <Amount id="o-tmax" label={tr("Ticket up to", "Ticket bis")} value={f.ticketMaxMio} onChange={(v) => setF({ ...f, ticketMaxMio: v })} error={err.ticketMaxMio} />
            <Amount id="o-pot" label={tr("Expected ticket for us", "Erwartetes Ticket für uns")} value={f.potentialMio} onChange={(v) => setF({ ...f, potentialMio: v })} error={err.potentialMio} />
            <Amount id="o-com" label={tr("Committed / invested", "Zugesagt / investiert")} value={f.committedMio} onChange={(v) => setF({ ...f, committedMio: v })} error={err.committedMio} />
            <Amount id="o-aum" label={tr("Fund size", "Fondsgröße")} hint={tr("For VCs: fund volume under management", "Bei VCs: verwaltetes Fondsvolumen")} value={f.aumMio} onChange={(v) => setF({ ...f, aumMio: v })} error={err.aumMio} />
            <Field label={tr("Probability", "Wahrscheinlichkeit")} error={err.probability} htmlFor="o-prob">
              <div className="relative">
                <input id="o-prob" inputMode="numeric" className="field pr-10" value={f.probability} onChange={set("probability")} placeholder={tr("e.g. 30", "z. B. 30")} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">%</span>
              </div>
            </Field>
          </div>
        )}
        <Field label={kind !== "investor" ? tr("What they offer", "Angebot / Leistung") : tr("Investment focus (free text)", "Investmentfokus (Freitext)")} htmlFor="o-focus">
          <input id="o-focus" className="field" value={f.focus} onChange={set("focus")} placeholder={kind !== "investor" ? tr("e.g. order routing API, custody, market data", "z. B. Orderrouting-API, Verwahrung, Marktdaten") : tr("e.g. consumer fintech, AI agents, pre-seed, US/Europe", "z. B. Consumer-Fintech, KI-Agenten, Pre-Seed, USA/Europa")} />
        </Field>
        {kind === "investor" && (
          <>
            <Field label={tr("Thematic focus", "Thematischer Fokus")} hint={tr("Drives the fit for nalpia and the filters", "Bestimmt den Fit für nalpia und die Filter")}>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(meta?.focusTags ?? {}).map(([k, v]) => (
                  <button key={k} type="button" aria-pressed={f.focusTags.includes(k)} onClick={() => toggle("focusTags", k)} className={`h-8 rounded-full border px-3 text-[13px] font-semibold transition ${f.focusTags.includes(k) ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted hover:text-ink"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={tr("Stage focus", "Phasenfokus")}>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(meta?.stageFocus ?? {}).map(([k, v]) => (
                    <button key={k} type="button" aria-pressed={f.stageFocus.includes(k)} onClick={() => toggle("stageFocus", k)} className={`h-8 rounded-full border px-3 text-[13px] font-semibold transition ${f.stageFocus.includes(k) ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted hover:text-ink"}`}>
                      {v}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={tr("Regional focus", "Regionaler Fokus")} htmlFor="o-region">
                <input id="o-region" className="field" value={f.regionFocus} onChange={set("regionFocus")} placeholder={tr("e.g. USA, Europe, global", "z. B. USA, Europa, global")} />
              </Field>
              <Field label={tr("Earlier outcome (e.g. with SINTRO)", "Früheres Ergebnis (z. B. mit SINTRO)")} htmlFor="o-prior">
                <Select id="o-prior" value={f.priorOutcome} onChange={set("priorOutcome")}>
                  {Object.entries(meta?.priorOutcomes ?? {}).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("History", "Vorgeschichte")} htmlFor="o-history">
                <input id="o-history" className="field" value={f.history} onChange={set("history")} placeholder={tr("e.g. SINTRO: replied, call in October", "z. B. SINTRO: Antwort, Call im Oktober")} />
              </Field>
            </div>
          </>
        )}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("City", "Stadt")} htmlFor="o-city">
          <input id="o-city" className="field" value={f.city} onChange={set("city")} />
        </Field>
        <Field label={tr("Country", "Land")} htmlFor="o-country">
          <input id="o-country" className="field" value={f.country} onChange={set("country")} />
        </Field>
        <Field label="Website" error={err.website} htmlFor="o-web">
          <input id="o-web" inputMode="url" className="field" value={f.website} onChange={set("website")} placeholder={tr("example.com", "beispiel.de")} />
        </Field>
        <Field label="LinkedIn" error={err.linkedin} htmlFor="o-li">
          <input id="o-li" inputMode="url" className="field" value={f.linkedin} onChange={set("linkedin")} placeholder="https://linkedin.com/company/…" />
        </Field>
        <Field label={tr("Source", "Quelle")} hint={tr("How did the contact come about?", "Wie ist der Kontakt entstanden?")} htmlFor="o-src">
          <input id="o-src" className="field" value={f.source} onChange={set("source")} placeholder={tr("Referral, conference, research …", "Empfehlung, Konferenz, Recherche …")} />
        </Field>
        <Field label={tr("Tags", "Schlagworte")} hint={tr("Separate with commas", "Mit Komma trennen")} htmlFor="o-tags">
          <input id="o-tags" className="field" value={f.tags} onChange={set("tags")} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_220px]">
        <Field label={tr("Next step", "Nächster Schritt")} htmlFor="o-next">
          <input id="o-next" className="field" value={f.nextStep} onChange={set("nextStep")} placeholder={tr("e.g. Send one-pager", "z. B. One-Pager schicken")} />
        </Field>
        <Field label={tr("Due by", "Bis wann")} htmlFor="o-nextdate">
          <DueDateField id="o-nextdate" value={f.nextDate} onChange={(v) => setF({ ...f, nextDate: v })} />
        </Field>
      </div>

      {!id && (
        <fieldset className="space-y-4 rounded-2xl border border-line p-4">
          <legend className="px-1 text-[13px] font-bold">{tr("First contact (optional)", "Erster Ansprechpartner (optional)")}</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="o-cname">
              <input id="o-cname" className="field" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            </Field>
            <Field label={tr("Email", "E-Mail")} htmlFor="o-cmail">
              <input id="o-cmail" type="email" inputMode="email" className="field" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            </Field>
            <Field label="Position" htmlFor="o-cpos">
              <input id="o-cpos" className="field" value={contact.position} onChange={(e) => setContact({ ...contact, position: e.target.value })} />
            </Field>
          </div>
        </fieldset>
      )}

      <Field label={tr("Notes", "Notizen")} htmlFor="o-notes">
        <textarea id="o-notes" className="field min-h-[90px]" value={f.notes} onChange={set("notes")} />
      </Field>
      {err._ && (
        <p className="text-sm font-medium text-neg">
          {err._}{" "}
          {dupId && (
            <Link className="link" to={`${ORG_KIND[kind].path}/${dupId}`} onClick={() => close("org")}>
              {tr("Go to entry", "Zum Eintrag")}
            </Link>
          )}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => close("org")}>
          {tr("Cancel", "Abbrechen")}
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!f.name.trim()}>
          {id ? tr("Save", "Speichern") : tr("Create", "Anlegen")}
        </Button>
      </div>
    </form>
  );
}
