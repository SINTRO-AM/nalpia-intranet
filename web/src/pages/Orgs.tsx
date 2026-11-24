import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Calendar,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Globe,
  Linkedin,
  Link2,
  Bot,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Unlink,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { Sheet } from "@/components/Sheet";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Button, cx, EmptyState, Field, IconButton, Pill, Segmented, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { amountInput, dueInfo, fitBucket, money, ORG_KIND, OUTREACH_TONE, parseAmount, PRIORITY, relTime } from "@/lib/format";
import { getLang, locale, tr } from "@/lib/i18n";
import { useOverlays } from "@/lib/overlays";
import { MoreButton, usePaged } from "@/lib/paging";
import { OrgDashboardView } from "./OrgDashboard";
import { applyFilters, FILTER_KEYS, filterParam, FilterButton, FilterChips, OrgFilterPanel, readFilters } from "./orgFilters";
import { useContacts, useMe, useOrg, useOrgMeta, useOrgs, useRound, useUserMap, type Round } from "@/lib/queries";
import type { Org, OrgActivity, OrgDetail, OrgKind, OrgMeta, StageDef } from "@/lib/types";
import { Tx, TxNote, txNow, useTxVersion } from "@/lib/translate";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const text = (kind: OrgKind) =>
  kind === "partner"
    ? {
        title: tr("Partners", "Partner"),
        lead: tr(
          "Brokers, banks, exchanges, data providers, regulatory partners, programs and service providers nalpia works with.",
          "Broker, Banken, Börsen, Datenanbieter, regulatorische Partner, Programme und Dienstleister, mit denen nalpia arbeitet.",
        ),
        create: tr("New partner", "Neuer Partner"),
        empty: tr("No partners yet", "Noch keine Partner"),
        emptyText: tr("Create the first partner or import your list as CSV.", "Lege den ersten Partner an oder importiere eure Liste als CSV."),
      }
    : {
        title: tr("Investors", "Investoren"),
        lead: tr(
          "Business angels, pre-seed and seed funds for nalpia's funding – with fit score, focus, stage, region and ticket size as filters. The agent works from this list.",
          "Business Angels, Pre-Seed- und Seed-Fonds für die Finanzierung von nalpia – mit Fit-Score, Fokus, Phase, Region und Ticketgröße als Filter. Der Agent arbeitet aus dieser Liste.",
        ),
        create: tr("New investor", "Neuer Investor"),
        empty: tr("No investors yet", "Noch keine Investoren"),
        emptyText: tr("Create the first investor, import the CRM bundle under Admin or import your pipeline as CSV.", "Lege den ersten Investor an, importiere das CRM-Paket unter Verwaltung oder importiere eure Pipeline als CSV."),
      };

function stageOf(meta: OrgMeta | undefined, kind: OrgKind, id: string): StageDef | undefined {
  return meta?.stages[kind].find((s) => s.id === id);
}

/** The headline amount for an organization. */
/** "3 investors" / "3 Investoren" – en and de as [singular, plural] */
const plural = (n: number, en: [string, string], de: [string, string]) => `${n.toLocaleString(locale())} ${n === 1 ? tr(en[0], de[0]) : tr(en[1], de[1])}`;
const pctText = (p: number) => tr(`${p}%`, `${p} %`);

function headlineAmount(o: Org) {
  if (o.kind === "investor") {
    if (o.committedMio) return { label: tr("Committed", "Zugesagt"), value: money(o.committedMio) };
    if (o.potentialMio) return { label: "Ticket", value: money(o.potentialMio) };
    if (o.ticketMinMio || o.ticketMaxMio) return { label: "Ticket", value: ticketRange(o) };
    return null;
  }
  if (o.committedMio) return { label: tr("Contract", "Vertrag"), value: money(o.committedMio) };
  if (o.potentialMio) return { label: tr("Potential", "Potenzial"), value: money(o.potentialMio) };
  return null;
}

function ticketRange(o: Pick<Org, "ticketMinMio" | "ticketMaxMio">) {
  if (o.ticketMinMio && o.ticketMaxMio) return `${money(o.ticketMinMio, { short: true })} – ${money(o.ticketMaxMio)}`;
  if (o.ticketMinMio) return tr(`from ${money(o.ticketMinMio)}`, `ab ${money(o.ticketMinMio)}`);
  if (o.ticketMaxMio) return tr(`up to ${money(o.ticketMaxMio)}`, `bis ${money(o.ticketMaxMio)}`);
  return "–";
}

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

type View = "uebersicht" | "pipeline" | "liste";
type Sort = "aktualisiert" | "name" | "betrag" | "naechster" | "fit";

export function OrgsPage({ kind }: { kind: OrgKind }) {
  const t = text(kind);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const view: View = (params.get("ansicht") as View) || "uebersicht";
  const type = params.get("art") ?? "";
  const mine = params.get("meine") === "1";
  const prio = params.get("prio") ?? "";
  const showClosed = params.get("abgeschlossen") === "1";
  // Investors: best fit for nalpia first
  const defaultSort: Sort = kind === "investor" ? "fit" : "aktualisiert";
  const sort = (params.get("sortierung") as Sort) || defaultSort;
  const { data, isLoading } = useOrgs({ kind, q: debounced || undefined, type: type || undefined, owner: mine ? "me" : undefined, priority: prio || undefined });
  const meta = useOrgMeta().data;
  const { open } = useOverlays();
  const [importOpen, setImportOpen] = useState(false);
  const isAdmin = useMe().data?.user?.role === "admin";
  const investor = kind === "investor";
  const openImport = () => setImportOpen(true);
  const qc = useQueryClient();
  async function rescore() {
    try {
      const r = await api.post<{ orgs: number; hoch: number; mittel: number; niedrig: number }>("/api/orgs/fit/recalc", { fillFocus: true });
      qc.invalidateQueries({ queryKey: ["orgs"] });
      qc.invalidateQueries({ queryKey: ["org"] });
      toast.success(tr("Fit recalculated", "Fit neu berechnet"), {
        description: tr(`${r.hoch} high, ${r.mittel} medium, ${r.niedrig} low priority`, `${r.hoch} hoch, ${r.mittel} mittel, ${r.niedrig} niedrig`),
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);

  const setFilter = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
    setParams(p, { replace: true });
  };

  const extra = readFilters(params);
  const extraActive = FILTER_KEYS.filter((k) => extra[k]).length;
  const [panel, setPanel] = useState(extraActive > 0);
  const filtered = debounced || type || mine || prio || extraActive > 0;
  const all = data ?? [];
  const shown = useMemo(() => (extraActive ? applyFilters(all, extra, kind, meta) : all), [all, kind, meta, extraActive, ...FILTER_KEYS.map((k) => extra[k])]);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{t.title}</h1>
          <p className="max-w-[60ch] text-[14px] text-muted">{t.lead}</p>
        </div>
        <div className="flex shrink-0 gap-2 pt-1 sm:pt-0">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label={tr("Import and export", "Import und Export")}>
                <MoreHorizontal className="h-5 w-5" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-[220px] rounded-xl border border-line bg-surface p-1.5 shadow-pop">
                <DropdownMenu.Item onSelect={openImport} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface2">
                  <Upload className="h-4 w-4 text-muted" /> {tr("Import CSV", "CSV importieren")}
                </DropdownMenu.Item>
                {investor && isAdmin && (
                  <DropdownMenu.Item onSelect={() => void rescore()} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface2">
                    <Gauge className="h-4 w-4 text-muted" /> {tr("Recalculate fit for nalpia", "Fit für nalpia neu berechnen")}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item asChild>
                  <a href={`/api/orgs/export?kind=${kind}`} download className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface2">
                    <Download className="h-4 w-4 text-muted" /> {tr("Export as CSV (Excel)", "Als CSV exportieren (Excel)")}
                  </a>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <Button variant="primary" className="hidden sm:inline-flex" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "org", orgKind: kind })}>
            {t.create}
          </Button>
        </div>
      </header>

      {meta && all.length > 0 && (investor ? <RoundSummary orgs={all} meta={meta} /> : <PartnerSummary orgs={all} meta={meta} />)}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<View>
          value={view}
          onChange={(v) => {
            if (v === "uebersicht") setQ("");
            setFilter(
              v === "uebersicht"
                ? { ansicht: null, art: null, prio: null, meine: null, ...Object.fromEntries(FILTER_KEYS.map((k) => [filterParam(k), null])) }
                : { ansicht: v },
            );
          }}
          options={[
            { value: "uebersicht", label: tr("Overview", "Übersicht") },
            { value: "pipeline", label: "Pipeline" },
            { value: "liste", label: tr("List", "Liste") },
          ]}
        />
        {view !== "uebersicht" && (
          <>
        <div className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
            placeholder={tr("Name, city, focus, history or contact", "Name, Ort, Fokus, Vorgeschichte oder Ansprechpartner")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={tr(`Search ${t.title.toLowerCase()}`, `${t.title} durchsuchen`)}
          />
        </div>
        <Select className="w-[min(240px,100%)]" value={type} onChange={(e) => setFilter({ art: e.target.value || null })} aria-label={tr("Type", "Art")}>
          <option value="">{tr("All types", "Alle Arten")}</option>
          {Object.entries(meta?.types[kind] ?? {}).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select className="w-[min(180px,100%)]" value={prio} onChange={(e) => setFilter({ prio: e.target.value || null })} aria-label={tr("Priority", "Priorität")}>
          <option value="">{tr("All priorities", "Alle Prioritäten")}</option>
          <option value="hoch">{tr("High priority", "Hohe Priorität")}</option>
          <option value="mittel">{tr("Medium priority", "Mittlere Priorität")}</option>
          <option value="niedrig">{tr("Low priority", "Niedrige Priorität")}</option>
        </Select>
        <Segmented
          value={mine ? "mine" : "all"}
          onChange={(v) => setFilter({ meine: v === "mine" ? "1" : null })}
          options={[
            { value: "all", label: tr("All", "Alle") },
            { value: "mine", label: tr("Mine", "Meine") },
          ]}
        />
        <FilterButton active={extraActive} open={panel} onClick={() => setPanel((x) => !x)} />
          </>
        )}
      </div>
      {view !== "uebersicht" && meta && panel && (
        <OrgFilterPanel
          kind={kind}
          orgs={all}
          meta={meta}
          f={extra}
          onChange={(k, v) => setFilter({ [filterParam(k)]: v || null })}
          onReset={() => setFilter(Object.fromEntries(FILTER_KEYS.map((k) => [filterParam(k), null])))}
        />
      )}
      {view !== "uebersicht" && meta && (extraActive > 0 || filtered) && all.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FilterChips kind={kind} f={extra} meta={meta} onClear={(k) => setFilter({ [filterParam(k)]: null })} />
          <span className="text-[13px] text-muted">
            {plural(shown.length, ["match", "matches"], ["Treffer", "Treffer"])}
            {extraActive > 0 && tr(` of ${all.length.toLocaleString(locale())}`, ` von ${all.length.toLocaleString(locale())}`)}
          </span>
        </div>
      )}

      {isLoading || !meta ? (
        <Skeleton className="h-80" />
      ) : (view === "uebersicht" ? !all.length : !shown.length) ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title={filtered ? tr("No matches", "Keine Treffer") : t.empty}
          text={filtered ? tr("Adjust your search or filters.", "Passe Suche oder Filter an.") : t.emptyText}
          action={
            !filtered ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => open({ kind: "org", orgKind: kind })}>
                  {t.create}
                </Button>
                <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={openImport}>
                  {tr("Import CSV", "CSV importieren")}
                </Button>
                {investor && isAdmin && (
                  <Link to="/admin?tab=crm" className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface2">
                    {tr("Import CRM bundle", "CRM-Paket importieren")}
                  </Link>
                )}
              </div>
            ) : undefined
          }
        />
      ) : view === "uebersicht" ? (
        <OrgDashboardView kind={kind} meta={meta} />
      ) : view === "pipeline" ? (
        <Board
          kind={kind}
          orgs={shown}
          meta={meta}
          showClosed={showClosed || !!meta.stages[kind].find((st) => st.id === extra.status && (st.closed || st.won))} onToggleClosed={() => setFilter({ abgeschlossen: showClosed ? null : "1" })} />
      ) : (
        <OrgList kind={kind} orgs={shown} meta={meta} sort={sort} resetKey={`${debounced}|${type}|${mine}|${prio}|${FILTER_KEYS.map((k) => extra[k]).join("|")}`} onSort={(s) => setFilter({ sortierung: s === defaultSort ? null : s })} />
      )}
      <ImportSheet kind={kind} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

/* ---------- Summaries ---------- */

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[20px] font-semibold leading-tight tracking-[-0.01em]">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Investors: funding round progress. The bar spans the round target; solid is committed,
 * hatched is term sheet volume, light is the weighted pipeline.
 */
function RoundSummary({ orgs, meta }: { orgs: Org[]; meta: OrgMeta }) {
  const round = useRound().data;
  const me = useMe().data?.user;
  const [edit, setEdit] = useState(false);
  const stage = (o: Org) => stageOf(meta, "investor", o.stage);
  const extra = round?.committedExtraMio ?? 0;
  const committed = sum(orgs.filter((o) => stage(o)?.won).map((o) => o.committedMio ?? o.potentialMio)) + extra;
  const termsheet = sum(orgs.filter((o) => o.stage === "termsheet").map((o) => o.potentialMio));
  const active = orgs.filter((o) => !stage(o)?.won && !stage(o)?.closed);
  const weighted = sum(active.filter((o) => o.stage !== "termsheet").map((o) => ((o.potentialMio ?? 0) * (o.probability ?? 0)) / 100));
  const target = round?.targetMio ?? null;
  const scale = Math.max(target ?? 0, committed + termsheet + weighted, 0.0001);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <section className="card p-4 sm:p-5" aria-label={tr("Funding round status", "Stand der Finanzierungsrunde")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-bold">
          {round?.name ?? tr("Funding round", "Finanzierungsrunde")}
          {round?.preMoneyMio ? <span className="ml-2 text-[13px] font-medium text-muted">{tr("Pre-money", "Pre-Money")} {money(round.preMoneyMio)}</span> : null}
        </h2>
        <p className="text-[13px] text-muted">
          {target ? (
            <>
              <span className="font-semibold text-ink">{money(committed)}</span> {tr("of", "von")} <span>{money(target)}</span> {tr("committed", "zugesagt")}
            </>
          ) : (
            tr("No round target set yet", "Noch kein Rundenziel festgelegt")
          )}
          {me?.role === "admin" && (
            <button className="link ml-3" onClick={() => setEdit(true)}>
              {target ? tr("Change target", "Ziel ändern") : tr("Set target", "Ziel festlegen")}
            </button>
          )}
        </p>
      </div>
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-surface2" role="img" aria-label={tr(
          `Committed ${money(committed)}, term sheets ${money(termsheet)}, weighted pipeline ${money(weighted)}${target ? `, target ${money(target)}` : ""}`,
          `Zugesagt ${money(committed)}, Term Sheets ${money(termsheet)}, gewichtete Pipeline ${money(weighted)}${target ? `, Ziel ${money(target)}` : ""}`,
        )}>
        <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: pct(committed) }} />
        <div
          className="absolute inset-y-0 bg-brand/45 [background-image:repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/0.35)_4px_7px)]"
          style={{ left: pct(committed), width: pct(termsheet) }}
        />
        <div className="absolute inset-y-0 bg-accent/55" style={{ left: pct(committed + termsheet), width: pct(weighted) }} />
        {target && <div className="absolute inset-y-[-3px] w-[2px] rounded bg-ink" style={{ left: `calc(${pct(target)} - 2px)` }} />}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          label={tr("Committed", "Zugesagt")}
          value={money(committed)}
          hint={`${plural(orgs.filter((o) => stage(o)?.won).length, ["investor", "investors"], ["Investor", "Investoren"])}${extra ? tr(`, incl. ${money(extra)} not linked`, `, davon ${money(extra)} ohne Zuordnung`) : ""}`}
        />
        <Figure label="Term Sheets" value={money(termsheet)} hint={tr(`${orgs.filter((o) => o.stage === "termsheet").length} open`, `${orgs.filter((o) => o.stage === "termsheet").length} offen`)} />
        <Figure label={tr("Weighted pipeline", "Gewichtete Pipeline")} value={money(weighted)} hint={tr("Ticket × probability", "Ticket × Wahrscheinlichkeit")} />
        <Figure label={tr("Still open", "Noch offen")} value={target ? money(Math.max(0, target - committed)) : "–"} hint={tr(`${active.length} in conversation`, `${active.length} in Gesprächen`)} />
      </div>
      <RoundDialog open={edit} onOpenChange={setEdit} round={round} />
    </section>
  );
}

function RoundDialog({ open, onOpenChange, round }: { open: boolean; onOpenChange: (v: boolean) => void; round?: Round }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [extra, setExtra] = useState("");
  const [pre, setPre] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(round?.name ?? tr("Seed round", "Seed-Runde"));
      setTarget(amountInput(round?.targetMio));
      setExtra(amountInput(round?.committedExtraMio));
      setPre(amountInput(round?.preMoneyMio));
    }
  }, [open, round]);
  async function save() {
    setBusy(true);
    try {
      await api.patch("/api/orgs/round", { name: name.trim() || tr("Funding round", "Finanzierungsrunde"), targetMio: parseAmount(target), committedExtraMio: parseAmount(extra), preMoneyMio: parseAmount(pre) });
      qc.invalidateQueries({ queryKey: ["org-round"] });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const amount = (id: string, value: string, set: (v: string) => void, placeholder: string) => (
    <div className="relative">
      <input id={id} inputMode="decimal" className="field pr-[72px]" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">{tr("€m", "Mio. €")}</span>
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tr("Funding round", "Finanzierungsrunde")} variant="dialog">
      <div className="space-y-4">
        <Field label={tr("Name", "Bezeichnung")} htmlFor="r-name">
          <input id="r-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Seed round", "z. B. Seed-Runde")} />
        </Field>
        <Field label={tr("Target size", "Zielvolumen")} htmlFor="r-target">
          {amount("r-target", target, setTarget, tr("e.g. 2.5", "z. B. 2,5"))}
        </Field>
        <Field
          label={tr("Already committed, not linked", "Bereits zugesagt, ohne Zuordnung")}
          htmlFor="r-extra"
          hint={tr("Commitments not (yet) linked to an investor in the intranet. Counts toward the committed amount.", "Zusagen, die (noch) keinem Investor im Intranet zugeordnet sind. Zählt zum zugesagten Betrag.")}
        >
          {amount("r-extra", extra, setExtra, tr("e.g. 1", "z. B. 1"))}
        </Field>
        <Field label={tr("Pre-money valuation", "Pre-Money-Bewertung")} htmlFor="r-pre">
          {amount("r-pre", pre, setPre, tr("e.g. 10", "z. B. 10"))}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {tr("Save", "Speichern")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Partners: pipeline by stage – the further right, the closer to a live partnership. */
function PartnerSummary({ orgs, meta }: { orgs: Org[]; meta: OrgMeta }) {
  const stages = meta.stages.partner.filter((s) => !s.closed && !s.won);
  const byStage = stages.map((s) => ({ s, n: orgs.filter((o) => o.stage === s.id).length }));
  const active = orgs.filter((o) => stages.some((s) => s.id === o.stage));
  const live = orgs.filter((o) => stageOf(meta, "partner", o.stage)?.won).length;
  const types = new Map<string, number>();
  for (const o of active) types.set(o.type, (types.get(o.type) ?? 0) + 1);
  const shades = ["bg-brand/20", "bg-brand/35", "bg-brand/55", "bg-brand/75", "bg-brand"];
  const total = active.length || 1;
  return (
    <section className="card p-4 sm:p-5" aria-label={tr("Partner pipeline", "Partner-Pipeline")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-bold">Pipeline</h2>
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-ink">{active.length}</span> {tr("partners in talks,", "Partner im Gespräch,")} <span className="font-semibold text-ink">{live}</span> {tr("live", "aktiv")}
        </p>
      </div>
      {active.length > 0 && (
        <>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-surface2" role="img" aria-label={byStage.map((b) => `${b.s.label}: ${b.n}`).join(", ")}>
            {byStage.map((b, i) => (b.n > 0 ? <div key={b.s.id} className={cx("h-full border-r border-surface last:border-r-0", shades[i])} style={{ width: `${(b.n / total) * 100}%` }} /> : null))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            {byStage.map((b, i) => (
              <li key={b.s.id} className="inline-flex items-center gap-1.5">
                <span className={cx("h-2 w-2 rounded-full", shades[i])} aria-hidden /> {b.s.label} <span className="text-ink">{b.n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label={tr("In talks", "Im Gespräch")} value={active.length} hint={`${tr("of", "von")} ${plural(orgs.length, ["partner", "partners"], ["Partner", "Partner"])}`} />
        <Figure label={tr("Live partners", "Aktive Partner")} value={live} />
        {[...types.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([t, n]) => (
            <Figure key={t} label={meta.types.partner[t] ?? t} value={n} hint={tr("in talks", "im Gespräch")} />
          ))}
      </div>
    </section>
  );
}

/* ---------- Pipeline board ---------- */

const COLUMN_STEP = 25;
const PRIO_RANK: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2 };
/** Within a column: priority, then fit for nalpia, then due next step, then last edited */
const boardOrder = (a: Org, b: Org) =>
  (PRIO_RANK[a.priority] ?? 1) - (PRIO_RANK[b.priority] ?? 1) || (b.fitScore ?? -1) - (a.fitScore ?? -1) || (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || b.updatedAt - a.updatedAt;

function Board({ kind, orgs, meta, showClosed, onToggleClosed }: { kind: OrgKind; orgs: Org[]; meta: OrgMeta; showClosed: boolean; onToggleClosed: () => void }) {
  const qc = useQueryClient();
  const [over, setOver] = useState<string | null>(null);
  const [limit, setLimit] = useState<Record<string, number>>({});
  const dragging = useRef<string | null>(null);
  const stages = meta.stages[kind].filter((s) => showClosed || !s.closed);
  const closedCount = orgs.filter((o) => stageOf(meta, kind, o.stage)?.closed).length;

  async function move(id: string, stage: string) {
    const o = orgs.find((x) => x.id === id);
    if (!o || o.stage === stage) return;
    // Move optimistically
    qc.setQueriesData<Org[]>({ queryKey: ["orgs"] }, (list) => (Array.isArray(list) ? list.map((x) => (x.id === id ? { ...x, stage } : x)) : list));
    try {
      await api.patch(`/api/orgs/${id}`, { stage });
      toast.success(`${o.name}: ${stageOf(meta, kind, stage)?.label}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      qc.invalidateQueries({ queryKey: ["org", id] });
    }
  }

  function onDrop(e: DragEvent, stage: string) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/org") || e.dataTransfer.getData("text/plain") || dragging.current || "";
    dragging.current = null;
    void move(id, stage);
  }

  return (
    <div className="space-y-2">
      <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 lg:-mx-8 lg:px-8">
        {stages.map((s) => {
          const items = orgs.filter((o) => o.stage === s.id).sort(boardOrder);
          const total = sum(items.map((o) => (s.won ? (o.committedMio ?? o.potentialMio) : o.potentialMio)));
          return (
            <section
              key={s.id}
              aria-label={s.label}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s.id);
              }}
              onDragLeave={() => setOver((x) => (x === s.id ? null : x))}
              onDrop={(e) => onDrop(e, s.id)}
              className={cx(
                "flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl p-2.5 transition sm:w-[272px]",
                s.won ? "bg-pos-soft/60" : s.closed ? "bg-surface2/40" : "bg-surface2/70",
                over === s.id && "ring-2 ring-info",
              )}
            >
              <h2 className="flex items-baseline gap-2 px-1.5 pb-2 pt-1">
                <span className="text-sm font-bold">{s.label}</span>
                <span className="text-[12px] font-medium text-muted">{items.length}</span>
                {total > 0 && <span className="ml-auto text-[12px] font-semibold text-muted">{money(total, { short: true })}</span>}
              </h2>
              <div className="flex min-h-[120px] flex-col gap-2">
                {items.slice(0, limit[s.id] ?? COLUMN_STEP).map((o) => (
                  <OrgCard
                    key={o.id}
                    org={o}
                    onDragStart={(e) => {
                      dragging.current = o.id;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/org", o.id);
                      e.dataTransfer.setData("text/plain", o.id);
                    }}
                    onDragEnd={() => {
                      dragging.current = null;
                      setOver(null);
                    }}
                  />
                ))}
                {items.length > (limit[s.id] ?? COLUMN_STEP) && (
                  <button
                    type="button"
                    className="rounded-xl border border-dashed border-line py-2.5 text-[13px] font-semibold text-muted hover:border-muted/50 hover:text-ink"
                    onClick={() => setLimit((l) => ({ ...l, [s.id]: (l[s.id] ?? COLUMN_STEP) + COLUMN_STEP * 2 }))}
                  >
                    {tr(`Show ${items.length - (limit[s.id] ?? COLUMN_STEP)} more`, `${items.length - (limit[s.id] ?? COLUMN_STEP)} weitere zeigen`)}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <button className="link text-[13px]" onClick={onToggleClosed}>
        {showClosed ? tr("Hide paused and declined", "Pausierte und abgesagte ausblenden") : tr(`Show paused and declined (${closedCount})`, `Pausierte und abgesagte zeigen (${closedCount})`)}
      </button>
    </div>
  );
}

function OrgCard({ org: o, onDragStart, onDragEnd }: { org: Org; onDragStart: (e: DragEvent) => void; onDragEnd: () => void }) {
  const users = useUserMap();
  const meta = useOrgMeta().data;
  const navigate = useNavigate();
  const owner = o.ownerId ? users.get(o.ownerId) : undefined;
  const d = dueInfo(o.nextDate);
  const amount = headlineAmount(o);
  const href = `${ORG_KIND[o.kind].path}/${o.id}`;
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => navigate(href)}
      className="cursor-pointer rounded-xl border border-line bg-surface p-3 transition hover:border-muted/40 active:scale-[.99]"
    >
      <div className="flex items-start gap-2">
        <Link to={href} onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1 rounded text-[14px] font-semibold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          {o.name}
        </Link>
        {o.priority === "hoch" && <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", PRIORITY.hoch?.dot)} aria-label={tr("High priority", "Hohe Priorität")} />}
      </div>
      <p className="mt-0.5 truncate text-[12.5px] text-muted">{[meta?.types[o.kind][o.type], o.city].filter(Boolean).join(", ")}</p>
      {(amount || (o.kind === "investor" && o.fitScore !== null)) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px]">
          {o.kind === "investor" && o.fitScore !== null && <FitBadge org={o} />}
          {amount && (
            <span>
              <span className="text-muted">{amount.label}</span> <span className="font-semibold">{amount.value}</span>
              {o.probability !== null && o.probability > 0 && o.probability < 100 && <span className="text-muted">, {pctText(o.probability)}</span>}
            </span>
          )}
          {o.kind === "investor" && o.outreachStatus && <OutreachPill status={o.outreachStatus} meta={meta} />}
        </p>
      )}
      {(o.nextStep || owner) && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-muted">
            <Tx text={o.nextStep} />
            {o.nextDate && <span className={cx("ml-1", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" ? "font-semibold text-accent-ink" : "")}>({d.label})</span>}
          </span>
          {owner && <Avatar name={owner.name} color={owner.avatarColor} src={owner.avatarUrl} size={22} />}
        </div>
      )}
    </article>
  );
}

/* ---------- List ---------- */

function OrgList({ kind, orgs, meta, sort, onSort, resetKey }: { kind: OrgKind; orgs: Org[]; meta: OrgMeta; sort: Sort; onSort: (s: Sort) => void; resetKey: string }) {
  const users = useUserMap();
  const navigate = useNavigate();
  const sorted = useMemo(() => {
    const l = [...orgs];
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name, getLang()));
    if (sort === "betrag") l.sort((a, b) => (b.committedMio ?? b.potentialMio ?? 0) - (a.committedMio ?? a.potentialMio ?? 0));
    if (sort === "fit") l.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || a.name.localeCompare(b.name, getLang()));
    if (sort === "naechster") l.sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999"));
    return l;
  }, [orgs, sort]);
  const paged = usePaged(sorted, 100, `${resetKey}|${sort}`);
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Select className="w-[230px]" value={sort} onChange={(e) => onSort(e.target.value as Sort)} aria-label={tr("Sort by", "Sortierung")}>
          {kind === "investor" && <option value="fit">{tr("Fit for nalpia", "Fit für nalpia")}</option>}
          <option value="aktualisiert">{tr("Last edited", "Zuletzt bearbeitet")}</option>
          <option value="naechster">{tr("Next step", "Nächster Schritt")}</option>
          <option value="betrag">{kind !== "investor" ? tr("Volume", "Volumen") : "Ticket"}</option>
          <option value="name">Name</option>
        </Select>
      </div>
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_120px_minmax(0,1.8fr)_110px_20px] gap-4 border-b border-line bg-surface2/50 px-4 py-2 text-[12px] font-semibold text-muted md:grid">
          <span>Name</span>
          <span>Status</span>
          <span className="text-right">{kind === "investor" ? tr("Fit · Ticket", "Fit · Ticket") : tr("Volume", "Volumen")}</span>
          <span>{tr("Next step", "Nächster Schritt")}</span>
          <span>{tr("Owner", "Zuständig")}</span>
          <span />
        </div>
        <ul>
          {paged.visible.map((o) => {
            const st = stageOf(meta, kind, o.stage);
            const owner = o.ownerId ? users.get(o.ownerId) : undefined;
            const d = dueInfo(o.nextDate);
            const amount = headlineAmount(o);
            return (
              <li key={o.id}>
                <button
                  onClick={() => navigate(`${ORG_KIND[kind].path}/${o.id}`)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface2/50 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_120px_minmax(0,1.8fr)_110px_20px] md:gap-4"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <OrgBadge name={o.name} kind={kind} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{o.name}</span>
                      <span className="block truncate text-[13px] text-muted">{[meta.types[kind][o.type], o.city].filter(Boolean).join(", ")}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1 justify-self-end md:justify-self-start">
                    <StagePill stage={st} />
                    {kind === "investor" && o.outreachStatus && <OutreachPill status={o.outreachStatus} meta={meta} />}
                  </span>
                  <span className="hidden flex-col items-end text-right text-[13.5px] font-semibold md:flex">
                    {kind === "investor" && <FitBadge org={o} />}
                    <span className={kind === "investor" ? "text-[12.5px] font-medium text-muted" : ""}>{amount?.value ?? (kind === "investor" ? "" : "–")}</span>
                  </span>
                  <span className="col-span-2 flex min-w-0 items-center gap-2 pl-12 text-[13px] md:col-span-1 md:pl-0">
                    {kind === "investor" && <span className="shrink-0 md:hidden"><FitBadge org={o} /></span>}
                    {amount && <span className="shrink-0 font-semibold md:hidden">{amount.value}</span>}
                    {o.nextStep && <span className="min-w-0 truncate"><Tx text={o.nextStep} /></span>}
                    {o.nextDate && <span className={cx("shrink-0", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" ? "font-semibold text-accent-ink" : "text-muted")}>{d.label}</span>}
                  </span>
                  <span className="hidden items-center gap-2 md:flex">
                    {owner ? (
                      <>
                        <Avatar name={owner.name} color={owner.avatarColor} src={owner.avatarUrl} size={24} />
                        <span className="truncate text-[13px]">{owner.name.split(" ")[0]}</span>
                      </>
                    ) : (
                      <span className="text-[13px] text-muted">–</span>
                    )}
                  </span>
                  <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
                </button>
              </li>
            );
          })}
        </ul>
        {paged.rest > 0 && (
          <div className="border-t border-line px-4 py-3 text-center">
            <MoreButton rest={paged.rest} step={100} onClick={paged.more} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Fit score for nalpia with the priority as a colored dot (the priority may have been set by hand). */
function FitBadge({ org: o }: { org: Pick<Org, "fitScore" | "priority"> }) {
  if (o.fitScore === null || o.fitScore === undefined) return <span className="text-muted">–</span>;
  const b = fitBucket(o.fitScore);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${b.label} · ${tr("Priority", "Priorität")}: ${PRIORITY[o.priority]?.label ?? o.priority}`}>
      <span className={cx("h-2 w-2 rounded-full", PRIORITY[o.priority]?.dot)} aria-hidden />
      <span className={cx("num font-semibold", b.tone)}>{o.fitScore}</span>
    </span>
  );
}

/** Outreach status of the fundraising agent */
function OutreachPill({ status, meta }: { status: string; meta: OrgMeta | undefined }) {
  if (!status) return null;
  return (
    <Pill className={cx("inline-flex items-center gap-1", OUTREACH_TONE[status] ?? "bg-surface2 text-muted")}>
      <Bot className="h-3 w-3" /> {meta?.outreachStatus?.[status] ?? status}
    </Pill>
  );
}

/** Detail page (investors): fit for nalpia, why, and the priority – adjustable by hand. */
function FitCard({ o, onPriority }: { o: Pick<Org, "fitScore" | "fitReasons" | "priority" | "priorityManual">; onPriority: (p: string) => void }) {
  const score = o.fitScore ?? 0;
  const b = fitBucket(o.fitScore);
  return (
    <section className="card p-4" aria-label={tr("Fit for nalpia", "Fit für nalpia")}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">{tr("Fit for nalpia", "Fit für nalpia")}</h2>
        <span className="text-[12.5px] text-muted">{tr("high from 70, medium from 50", "hoch ab 70, mittel ab 50")}</span>
      </div>
      <div className="mt-2 flex items-end gap-3">
        <p className="num text-[34px] font-extrabold leading-none tracking-[-0.03em]">{o.fitScore ?? "–"}</p>
        <p className="pb-1 text-[13px] text-muted">/ 100 · {b.label}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface2" role="img" aria-label={`${score} / 100`}>
        <div className={cx("h-full rounded-full", b.bar)} style={{ width: `${score}%` }} />
      </div>
      {o.fitReasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {o.fitReasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" aria-hidden />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <p className="label">{tr("Priority", "Priorität")}</p>
        <Segmented
          value={o.priority}
          onChange={(v) => v !== o.priority && onPriority(v)}
          options={(["hoch", "mittel", "niedrig"] as const).map((p) => ({ value: p, label: PRIORITY[p]!.label }))}
        />
        <p className="mt-1.5 text-[12.5px] text-muted">
          {o.priorityManual
            ? tr("Set by hand – recalculating the fit keeps it.", "Von Hand gesetzt – eine Neuberechnung des Fits ändert sie nicht.")
            : tr("Set automatically from the fit.", "Automatisch aus dem Fit gesetzt.")}
        </p>
      </div>
    </section>
  );
}

/** Detail page (investors): thematic and stage focus, region, history with SINTRO. */
function ProfileCard({ o, meta }: { o: OrgDetail; meta: OrgMeta }) {
  const rows: [string, ReactNode][] = [
    [tr("Thematic focus", "Thematischer Fokus"), o.focusTags.length ? o.focusTags.map((f) => <Pill key={f}>{meta.focusTags?.[f] ?? f}</Pill>) : null],
    [tr("Stage focus", "Phasenfokus"), o.stageFocus.length ? o.stageFocus.map((f) => <Pill key={f}>{meta.stageFocus?.[f] ?? f}</Pill>) : null],
    [tr("Regional focus", "Regionaler Fokus"), o.regionFocus || null],
    [tr("Earlier outcome", "Früheres Ergebnis"), o.priorOutcome ? (meta.priorOutcomes?.[o.priorOutcome] ?? o.priorOutcome) : null],
    [tr("History", "Vorgeschichte"), o.history ? <Tx text={o.history} /> : null],
  ];
  if (!rows.some(([, v]) => v)) return null;
  return (
    <section className="card p-4">
      <h2 className="section-title">{tr("Investor profile", "Investorenprofil")}</h2>
      <dl className="mt-2 space-y-2 text-[14px]">
        {rows.map(([k, v]) =>
          v ? (
            <div key={k} className="flex gap-3">
              <dt className="w-28 shrink-0 text-muted">{k}</dt>
              <dd className="flex min-w-0 flex-wrap gap-1 break-words">{v}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </section>
  );
}

/** Detail page (investors): what the fundraising agent has done for this organization. */
function OutreachCard({ o, meta, onRefresh }: { o: OrgDetail; meta: OrgMeta; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const latest = o.outreach[0];
  async function start() {
    setBusy(true);
    try {
      await api.post("/api/agent/outreach", { orgId: o.id });
      toast.success(tr("Draft created", "Entwurf erstellt"), { description: tr("Review it under Agent.", "Prüfe ihn unter Agent.") });
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title inline-flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-muted" /> {tr("Fundraising agent", "Fundraising-Agent")}
        </h2>
        {latest && <OutreachPill status={latest.status} meta={meta} />}
      </div>
      {!latest ? (
        <div className="mt-2">
          <p className="text-[13px] text-muted">
            {o.primaryEmail
              ? tr("Not in outreach yet. The agent researches the investor and writes a personal first mail for review.", "Noch nicht im Outreach. Der Agent recherchiert den Investor und schreibt eine persönliche Erstmail zur Prüfung.")
              : tr("Add a contact with an e-mail address first.", "Lege zuerst einen Ansprechpartner mit E-Mail-Adresse an.")}
          </p>
          {o.primaryEmail && (
            <Button size="sm" variant="secondary" className="mt-3" icon={<Bot className="h-4 w-4" />} onClick={start} loading={busy}>
              {tr("Draft first mail", "Erstmail entwerfen")}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2 text-[13.5px]">
          <p>
            <span className="text-muted">{tr("To", "An")}:</span> {latest.toName} <span className="text-muted">({latest.toEmail})</span>
          </p>
          <p>
            <span className="text-muted">{tr("Subject", "Betreff")}:</span> {latest.subject}
          </p>
          {latest.sentAt && (
            <p>
              <span className="text-muted">{tr("Sent", "Gesendet")}:</span> {relTime(latest.sentAt)}
              {latest.sequenceStep > 0 && tr(` · ${latest.sequenceStep} follow-up${latest.sequenceStep > 1 ? "s" : ""}`, ` · ${latest.sequenceStep} Follow-up${latest.sequenceStep > 1 ? "s" : ""}`)}
              {latest.nextActionAt && !latest.repliedAt && <span className="text-muted"> · {tr("next follow-up", "nächstes Follow-up")} {dueInfo(new Date(latest.nextActionAt).toISOString().slice(0, 10)).label}</span>}
            </p>
          )}
          {latest.replySummary && (
            <p className="rounded-lg bg-surface2/70 p-2.5">
              <b>{tr("Reply", "Antwort")} ({latest.replyKind}):</b> {latest.replySummary}
            </p>
          )}
          {latest.personal && !latest.sentAt && <p className="whitespace-pre-wrap rounded-lg bg-surface2/70 p-2.5 italic">{latest.personal}</p>}
          <Link to={`/agent?outreach=${latest.id}`} className="link inline-block text-[13px]">
            {tr("Open in the agent", "Im Agenten öffnen")}
          </Link>
        </div>
      )}
    </section>
  );
}

function StagePill({ stage }: { stage?: StageDef }) {
  if (!stage) return null;
  return <Pill className={stage.won ? "bg-pos-soft text-pos" : stage.closed ? "bg-surface2 text-muted" : "bg-info-soft text-info"}>{stage.label}</Pill>;
}

/** Monogram for organizations – square, to tell it apart from people avatars. */
function OrgBadge({ name, kind, size = 36 }: { name: string; kind: OrgKind; size?: number }) {
  const letters = name
    .replace(/^(dr\.|prof\.)\s*/i, "")
    .split(/[\s-]+/)
    .filter((w) => w && !/^(der|die|das|des|und|für|of|the|&)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cx("grid shrink-0 place-items-center rounded-[10px] font-bold tracking-[-0.02em]", kind === "investor" ? "bg-brand text-brand-ink" : "bg-[#0B6F76] text-white")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {letters || "?"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

interface ImportResult {
  dryRun: boolean;
  columns: string[];
  created: number;
  contacts: number;
  existing: number;
  errors: number;
  rows: { line: number; name: string; status: "neu" | "vorhanden" | "fehler"; message: string }[];
}

/** CSV template in the current language (the importer recognises both) */
const template = (kind: OrgKind) =>
  kind !== "investor"
    ? tr(
        "Name;Type;Status;City;Country;Website;Focus;Contact person;Email;Position;Notes\nExample Broker;Broker;In talks;Berlin;DE;example.com;Order routing API;Jane Example;jane@example.com;Head of Partnerships;\n",
        "Name;Typ;Status;Stadt;Land;Website;Fokus;Ansprechpartner;E-Mail;Position;Notizen\nMuster Broker;Broker;Im Gespräch;Berlin;DE;beispiel.de;Orderrouting-API;Erika Muster;erika@beispiel.de;Head of Partnerships;\n",
      )
    : tr(
        "Name;Type;Status;City;Country;Website;Ticket min (€m);Ticket max (€m);Focus;Stage focus;Regional focus;History;Contact person;Email;Position;Notes\nExample Ventures;VC;Identified;San Francisco;US;example.vc;0.1;1;Fintech, AI, consumer;Pre-seed, Seed;USA, global;;Max Example;max@example.vc;Partner;\n",
        "Name;Typ;Status;Stadt;Land;Website;Ticket min (Mio. €);Ticket max (Mio. €);Fokus;Phasenfokus;Regionaler Fokus;Vorgeschichte;Ansprechpartner;E-Mail;Position;Notizen\nMuster Ventures;VC;Identifiziert;San Francisco;US;beispiel.vc;0,1;1;Fintech, KI, Consumer;Pre-Seed, Seed;USA, global;;Max Beispiel;max@beispiel.vc;Partner;\n",
      );

function ImportSheet({ kind, open, onOpenChange }: { kind: OrgKind; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setFileName("");
      setPreview(null);
      setErr("");
    }
  }, [open]);

  async function readFile(f: File) {
    if (f.size > 850 * 1024) return setErr(tr("The file is too large (max. about 800 KB). Please split it into several files.", "Die Datei ist zu groß (max. ca. 800 KB). Bitte in mehrere Dateien aufteilen."));
    const buf = await f.arrayBuffer();
    // Excel often saves "CSV" as Windows-1252 – detect and decode correctly
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
    setText(t);
    setFileName(f.name);
    void run(t, true);
  }

  async function run(t: string, dryRun: boolean) {
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<ImportResult>("/api/orgs/import", { kind, text: t, dryRun });
      if (dryRun) setPreview(r);
      else {
        for (const k of ["orgs", "contacts", "home"]) qc.invalidateQueries({ queryKey: [k] });
        const what = kind !== "investor" ? plural(r.created, ["partner", "partners"], ["Partner", "Partner"]) : plural(r.created, ["investor", "investors"], ["Investor", "Investoren"]);
        const people = plural(r.contacts, ["contact", "contacts"], ["Ansprechpartner", "Ansprechpartner"]);
        toast.success(tr(`${what} imported`, `${what} importiert`), { description: r.contacts ? tr(`${people} created`, `${people} angelegt`) : undefined });
        onOpenChange(false);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tr("Import failed. Please check the file and try again.", "Import fehlgeschlagen. Bitte prüfe die Datei und versuch es noch einmal."));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + template(kind))}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tr(`Import ${ORG_KIND[kind].plural.toLowerCase()}`, `${ORG_KIND[kind].plural} importieren`)} size="lg">
      <div className="space-y-4">
        <p className="text-[14px] text-muted">
          {kind !== "investor"
            ? tr(
                'CSV file with one row per partner. Columns are detected automatically (e.g. name, type, status, city, focus, contact person, email). In Excel: File → Save As → "CSV UTF-8".',
                "CSV-Datei mit einer Zeile pro Partner. Die Spalten werden automatisch erkannt (z. B. Name, Typ, Status, Stadt, Fokus, Ansprechpartner, E-Mail). In Excel: Datei → Speichern unter → „CSV UTF-8“.",
              )
            : tr(
                'CSV file with one row per investor. Columns are detected automatically (e.g. name, type, status, city, ticket, focus, stage focus, history, contact person, email). Focus and stage ids and the fit for nalpia are derived on import. In Excel: File → Save As → "CSV UTF-8".',
                "CSV-Datei mit einer Zeile pro Investor. Die Spalten werden automatisch erkannt (z. B. Name, Typ, Status, Stadt, Ticket, Fokus, Phasenfokus, Vorgeschichte, Ansprechpartner, E-Mail). Fokus-/Phasen-Ids und der Fit für nalpia werden beim Import abgeleitet. In Excel: Datei → Speichern unter → „CSV UTF-8“.",
              )}{" "}
          <a className="link" href={templateHref} download={tr(`template-${kind === "investor" ? "investors" : "partners"}.csv`, `vorlage-${kind === "investor" ? "investoren" : "partner"}.csv`)}>
            {tr("Download template", "Vorlage herunterladen")}
          </a>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => file.current?.click()}>
            {tr("Choose CSV file", "CSV-Datei wählen")}
          </Button>
          {fileName && <span className="truncate text-[13px] text-muted">{fileName}</span>}
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void readFile(f);
            }}
          />
        </div>
        <Field label={tr("… or paste the content", "… oder Inhalt einfügen")} htmlFor="imp-text">
          <textarea
            id="imp-text"
            className="field min-h-[120px] text-[12.5px]"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            placeholder={tr("Name;Type;Status;City;…", "Name;Typ;Status;Stadt;…")}
          />
        </Field>
        {err && <p className="text-sm font-medium text-neg">{err}</p>}
        {preview && (
          <div className="space-y-2 rounded-2xl border border-line p-3">
            <p className="text-[14px]">
              <b>{preview.created}</b> {tr("new", "neu")}, <b>{preview.existing}</b> {tr("already exist", "schon vorhanden")}
              {preview.contacts > 0 && (
                <>
                  , <b>{preview.contacts}</b> {preview.contacts === 1 ? tr("new contact", "neuer Ansprechpartner") : tr("new contacts", "neue Ansprechpartner")}
                </>
              )}
              {preview.errors > 0 && (
                <span className="text-neg">
                  , <b>{preview.errors}</b> {preview.errors === 1 ? tr("row without a name", "Zeile ohne Namen") : tr("rows without a name", "Zeilen ohne Namen")}
                </span>
              )}
              .
            </p>
            <p className="text-[12.5px] text-muted">{tr("Detected columns:", "Erkannte Spalten:")} {preview.columns.join(", ")}</p>
            <ul className="max-h-[220px] divide-y divide-line overflow-auto text-[13px]">
              {preview.rows.slice(0, 60).map((r) => (
                <li key={r.line} className="flex gap-2 py-1.5">
                  <span className="w-10 shrink-0 text-muted">{r.line}</span>
                  <span className={cx("min-w-0 flex-1", r.status === "fehler" && "text-neg")}>
                    <b className="font-semibold">{r.name || "–"}</b> <span className="text-muted">{r.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          {!preview ? (
            <Button variant="primary" onClick={() => run(text, true)} loading={busy} disabled={!text.trim()}>
              {tr("Preview", "Vorschau")}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => run(text, false)} loading={busy} disabled={!preview.created && !preview.contacts}>
              {tr("Import", "Importieren")}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Detail page                                                         */
/* ------------------------------------------------------------------ */

const KIND_ICON = { notiz: StickyNote, mail: Mail, anruf: Phone, meeting: Users, status: ChevronRight, dokument: FileText } as const;
const kindLabel = (k: string): string | undefined =>
  ({ notiz: tr("Note", "Notiz"), mail: tr("Email", "E-Mail"), anruf: tr("Call", "Anruf"), meeting: "Meeting", status: "Status", dokument: tr("Document", "Dokument") })[k];

export function OrgDetailPage({ kind }: { kind: OrgKind }) {
  useTxVersion(); // re-render when translated content arrives
  const { id } = useParams();
  const { data: o, isLoading, error } = useOrg(id);
  const meta = useOrgMeta().data;
  const users = useUserMap();
  const me = useMe().data?.user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const [entryKind, setEntryKind] = useState<"notiz" | "anruf" | "meeting" | "dokument">("notiz");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const base = ORG_KIND[kind];

  if (isLoading || !meta) return <Skeleton className="h-96" />;
  if (error || !o || o.kind !== kind)
    return (
      <EmptyState
        title={tr("Not found", "Nicht gefunden")}
        text={(error as Error)?.message ?? tr("This entry doesn't exist here.", "Diesen Eintrag gibt es hier nicht.")}
        action={
          <Link to={base.path} className="link">
            {tr("Back to overview", "Zur Übersicht")}
          </Link>
        }
      />
    );

  const stages = meta.stages[kind];
  const cur = stages.findIndex((s) => s.id === o.stage);
  const owner = o.ownerId ? users.get(o.ownerId) : undefined;
  const d = dueInfo(o.nextDate);
  const mainContact = o.contacts.find((c) => c.email);
  const refresh = () => {
    for (const k of [["org", o.id], ["orgs"], ["home"], ["contacts"]]) qc.invalidateQueries({ queryKey: k });
  };
  async function patch(p: Record<string, unknown>) {
    try {
      await api.patch(`/api/orgs/${o!.id}`, p);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function addEntry() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/orgs/${o!.id}/activities`, { kind: entryKind, body: note.trim() });
      setNote("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function removeEntry(a: OrgActivity) {
    try {
      await api.del(a.source === "org" ? `/api/orgs/${o!.id}/activities/${a.id}` : `/api/contacts/${a.contactId}/activities/${a.id}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function unlink(contactId: string, name: string) {
    if (!window.confirm(tr(`Remove ${name} as a contact for this organization? The contact itself is kept.`, `${name} nicht mehr als Ansprechpartner führen? Der Kontakt selbst bleibt erhalten.`))) return;
    await api.del(`/api/orgs/${o!.id}/contacts/${contactId}`);
    refresh();
  }
  async function remove() {
    if (!window.confirm(
        tr(
          `Delete "${o!.name}"? Its activity and links will be lost. Contact people are kept as contacts.`,
          `„${o!.name}“ wirklich löschen? Verlauf und Zuordnungen gehen verloren. Ansprechpartner bleiben als Kontakte erhalten.`,
        ),
      )) return;
    try {
      await api.del(`/api/orgs/${o!.id}`);
      qc.invalidateQueries({ queryKey: ["orgs"] });
      toast(tr("Deleted", "Gelöscht"), { description: o!.name });
      navigate(base.path);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const canDelete = me && (me.role === "admin" || o.ownerId === me.id || o.createdBy === me.id);

  const figures: { label: string; value: string }[] =
    kind !== "investor"
      ? [
          { label: tr("Potential volume", "Mögliches Volumen"), value: money(o.potentialMio) },
          { label: tr("Contract value", "Vertragswert"), value: money(o.committedMio) },
          { label: tr("Probability", "Wahrscheinlichkeit"), value: o.probability !== null ? pctText(o.probability) : "–" },
          { label: tr("Last contact", "Letzter Kontakt"), value: o.lastContactAt ? relTime(o.lastContactAt) : "–" },
        ]
      : [
          { label: tr("Ticket range", "Ticket-Spanne"), value: ticketRange(o) },
          { label: tr("Expected ticket", "Erwartetes Ticket"), value: money(o.potentialMio) },
          { label: tr("Probability", "Wahrscheinlichkeit"), value: o.probability !== null ? pctText(o.probability) : "–" },
          { label: tr("Committed", "Zugesagt"), value: money(o.committedMio) },
        ];

  return (
    <div className="space-y-4">
      <Link to={base.path} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> {base.plural}
      </Link>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <header className="card p-5">
            <div className="flex items-start gap-4">
              <OrgBadge name={o.name} kind={kind} size={56} />
              <div className="min-w-0 flex-1">
                <h1 className="text-[21px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[24px]">{o.name}</h1>
                <p className="text-[14.5px] text-muted">{[meta.types[kind][o.type], [o.city, o.country].filter(Boolean).join(", ")].filter(Boolean).join(" in ")}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StagePill stage={stages[cur]} />
                  {kind === "investor" && o.outreachStatus && <OutreachPill status={o.outreachStatus} meta={meta} />}
                  {o.priority === "hoch" && <Pill className="bg-neg-soft text-neg">{tr("High priority", "Hohe Priorität")}</Pill>}
                  {o.tags.map((t) => (
                    <Pill key={t}><Tx text={t} /></Pill>
                  ))}
                </div>
              </div>
              <IconButton label={tr("Edit", "Bearbeiten")} onClick={() => open({ kind: "org", orgKind: kind, id: o.id })}>
                <Pencil className="h-[18px] w-[18px]" />
              </IconButton>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {mainContact && (
                <Button size="sm" variant="primary" icon={<Mail className="h-4 w-4" />} onClick={() => open({ kind: "compose", defaults: { to: [mainContact.email] } })}>
                  {tr(`Email ${mainContact.name.split(" ").slice(-1)[0]}`, `E-Mail an ${mainContact.name.split(" ").slice(-1)[0]}`)}
                </Button>
              )}
              {o.website && (
                <a href={o.website} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-surface2">
                  <Globe className="h-4 w-4" /> Website
                </a>
              )}
              {o.linkedin && (
                <a href={o.linkedin} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-surface2">
                  <Linkedin className="h-4 w-4" /> LinkedIn
                </a>
              )}
              <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "task", defaults: { organizationId: o.id, title: o.nextStep || "" } })}>
                {tr("Task", "Aufgabe")}
              </Button>
            </div>
            <div className="mt-5">
              <p className="label">Status</p>
              <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
                {stages.map((s, i) => {
                  const on = s.id === o.stage;
                  return (
                    <button
                      key={s.id}
                      onClick={() => !on && patch({ stage: s.id })}
                      aria-pressed={on}
                      className={cx(
                        "h-8 shrink-0 rounded-full border px-3 text-[13px] font-semibold transition",
                        on
                          ? s.won
                            ? "border-pos bg-pos text-white"
                            : s.closed
                              ? "border-muted bg-muted text-white"
                              : "border-brand bg-brand text-brand-ink"
                          : !s.closed && !stages[cur]?.closed && i < cur
                            ? "border-brand/30 bg-info-soft/60 text-brand"
                            : "border-line bg-surface text-muted hover:text-ink",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
              {figures.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[12.5px] text-muted">{f.label}</dt>
                  <dd className="mt-0.5 truncate text-[17px] font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
          </header>

          <section className="card p-4 sm:p-5">
            <h2 className="section-title">{tr("Activity", "Verlauf")}</h2>
            <div className="mt-3 rounded-xl border border-line bg-bg/60 p-2.5">
              <div className="scrollbar-none mb-2 flex gap-1.5 overflow-x-auto">
                {(["notiz", "anruf", "meeting", "dokument"] as const).map((k) => {
                  const I = KIND_ICON[k];
                  return (
                    <button
                      key={k}
                      onClick={() => setEntryKind(k)}
                      aria-pressed={entryKind === k}
                      className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold", entryKind === k ? "bg-brand text-brand-ink" : "text-muted hover:bg-surface2")}
                    >
                      <I className="h-3.5 w-3.5" /> {kindLabel(k)}
                    </button>
                  );
                })}
              </div>
              <textarea
                className="field min-h-[70px] bg-surface"
                aria-label={tr("Entry", "Eintrag")}
                placeholder={
                  entryKind === "anruf"
                    ? tr("What was the call about?", "Worum ging es im Telefonat?")
                    : entryKind === "meeting"
                      ? tr("Attendees and outcomes", "Teilnehmende und Ergebnisse")
                      : entryKind === "dokument"
                        ? tr("Which document was sent or received?", "Welches Dokument wurde geschickt oder empfangen?")
                        : tr("Add a note", "Notiz hinzufügen")
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addEntry();
                }}
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" variant="primary" onClick={addEntry} loading={busy} disabled={!note.trim()}>
                  {tr("Save", "Speichern")}
                </Button>
              </div>
            </div>
            {o.activities.length === 0 ? (
              <p className="py-4 text-sm text-muted">{tr("No entries yet. You can save emails with contacts to the activity straight from Mail.", "Noch keine Einträge. Mails an Ansprechpartner lassen sich direkt aus dem Postfach im Verlauf speichern.")}</p>
            ) : (
              <ol className="mt-4">
                {o.activities.map((a) => {
                  const u = a.userId ? users.get(a.userId) : undefined;
                  const I = KIND_ICON[a.kind] ?? MessageSquare;
                  return (
                    <li key={a.id} className="group relative flex gap-3 pb-4 last:pb-0">
                      <span className="absolute bottom-0 left-[15px] top-8 w-px bg-line group-last:hidden" aria-hidden />
                      <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", a.kind === "status" ? "bg-surface2 text-muted" : "bg-info-soft text-info")}>
                        <I className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1 pt-1">
                        <p className="text-[12.5px] text-muted">
                          <b className="text-ink">{kindLabel(a.kind) ?? a.kind}</b>
                          {a.contactName && (
                            <>
                              {" "}
                              {tr("with", "mit")}{" "}
                              <Link className="font-semibold text-ink hover:underline" to={`/kontakte/${a.contactId}`}>
                                {a.contactName}
                              </Link>
                            </>
                          )}
                          {u ? `, ${u.name.split(" ")[0]}` : ""}, {relTime(a.createdAt)}
                        </p>
                        <p className={cx("mt-1 whitespace-pre-wrap text-[14px] leading-relaxed", a.kind === "mail" && "line-clamp-6")}><Tx text={a.body} /></p>
                        {a.mailRef && a.mailRef.ownerId === me?.id && (
                          <Link to={`/postfach?f=${a.mailRef.folderId}&m=${a.mailRef.messageId}`} className="link mt-1 inline-block text-[12.5px]">
                            {tr("Open in Mail", "Im Postfach öffnen")}
                          </Link>
                        )}
                      </div>
                      {(a.userId === me?.id || me?.role === "admin") && a.kind !== "status" && (
                        <IconButton label={tr("Delete entry", "Eintrag löschen")} size="sm" className="opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={() => removeEntry(a)}>
                          <Trash2 className="h-4 w-4 text-muted" />
                        </IconButton>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4">
          {kind === "investor" && <FitCard o={o} onPriority={(p) => patch({ priority: p })} />}
          {kind === "investor" && <OutreachCard o={o} meta={meta} onRefresh={refresh} />}
          {kind === "investor" && <ProfileCard o={o} meta={meta} />}
          <section className="card p-4">
            <h2 className="section-title">{tr("Next step", "Nächster Schritt")}</h2>
            <input
              className="field mt-2"
              defaultValue={o.nextStep}
              key={`ns-${o.updatedAt}`}
              placeholder={tr("What needs to happen next?", "Was ist als Nächstes zu tun?")}
              onBlur={(e) => e.target.value !== o.nextStep && patch({ nextStep: e.target.value })}
              aria-label={tr("Next step", "Nächster Schritt")}
            />
            <div className="mt-2 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted" />
              <input type="date" className="field field-sm flex-1" value={o.nextDate ?? ""} onChange={(e) => patch({ nextDate: e.target.value || null })} aria-label={tr("Due by", "Bis wann")} />
              {o.nextDate && <span className={cx("text-[12.5px]", d.tone === "over" ? "font-semibold text-neg" : d.tone === "today" ? "font-semibold text-accent-ink" : "text-muted")}>{d.label}</span>}
            </div>
            <div className="mt-4">
              <p className="label">{tr("Owner", "Zuständig")}</p>
              <Select value={o.ownerId ?? ""} onChange={(e) => patch({ ownerId: e.target.value || null })} aria-label={tr("Owner", "Zuständig")}>
                <option value="">{tr("Nobody", "Niemand")}</option>
                {[...users.values()].map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
              {owner?.title && <p className="mt-1 text-[12.5px] text-muted"><Tx text={owner.title} /></p>}
            </div>
          </section>

          <section className="card px-4 pb-3 pt-3.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="section-title">{tr("Contacts", "Ansprechpartner")}</h2>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Link2 className="h-4 w-4" />} onClick={() => setLinkOpen(true)}>
                  {tr("Link", "Verknüpfen")}
                </Button>
                <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "contact", defaults: { organizationId: o.id, company: o.name, category: kind, ownerId: o.ownerId } })}>
                  {tr("New", "Neu")}
                </Button>
              </div>
            </div>
            {o.contacts.length === 0 ? (
              <p className="py-3 text-sm text-muted">{tr("No contacts added yet.", "Noch keine Ansprechpartner hinterlegt.")}</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {o.contacts.map((c) => (
                  <li key={c.id} className="group flex items-center gap-3 py-2.5">
                    <Avatar name={c.name} color={kind === "investor" ? "navy" : "teal"} size={34} />
                    <Link to={`/kontakte/${c.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold hover:underline">{c.name}</span>
                      <span className="block truncate text-[12.5px] text-muted">{c.position ? <Tx text={c.position} /> : c.email || "–"}</span>
                    </Link>
                    {c.email && (
                      <IconButton label={tr(`Email ${c.name}`, `E-Mail an ${c.name}`)} size="sm" onClick={() => open({ kind: "compose", defaults: { to: [c.email] } })}>
                        <Mail className="h-4 w-4" />
                      </IconButton>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone.replace(/\s+/g, "")}`} aria-label={tr(`Call ${c.name}`, `${c.name} anrufen`)} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink">
                        <Phone className="h-4 w-4" />
                      </a>
                    )}
                    <IconButton label={tr(`Unlink ${c.name}`, `${c.name} lösen`)} size="sm" className="opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={() => unlink(c.id, c.name)}>
                      <Unlink className="h-4 w-4 text-muted" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card px-4 pb-2 pt-3.5">
            <div className="flex items-center justify-between">
              <h2 className="section-title">{tr("Tasks", "Aufgaben")}</h2>
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "task", defaults: { organizationId: o.id } })}>
                {tr("New", "Neu")}
              </Button>
            </div>
            {o.tasks.length === 0 ? <p className="py-3 text-sm text-muted">{tr("No linked tasks.", "Keine Aufgaben verknüpft.")}</p> : o.tasks.map((t) => <TaskRow key={t.id} task={t} showContext={false} />)}
          </section>

          <section className="card p-4">
            <h2 className="section-title">Details</h2>
            <dl className="mt-2 space-y-2 text-[14px]">
              {(
                [
                  [kind !== "investor" ? tr("What they offer", "Angebot") : tr("Focus", "Fokus"), txNow(o.focus)],
                  [tr("Fund size", "Fondsgröße"), kind === "investor" && o.aumMio ? money(o.aumMio) : ""],
                  [tr("Source", "Quelle"), o.source],
                  ["Website", o.website ? o.website.replace(/^https?:\/\//, "") : ""],
                  [tr("Last contact", "Letzter Kontakt"), o.lastContactAt ? relTime(o.lastContactAt) : ""],
                  [tr("Created", "Angelegt"), relTime(o.createdAt)],
                ] as const
              ).map(([k, v]) =>
                v ? (
                  <div key={k} className="flex gap-3">
                    <dt className="w-28 shrink-0 text-muted">{k}</dt>
                    <dd className="min-w-0 break-words">
                      {k === "Website" ? (
                        <a href={o.website} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                          {v} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        v
                      )}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
            <p className="label mt-4">{tr("Notes", "Notizen")}</p>
            <textarea className="field min-h-[110px]" defaultValue={o.notes} key={`n-${o.updatedAt}`} onBlur={(e) => e.target.value !== o.notes && patch({ notes: e.target.value })} aria-label={tr("Notes", "Notizen")} />
            <TxNote text={o.notes} />
            {canDelete && (
              <Button variant="ghost" size="sm" className="mt-3 text-neg" icon={<Trash2 className="h-4 w-4" />} onClick={remove}>
                {tr("Delete", "Löschen")}
              </Button>
            )}
          </section>
        </aside>
      </div>
      <LinkContactSheet orgId={o.id} open={linkOpen} onOpenChange={setLinkOpen} onDone={refresh} />
    </div>
  );
}

/** Link an existing contact to this organization. */
function LinkContactSheet({ orgId, open, onOpenChange, onDone }: { orgId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  useTxVersion();
  const [q, setQ] = useState("");
  const { data } = useContacts({ q: q.trim() || undefined });
  const list = (data ?? []).filter((c) => c.organizationId !== orgId).slice(0, 40);
  async function pick(id: string) {
    try {
      await api.post(`/api/orgs/${orgId}/contacts`, { contactId: id });
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={tr("Link contact", "Kontakt verknüpfen")} variant="dialog">
      <div className="space-y-3">
        <div className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3">
          <Search className="h-4 w-4 text-muted" />
          <input autoFocus className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" placeholder={tr("Name, company or email", "Name, Firma oder E-Mail")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search contacts", "Kontakte suchen")} />
        </div>
        <ul className="max-h-[50vh] divide-y divide-line overflow-auto">
          {list.map((c) => (
            <li key={c.id}>
              <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-surface2/50" onClick={() => pick(c.id)}>
                <Avatar name={c.name} color="slate" size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {[txNow(c.position), c.company].filter(Boolean).join(", ") || c.email}
                    {c.organizationName && tr(`, currently at ${c.organizationName}`, `, derzeit bei ${c.organizationName}`)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="py-4 text-center text-sm text-muted">{tr("No matching contacts.", "Keine passenden Kontakte.")}</li>}
        </ul>
      </div>
    </Sheet>
  );
}
