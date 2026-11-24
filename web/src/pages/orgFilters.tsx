import { SlidersHorizontal, X } from "lucide-react";
import { useMemo } from "react";
import { Select } from "@/components/pickers";
import { cx } from "@/components/ui";
import { getLang, locale, tr } from "@/lib/i18n";
import type { Org, OrgKind, OrgMeta } from "@/lib/types";

/** Extra filters for the investor and partner lists. Everything runs in the browser on the loaded list. */

export interface OrgFilterState {
  status: string; // stage id, "_aktiv" (excluding paused/declined/won) or ""
  region: string; // "r:dach" | "c:DE" | ""
  ticket: string; // bucket id from TICKET_BUCKETS or ""
  tag: string;
  city: string;
  contact: string; // "nie" | "7" | "30" | "alt" | ""
  focus: string; // thematic focus id (investors)
  stageFocus: string; // stage focus id (investors)
  fit: string; // "hoch" | "mittel" | "niedrig" | "" (investors)
  outreach: string; // outreach status id, "ohne" or "" (investors)
  prior: string; // prior outcome id, "ohne", "warm" or "" (investors)
}

export const FILTER_KEYS: (keyof OrgFilterState)[] = ["status", "region", "ticket", "tag", "city", "contact", "focus", "stageFocus", "fit", "outreach", "prior"];
const PARAM: Record<keyof OrgFilterState, string> = {
  status: "status",
  region: "region",
  ticket: "ticket",
  tag: "tag",
  city: "ort",
  contact: "kontakt",
  focus: "fokus",
  stageFocus: "phase",
  fit: "fit",
  outreach: "outreach",
  prior: "vorher",
};

export function readFilters(p: URLSearchParams): OrgFilterState {
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(PARAM[k]) ?? ""])) as unknown as OrgFilterState;
}
export const filterParam = (k: keyof OrgFilterState) => PARAM[k];

/* ---------- Regions ---------- */

const REGIONS: { id: string; readonly label: string; codes: string[] }[] = [
  { id: "bayarea", get label() { return tr("San Francisco Bay Area", "San Francisco Bay Area"); }, codes: [] },
  { id: "nordamerika", get label() { return tr("North America", "Nordamerika"); }, codes: ["US", "CA"] },
  { id: "dach", label: "DACH", codes: ["DE", "AT", "CH", "LI"] },
  {
    id: "europa",
    get label() {
      return tr("Europe excl. DACH", "Europa ohne DACH");
    },
    codes: "GB IE FR BE NL LU ES PT IT MT SE NO DK FI IS EE LV LT PL CZ SK HU SI HR RO BG GR CY RS UA BA ME MK AL MD MC AD SM VA".split(" "),
  },
  { id: "latam", get label() { return tr("Latin America", "Lateinamerika"); }, codes: "MX BR AR CL CO PE UY PY BO EC VE CR PA DO GT".split(" ") },
  { id: "apac", get label() { return tr("Asia-Pacific", "Asien-Pazifik"); }, codes: "CN JP KR SG HK TW IN AU NZ ID MY TH VN PH".split(" ") },
  { id: "mea", get label() { return tr("Middle East & Africa", "Naher Osten & Afrika"); }, codes: "IL AE SA QA BH KW OM TR EG ZA NG KE MA JO LB".split(" ") },
];
const BAY_AREA = /san francisco|palo alto|menlo park|mountain view|berkeley|oakland|san mateo|redwood city|sunnyvale|san jose|cupertino|los altos|burlingame|sausalito|woodside|atherton|bay area|silicon valley/i;
const isBayArea = (o: Pick<Org, "city" | "country">) => o.country.toUpperCase() === "US" && BAY_AREA.test(o.city);
const regionOf = (code: string) => REGIONS.find((r) => r.codes.includes(code.toUpperCase()))?.id ?? (code ? "sonst" : "");

// Keyed by language: a cached instance must not survive a language switch
let names: { lang: string; dn: Intl.DisplayNames } | null = null;
export function countryName(c: string) {
  if (!/^[A-Za-z]{2}$/.test(c)) return c;
  try {
    const lang = getLang();
    if (names?.lang !== lang) names = { lang, dn: new Intl.DisplayNames([lang], { type: "region" }) };
    return names.dn.of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
}

/* ---------- Ticket / volume buckets (€m) ---------- */

export const TICKET_BUCKETS = [
  { id: "bis100k", get label() { return tr("Up to €100k (angel)", "bis 100 Tsd. € (Angel)"); }, min: 0, max: 0.1 },
  { id: "100k-500k", get label() { return tr("€100k – €500k", "100 – 500 Tsd. €"); }, min: 0.1, max: 0.5 },
  { id: "500k-2m", get label() { return tr("€500k – €2m", "500 Tsd. – 2 Mio. €"); }, min: 0.5, max: 2 },
  { id: "2-5m", get label() { return tr("€2m – €5m", "2 – 5 Mio. €"); }, min: 2, max: 5 },
  { id: "ab5m", get label() { return tr("Over €5m", "über 5 Mio. €"); }, min: 5, max: Infinity },
];

/** Amount range of an organization: investors by ticket min/max, partners by potential or contract volume */
function amountRange(o: Org, kind: OrgKind): [number, number] | null {
  if (kind === "investor") {
    const lo = o.ticketMinMio ?? o.ticketMaxMio;
    const hi = o.ticketMaxMio ?? o.ticketMinMio;
    if (lo !== null && hi !== null) return [lo, hi];
    const v = o.committedMio ?? o.potentialMio;
    return v !== null ? [v, v] : null;
  }
  const v = o.potentialMio ?? o.committedMio;
  return v !== null ? [v, v] : null;
}

const WARM = new Set(["antwort", "call", "deck", "committed"]);

/* ---------- Apply ---------- */

const DAY = 86_400_000;

export function applyFilters(orgs: Org[], f: OrgFilterState, kind: OrgKind, meta: OrgMeta | undefined, now = Date.now()) {
  const stages = meta?.stages[kind] ?? [];
  const inactive = new Set(stages.filter((s) => s.closed || s.won).map((s) => s.id));
  const bucket = TICKET_BUCKETS.find((b) => b.id === f.ticket);
  return orgs.filter((o) => {
    if (f.status === "_aktiv" ? inactive.has(o.stage) : f.status && o.stage !== f.status) return false;
    if (f.region) {
      const [t, v] = [f.region.slice(0, 2), f.region.slice(2)];
      if (t === "c:" && o.country.toUpperCase() !== v.toUpperCase()) return false;
      if (t === "r:") {
        if (v === "ohne" ? o.country !== "" : v === "bayarea" ? !isBayArea(o) : regionOf(o.country) !== v) return false;
      }
    }
    if (f.ticket) {
      const r = amountRange(o, kind);
      if (f.ticket === "ohne") {
        if (r) return false;
      } else if (!r || !bucket || r[1] < bucket.min || r[0] >= bucket.max) return false;
    }
    if (f.tag && !o.tags.includes(f.tag)) return false;
    if (f.city && o.city !== f.city) return false;
    if (f.contact) {
      const last = o.lastContactAt;
      if (f.contact === "nie" && last) return false;
      if (f.contact === "7" && (!last || now - last > 7 * DAY)) return false;
      if (f.contact === "30" && (!last || now - last > 30 * DAY)) return false;
      if (f.contact === "alt" && (!last || now - last <= 30 * DAY)) return false;
    }
    if (f.focus && !(o.focusTags ?? []).includes(f.focus)) return false;
    if (f.stageFocus && !(o.stageFocus ?? []).includes(f.stageFocus)) return false;
    if (f.fit) {
      const s = o.fitScore ?? -1;
      if (f.fit === "hoch" && s < 70) return false;
      if (f.fit === "mittel" && (s < 50 || s >= 70)) return false;
      if (f.fit === "niedrig" && s >= 50) return false;
    }
    if (f.outreach) {
      if (f.outreach === "ohne" ? o.outreachStatus !== "" : o.outreachStatus !== f.outreach) return false;
    }
    if (f.prior) {
      if (f.prior === "ohne" ? o.priorOutcome !== "" : f.prior === "warm" ? !WARM.has(o.priorOutcome) : o.priorOutcome !== f.prior) return false;
    }
    return true;
  });
}

/* ---------- UI ---------- */

function count<T extends string>(items: T[]) {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

const EMPTY: OrgFilterState = { status: "", region: "", ticket: "", tag: "", city: "", contact: "", focus: "", stageFocus: "", fit: "", outreach: "", prior: "" };

export function OrgFilterPanel({
  kind,
  orgs,
  meta,
  f,
  onChange,
  onReset,
}: {
  kind: OrgKind;
  orgs: Org[];
  meta: OrgMeta;
  f: OrgFilterState;
  onChange: (k: keyof OrgFilterState, v: string) => void;
  onReset: () => void;
}) {
  const inv = kind === "investor";
  const opts = useMemo(() => {
    const stages = count(orgs.map((o) => o.stage));
    const countries = count(orgs.map((o) => o.country.toUpperCase()).filter(Boolean));
    const regions = count(orgs.map((o) => regionOf(o.country)).filter(Boolean));
    const bayArea = orgs.filter(isBayArea).length;
    const noCountry = orgs.filter((o) => !o.country).length;
    const tags = [...count(orgs.flatMap((o) => o.tags))].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], getLang())).slice(0, 60);
    const cities = [...count(orgs.map((o) => o.city).filter(Boolean))].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], getLang())).slice(0, 80);
    const tickets = TICKET_BUCKETS.map((b) => ({ ...b, n: applyFilters(orgs, { ...EMPTY, ticket: b.id }, kind, meta).length }));
    const noTicket = applyFilters(orgs, { ...EMPTY, ticket: "ohne" }, kind, meta).length;
    const focus = count(orgs.flatMap((o) => o.focusTags ?? []));
    const stageFocus = count(orgs.flatMap((o) => o.stageFocus ?? []));
    const fit = { hoch: 0, mittel: 0, niedrig: 0 };
    for (const o of orgs) {
      const s = o.fitScore ?? -1;
      if (s >= 70) fit.hoch++;
      else if (s >= 50) fit.mittel++;
      else fit.niedrig++;
    }
    const outreach = count(orgs.map((o) => (o.outreachStatus || "ohne") as string));
    const prior = count(orgs.map((o) => o.priorOutcome || "ohne"));
    const warm = orgs.filter((o) => WARM.has(o.priorOutcome)).length;
    return { stages, countries, regions, bayArea, noCountry, tags, cities, tickets, noTicket, focus, stageFocus, fit, outreach, prior, warm };
  }, [orgs, kind, meta]);

  const amountLabel = inv ? tr("Ticket size", "Ticketgröße") : tr("Volume", "Volumen");
  const n = (x: number | undefined) => (x ? ` (${x.toLocaleString(locale())})` : "");
  const hasCountries = opts.countries.size > 0;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={tr("More filters", "Weitere Filter")}>
      <Select value={f.status} onChange={(e) => onChange("status", e.target.value)} aria-label="Status">
        <option value="">{tr("All stages", "Alle Status")}</option>
        <option value="_aktiv">{tr("Active conversations only", "Nur laufende Gespräche")}</option>
        {meta.stages[kind].map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
            {n(opts.stages.get(s.id))}
          </option>
        ))}
      </Select>
      {inv && (
        <Select value={f.fit} onChange={(e) => onChange("fit", e.target.value)} aria-label={tr("Fit for nalpia", "Fit für nalpia")}>
          <option value="">{tr("Any fit for nalpia", "Jeder Fit für nalpia")}</option>
          <option value="hoch">{tr("High fit (70+)", "Hoher Fit (70+)")}{n(opts.fit.hoch)}</option>
          <option value="mittel">{tr("Medium fit (50–69)", "Mittlerer Fit (50–69)")}{n(opts.fit.mittel)}</option>
          <option value="niedrig">{tr("Low fit (< 50)", "Niedriger Fit (< 50)")}{n(opts.fit.niedrig)}</option>
        </Select>
      )}
      {inv && (
        <Select value={f.focus} onChange={(e) => onChange("focus", e.target.value)} aria-label={tr("Thematic focus", "Thematischer Fokus")}>
          <option value="">{tr("All thematic focuses", "Alle thematischen Fokusse")}</option>
          {Object.entries(meta.focusTags ?? {})
            .filter(([id]) => opts.focus.get(id))
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {n(opts.focus.get(id))}
              </option>
            ))}
        </Select>
      )}
      {inv && (
        <Select value={f.stageFocus} onChange={(e) => onChange("stageFocus", e.target.value)} aria-label={tr("Stage focus", "Phasenfokus")}>
          <option value="">{tr("All stage focuses", "Alle Phasenfokusse")}</option>
          {Object.entries(meta.stageFocus ?? {})
            .filter(([id]) => opts.stageFocus.get(id))
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {n(opts.stageFocus.get(id))}
              </option>
            ))}
        </Select>
      )}
      {hasCountries ? (
        <Select value={f.region} onChange={(e) => onChange("region", e.target.value)} aria-label={tr("Region or country", "Region oder Land")}>
          <option value="">{tr("All regions", "Alle Regionen")}</option>
          <optgroup label={tr("Regions", "Regionen")}>
            {opts.bayArea > 0 && <option value="r:bayarea">{REGIONS[0]!.label}{n(opts.bayArea)}</option>}
            {REGIONS.slice(1)
              .filter((r) => opts.regions.get(r.id))
              .map((r) => (
                <option key={r.id} value={`r:${r.id}`}>
                  {r.label}
                  {n(opts.regions.get(r.id))}
                </option>
              ))}
            {opts.regions.get("sonst") ? <option value="r:sonst">{tr("Other", "Sonstige")}{n(opts.regions.get("sonst"))}</option> : null}
            {opts.noCountry > 0 && <option value="r:ohne">{tr("No country given", "Ohne Länderangabe")}{n(opts.noCountry)}</option>}
          </optgroup>
          <optgroup label={tr("Countries", "Länder")}>
            {[...opts.countries]
              .sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0]), getLang()))
              .map(([c, k]) => (
                <option key={c} value={`c:${c}`}>
                  {countryName(c)}
                  {n(k)}
                </option>
              ))}
          </optgroup>
        </Select>
      ) : null}
      <Select value={f.city} onChange={(e) => onChange("city", e.target.value)} aria-label={tr("City", "Ort")}>
        <option value="">{tr("All cities", "Alle Orte")}</option>
        {opts.cities.map(([c, k]) => (
          <option key={c} value={c}>
            {c}
            {n(k)}
          </option>
        ))}
      </Select>
      <Select value={f.ticket} onChange={(e) => onChange("ticket", e.target.value)} aria-label={amountLabel}>
        <option value="">{inv ? tr("All ticket sizes", "Alle Ticketgrößen") : tr("All volumes", "Alle Volumina")}</option>
        {opts.tickets.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
            {n(b.n)}
          </option>
        ))}
        <option value="ohne">{tr("Not specified", "Ohne Angabe")}{n(opts.noTicket)}</option>
      </Select>
      {inv && (
        <Select value={f.outreach} onChange={(e) => onChange("outreach", e.target.value)} aria-label={tr("Agent outreach", "Agent-Outreach")}>
          <option value="">{tr("Any outreach status", "Jeder Outreach-Status")}</option>
          <option value="ohne">{tr("Not in outreach yet", "Noch nicht im Outreach")}{n(opts.outreach.get("ohne"))}</option>
          {Object.entries(meta.outreachStatus ?? {})
            .filter(([id]) => id && opts.outreach.get(id))
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {n(opts.outreach.get(id))}
              </option>
            ))}
        </Select>
      )}
      {inv && (
        <Select value={f.prior} onChange={(e) => onChange("prior", e.target.value)} aria-label={tr("History with SINTRO", "Vorgeschichte mit SINTRO")}>
          <option value="">{tr("Any history", "Jede Vorgeschichte")}</option>
          <option value="warm">{tr("Warm (replied, call, deck, committed)", "Warm (Antwort, Call, Deck, Zusage)")}{n(opts.warm)}</option>
          <option value="ohne">{tr("No earlier contact", "Kein früherer Kontakt")}{n(opts.prior.get("ohne"))}</option>
          {Object.entries(meta.priorOutcomes ?? {})
            .filter(([id]) => id && opts.prior.get(id))
            .map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {n(opts.prior.get(id))}
              </option>
            ))}
        </Select>
      )}
      <Select value={f.tag} onChange={(e) => onChange("tag", e.target.value)} aria-label={tr("Tag", "Schlagwort")}>
        <option value="">{tr("All tags (segment, source …)", "Alle Schlagworte (Segment, Quelle …)")}</option>
        {opts.tags.map(([t, k]) => (
          <option key={t} value={t}>
            {t}
            {n(k)}
          </option>
        ))}
      </Select>
      <Select value={f.contact} onChange={(e) => onChange("contact", e.target.value)} aria-label={tr("Last contact", "Letzter Kontakt")}>
        <option value="">{tr("Last contact: any", "Letzter Kontakt: egal")}</option>
        <option value="7">{tr("In the last 7 days", "In den letzten 7 Tagen")}</option>
        <option value="30">{tr("In the last 30 days", "In den letzten 30 Tagen")}</option>
        <option value="alt">{tr("More than 30 days ago", "Länger als 30 Tage her")}</option>
        <option value="nie">{tr("Never contacted", "Noch nie kontaktiert")}</option>
      </Select>
      <div className="flex items-center justify-end sm:col-span-2 lg:col-span-3">
        <button type="button" className="link text-[13px]" onClick={onReset}>
          {tr("Reset all filters", "Alle Filter zurücksetzen")}
        </button>
      </div>
    </div>
  );
}

/** "Filter" button with the number of active filters */
export function FilterButton({ active, open, onClick }: { active: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cx(
        "inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition",
        active ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface hover:bg-surface2",
      )}
    >
      <SlidersHorizontal className="h-4 w-4" />
      Filter
      {active > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-ink px-1 text-[11.5px] font-bold text-brand">{active}</span>}
    </button>
  );
}

/** Active filters as removable chips */
export function FilterChips({ kind, f, meta, onClear }: { kind: OrgKind; f: OrgFilterState; meta: OrgMeta; onClear: (k: keyof OrgFilterState) => void }) {
  const label = (k: keyof OrgFilterState, v: string) => {
    switch (k) {
      case "status":
        return v === "_aktiv" ? tr("Active only", "Nur laufende") : (meta.stages[kind].find((s) => s.id === v)?.label ?? v);
      case "region":
        return v.startsWith("c:") ? countryName(v.slice(2)) : v === "r:ohne" ? tr("No country given", "Ohne Länderangabe") : v === "r:sonst" ? tr("Other regions", "Sonstige Regionen") : (REGIONS.find((r) => `r:${r.id}` === v)?.label ?? v);
      case "ticket":
        return v === "ohne" ? kind === "investor" ? tr("Ticket size not specified", "Ticket ohne Angabe") : tr("Volume not specified", "Volumen ohne Angabe") : (TICKET_BUCKETS.find((b) => b.id === v)?.label ?? v);
      case "contact":
        return ({ nie: tr("Never contacted", "Nie kontaktiert"), "7": tr("Contact ≤ 7 days", "Kontakt ≤ 7 Tage"), "30": tr("Contact ≤ 30 days", "Kontakt ≤ 30 Tage"), alt: tr("Contact > 30 days", "Kontakt > 30 Tage") } as Record<string, string>)[v] ?? v;
      case "focus":
        return meta.focusTags?.[v] ?? v;
      case "stageFocus":
        return meta.stageFocus?.[v] ?? v;
      case "fit":
        return ({ hoch: tr("High fit", "Hoher Fit"), mittel: tr("Medium fit", "Mittlerer Fit"), niedrig: tr("Low fit", "Niedriger Fit") } as Record<string, string>)[v] ?? v;
      case "outreach":
        return v === "ohne" ? tr("Not in outreach", "Nicht im Outreach") : (meta.outreachStatus?.[v] ?? v);
      case "prior":
        return v === "ohne" ? tr("No earlier contact", "Kein früherer Kontakt") : v === "warm" ? tr("Warm history", "Warme Vorgeschichte") : (meta.priorOutcomes?.[v] ?? v);
      default:
        return v;
    }
  };
  const active = FILTER_KEYS.filter((k) => f[k]);
  if (!active.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label={tr("Active filters", "Aktive Filter")}>
      {active.map((k) => (
        <span key={k} className="inline-flex h-8 items-center gap-1 rounded-full bg-info-soft pl-3 pr-1 text-[13px] font-semibold text-info">
          {label(k, f[k])}
          <button type="button" className="grid h-6 w-6 place-items-center rounded-full hover:bg-info/15" aria-label={tr(`Remove filter "${label(k, f[k])}"`, `Filter „${label(k, f[k])}“ entfernen`)} onClick={() => onClear(k)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
