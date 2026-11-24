import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, ChevronRight, Inbox, Mail, Pause, Play, RefreshCw, Send, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Select } from "@/components/pickers";
import { Sheet } from "@/components/Sheet";
import { Button, cx, EmptyState, Field, Pill, Segmented, Skeleton, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, fitBucket, OUTREACH_TONE, relTime } from "@/lib/format";
import { locale, tr } from "@/lib/i18n";
import { useAgentCandidates, useAgentMessages, useAgentRuns, useAgentStatus, useMe, useOrgMeta, useOutreach, useOutreachDetail, useUserMap } from "@/lib/queries";
import type { AgentMessage, AgentRun, AgentSettings, AgentStatus } from "@/lib/types";

type Tab = "pruefen" | "antworten" | "laufend" | "kandidaten" | "protokoll" | "einstellungen";

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString(locale());

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function AgentPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "pruefen";
  const status = useAgentStatus();
  const me = useMe().data?.user;
  const isAdmin = me?.role === "admin";
  const qc = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const s = status.data;

  const setTab = (t: Tab) => {
    const p = new URLSearchParams(params);
    if (t === "pruefen") p.delete("tab");
    else p.set("tab", t);
    setParams(p, { replace: true });
  };

  async function run(kind: "all" | "drafts" | "inbox" | "followups" | "send") {
    setRunning(kind);
    try {
      await api.post("/api/agent/run", { kind });
      toast(tr("Agent started", "Agent gestartet"), { description: tr("Results appear in the log and in the lists within a few minutes.", "Ergebnisse erscheinen in wenigen Minuten im Protokoll und in den Listen.") });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["agent"] }), 4000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  async function setMode(mode: "review" | "autopilot") {
    if (mode === "autopilot" && !window.confirm(tr("Autopilot: the agent sends first mails, follow-ups and clear yes/no replies on its own – within the sending window and the daily cap. Switch on?", "Autopilot: Der Agent sendet Erstmails, Follow-ups und eindeutige Ja/Nein-Antworten selbstständig – im Sendefenster und bis zum Tageslimit. Einschalten?"))) return;
    try {
      await api.patch("/api/agent/settings", { mode });
      qc.invalidateQueries({ queryKey: ["agent"] });
      toast.success(mode === "autopilot" ? tr("Autopilot on", "Autopilot an") : tr("Review mode on", "Prüfmodus an"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const toReview = s ? s.counts.draft + s.counts.needsNote + s.counts.approved : 0;
  const replies = s ? s.counts.pendingMessages : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[28px] font-extrabold tracking-[-0.025em]">
            <Bot className="h-7 w-7 text-accent-ink" /> {tr("Fundraising agent", "Fundraising-Agent")}
          </h1>
          <p className="max-w-[64ch] text-[14px] text-muted">
            {tr(
              "Researches investors, writes personal first mails in Denis's style, sends them through the connected mailbox, follows up and sorts the replies. In review mode nothing goes out before a click.",
              "Recherchiert Investoren, schreibt persönliche Erstmails im Stil von Denis, versendet sie über das verbundene Postfach, fasst nach und sortiert die Antworten. Im Prüfmodus geht nichts ohne Klick raus.",
            )}
          </p>
        </div>
        {s && isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<"review" | "autopilot">
              value={s.settings.mode}
              onChange={(v) => v !== s.settings.mode && void setMode(v)}
              options={[
                { value: "review", label: tr("Review", "Prüfmodus") },
                { value: "autopilot", label: tr("Autopilot", "Autopilot") },
              ]}
            />
            <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={running === "drafts"} onClick={() => run("drafts")} disabled={s.ai === "off"}>
              {tr("Draft now", "Jetzt Entwürfe erzeugen")}
            </Button>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={running === "all"} onClick={() => run("all")}>
              {tr("Run everything", "Alles ausführen")}
            </Button>
          </div>
        )}
      </header>

      {status.isLoading || !s ? <Skeleton className="h-40" /> : <StatusStrip s={s} />}

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "pruefen", label: tr("To review", "Zu prüfen"), count: toReview },
          { value: "antworten", label: tr("Replies", "Antworten"), count: replies },
          { value: "laufend", label: tr("In progress", "Laufend") },
          { value: "kandidaten", label: tr("Candidates", "Kandidaten") },
          { value: "protokoll", label: tr("Log", "Protokoll") },
          ...(isAdmin ? [{ value: "einstellungen" as Tab, label: tr("Settings", "Einstellungen") }] : []),
        ]}
      />

      {tab === "pruefen" && <ReviewTab />}
      {tab === "antworten" && <RepliesTab />}
      {tab === "laufend" && <ProgressTab />}
      {tab === "kandidaten" && <CandidatesTab s={s} />}
      {tab === "protokoll" && <LogTab />}
      {tab === "einstellungen" && s && isAdmin && <SettingsTab s={s} />}
      <OutreachSheet />
    </div>
  );
}

/* ---------- Status strip ---------- */

function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className={cx("mt-0.5 truncate text-[20px] font-semibold leading-tight tracking-[-0.01em]", tone)}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function StatusStrip({ s }: { s: AgentStatus }) {
  const c = s.counts;
  const problems: string[] = [];
  if (!s.owner) problems.push(tr("No owner set – choose whose mailbox the agent uses (settings).", "Kein Inhaber gesetzt – wähle in den Einstellungen, wessen Postfach der Agent nutzt."));
  else if (!s.mail?.connected) problems.push(tr(`${s.owner.name}'s mailbox is not connected (Mail → connect).`, `Das Postfach von ${s.owner.name} ist nicht verbunden (Postfach → verbinden).`));
  else if (s.mail.needsReconnect) problems.push(tr("The mailbox needs to be reconnected.", "Das Postfach muss neu verbunden werden."));
  if (s.ai === "off") problems.push(tr("No Anthropic API key – the agent cannot research or write (ANTHROPIC_API_KEY).", "Kein Anthropic-API-Schlüssel – der Agent kann weder recherchieren noch schreiben (ANTHROPIC_API_KEY)."));
  if (s.ai === "demo") problems.push(tr("Demo mode – drafts come from templates, no research.", "Demo-Modus – Entwürfe kommen aus Vorlagen, keine Recherche."));
  if (s.state.lastError) problems.push(tr(`Last error: ${s.state.lastError}`, `Letzter Fehler: ${s.state.lastError}`));
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-bold">
          {s.settings.mode === "autopilot" ? tr("Autopilot", "Autopilot") : tr("Review mode", "Prüfmodus")}
          <span className="ml-2 text-[13px] font-medium text-muted">
            {s.settings.enabled ? tr("scheduler on", "Zeitplan an") : tr("scheduler off", "Zeitplan aus")} · {s.model}
            {s.owner ? ` · ${s.owner.email}` : ""}
          </span>
        </h2>
        <p className="text-[13px] text-muted">
          {tr("Today", "Heute")}: {n(s.state.draftsToday)}/{n(s.settings.dailyDrafts)} {tr("drafts", "Entwürfe")}, {n(s.state.sentToday)}/{n(s.settings.dailyCap)} {tr("sent", "gesendet")}
          {s.running.length > 0 && <span className="ml-2 font-semibold text-accent-ink">· {tr("running", "läuft")}: {s.running.join(", ")}</span>}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label={tr("To review", "Zu prüfen")} value={n(c.draft + c.approved)} hint={c.needsNote ? tr(`+ ${n(c.needsNote)} without a personal note`, `+ ${n(c.needsNote)} ohne persönlichen Absatz`) : undefined} tone={c.needsNote ? "text-neg" : undefined} />
        <Figure label={tr("Waiting for reply", "Warten auf Antwort")} value={n(c.open)} hint={tr(`${n(c.sentTotal)} sent in total`, `${n(c.sentTotal)} gesendet insgesamt`)} />
        <Figure label={tr("Replies", "Antworten")} value={n(c.replied + c.declined)} hint={tr(`${n(c.yes)} yes, ${n(c.questions)} questions, ${n(c.declined)} declined`, `${n(c.yes)} Ja, ${n(c.questions)} Fragen, ${n(c.declined)} Absagen`)} />
        <Figure label={tr("Response rate", "Antwortquote")} value={c.responseRate === null ? "–" : `${c.responseRate.toLocaleString(locale())} %`} />
        <Figure label={tr("Drafted replies", "Antwortentwürfe")} value={n(c.pendingMessages)} hint={tr("waiting for a click", "warten auf Klick")} />
        <Figure label={tr("Candidates", "Kandidaten")} value={n(s.candidates.total)} hint={tr(`${n(s.candidates.priority)} in priority cities`, `${n(s.candidates.priority)} in bevorzugten Städten`)} />
      </div>
      {problems.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl bg-accent-soft/60 p-3 text-[13px] text-accent-ink">
          {problems.map((p) => (
            <li key={p} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- Review tab: first mails to approve ---------- */

function OutreachPill({ status }: { status: string }) {
  const meta = useOrgMeta().data;
  return <Pill className={OUTREACH_TONE[status] ?? "bg-surface2 text-muted"}>{meta?.outreachStatus?.[status] ?? (status === "discarded" ? tr("Discarded", "Verworfen") : status)}</Pill>;
}

function useOpenOutreach() {
  const [params, setParams] = useSearchParams();
  return (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set("outreach", id);
    else p.delete("outreach");
    setParams(p, { replace: true });
  };
}

function ReviewTab() {
  const { data, isLoading } = useOutreach({ status: "draft,needs_note,approved" });
  const open = useOpenOutreach();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const l = (data ?? []).filter((o) => !q || `${o.orgName} ${o.toName} ${o.toEmail}`.toLowerCase().includes(q.toLowerCase()));
    return l.sort((a, b) => (a.status === "needs_note" ? 1 : 0) - (b.status === "needs_note" ? 1 : 0) || (b.quality ?? 0) - (a.quality ?? 0) || b.createdAt - a.createdAt);
  }, [data, q]);
  if (isLoading) return <Skeleton className="h-60" />;
  if (!data?.length)
    return (
      <EmptyState
        icon={<Sparkles className="h-5 w-5" />}
        title={tr("Nothing to review", "Nichts zu prüfen")}
        text={tr("The agent drafts a new batch every morning – or start one with “Draft now”.", "Der Agent erzeugt jeden Morgen einen neuen Stapel – oder starte einen mit „Jetzt Entwürfe erzeugen“.")}
      />
    );
  return (
    <div className="space-y-2">
      <input className="field" placeholder={tr("Filter by firm or contact", "Nach Firma oder Kontakt filtern")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Filter", "Filter")} />
      <div className="card overflow-hidden">
        <ul className="divide-y divide-line">
          {list.map((o) => (
            <li key={o.id}>
              <button onClick={() => open(o.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface2/50 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_120px_20px]">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{o.orgName}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {o.toName} · {[o.orgCity, o.orgCountry].filter(Boolean).join(", ")}
                  </span>
                </span>
                <span className="col-span-2 line-clamp-2 text-[13px] text-muted md:col-span-1">{o.personal || tr("(no personal paragraph yet)", "(noch kein persönlicher Absatz)")}</span>
                <span className="flex items-center gap-2 justify-self-end md:justify-self-start">
                  <OutreachPill status={o.status} />
                  {o.quality !== null && <span className={cx("num text-[12.5px] font-semibold", o.quality >= 8 ? "text-pos" : o.quality >= 6 ? "text-accent-ink" : "text-neg")}>{o.quality}/10</span>}
                </span>
                <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------- Replies tab: drafted answers & follow-ups ---------- */

function RepliesTab() {
  const { data, isLoading } = useAgentMessages("draft");
  const qc = useQueryClient();
  const [edit, setEdit] = useState<AgentMessage | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["agent"] });
    qc.invalidateQueries({ queryKey: ["orgs"] });
  };
  async function send(m: AgentMessage) {
    setBusy(m.id);
    try {
      if (edit?.id === m.id && body !== m.body) await api.patch(`/api/agent/messages/${m.id}`, { body });
      await api.post(`/api/agent/messages/${m.id}/send`);
      toast.success(tr("Sent", "Gesendet"), { description: m.toName });
      setEdit(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function discard(m: AgentMessage) {
    if (!window.confirm(tr("Discard this draft?", "Diesen Entwurf verwerfen?"))) return;
    await api.post(`/api/agent/messages/${m.id}/discard`);
    refresh();
  }
  if (isLoading) return <Skeleton className="h-60" />;
  if (!data?.length)
    return <EmptyState icon={<Inbox className="h-5 w-5" />} title={tr("No drafted replies", "Keine Antwortentwürfe")} text={tr("Replies to investors and follow-ups appear here as soon as the agent has drafted them.", "Antworten an Investoren und Follow-ups erscheinen hier, sobald der Agent sie entworfen hat.")} />;
  const kindLabel = (k: AgentMessage["kind"]) => ({ first: tr("First mail", "Erstmail"), followup: tr("Follow-up", "Follow-up"), reply: tr("Reply", "Antwort"), auto_reply: tr("Reply (yes/no)", "Antwort (Ja/Nein)"), manual: tr("Manual", "Manuell") })[k];
  return (
    <ul className="space-y-3">
      {data.map((m) => {
        const editing = edit?.id === m.id;
        return (
          <li key={m.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">
                  <Link to={`/investoren/${m.orgId}`} className="hover:underline">
                    {m.orgName}
                  </Link>{" "}
                  <span className="font-normal text-muted">· {m.toName} ({m.toEmail})</span>
                </p>
                <p className="text-[13px] text-muted">
                  <Pill className="mr-1 bg-info-soft text-info">{kindLabel(m.kind)}</Pill>
                  {m.replyKind && (
                    <>
                      {tr("Reply classified as", "Antwort eingestuft als")} <b>{m.replyKind}</b>: {m.replySummary}
                    </>
                  )}
                </p>
              </div>
              <span className="text-[12.5px] text-muted">{relTime(m.createdAt)}</span>
            </div>
            <p className="mt-2 text-[13px] text-muted">{tr("Subject", "Betreff")}: {m.subject}</p>
            {editing ? (
              <textarea className="field mt-2 min-h-[180px] font-sans text-[14px]" value={body} onChange={(e) => setBody(e.target.value)} aria-label={tr("Draft", "Entwurf")} />
            ) : (
              <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-surface2/60 p-3 font-sans text-[14px] leading-relaxed">{m.body}</pre>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => discard(m)}>
                {tr("Discard", "Verwerfen")}
              </Button>
              {editing ? (
                <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => setEdit(null)}>
                  {tr("Cancel", "Abbrechen")}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => { setEdit(m); setBody(m.body); }}>
                  {tr("Edit", "Bearbeiten")}
                </Button>
              )}
              <Button variant="primary" size="sm" icon={<Send className="h-4 w-4" />} loading={busy === m.id} onClick={() => send(m)}>
                {tr("Send", "Senden")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- Progress tab: sent, waiting, replied ---------- */

function ProgressTab() {
  const [status, setStatus] = useState("sent,followup,replied,declined,bounced,paused,done");
  const { data, isLoading } = useOutreach({ status });
  const open = useOpenOutreach();
  if (isLoading) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-2">
      <Select className="w-[min(320px,100%)]" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="sent,followup,replied,declined,bounced,paused,done">{tr("All sent", "Alle gesendeten")}</option>
        <option value="sent,followup">{tr("Waiting for reply", "Warten auf Antwort")}</option>
        <option value="replied">{tr("Replied", "Hat geantwortet")}</option>
        <option value="declined">{tr("Declined", "Abgesagt")}</option>
        <option value="bounced">{tr("Bounced", "Unzustellbar")}</option>
        <option value="paused,done">{tr("Paused / done", "Pausiert / abgeschlossen")}</option>
        <option value="discarded">{tr("Discarded drafts", "Verworfene Entwürfe")}</option>
      </Select>
      {!data?.length ? (
        <EmptyState icon={<Mail className="h-5 w-5" />} title={tr("Nothing here yet", "Hier ist noch nichts")} />
      ) : (
        <div className="card overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_140px_minmax(0,2fr)_20px] gap-4 border-b border-line bg-surface2/50 px-4 py-2 text-[12px] font-semibold text-muted md:grid">
            <span>{tr("Investor", "Investor")}</span>
            <span>Status</span>
            <span>{tr("Sent", "Gesendet")}</span>
            <span>{tr("Reply / next step", "Antwort / nächster Schritt")}</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {data.map((o) => (
              <li key={o.id}>
                <button onClick={() => open(o.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface2/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_140px_minmax(0,2fr)_20px] md:gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{o.orgName}</span>
                    <span className="block truncate text-[13px] text-muted">{o.toName} · {o.orgCity}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1 justify-self-end md:justify-self-start">
                    <OutreachPill status={o.status} />
                    {o.sequenceStep > 0 && <span className="text-[12px] text-muted">{tr(`${o.sequenceStep}× follow-up`, `${o.sequenceStep}× Follow-up`)}</span>}
                  </span>
                  <span className="hidden text-[13px] text-muted md:block">{o.sentAt ? relTime(o.sentAt) : "–"}</span>
                  <span className="col-span-2 line-clamp-2 text-[13px] md:col-span-1">
                    {o.replySummary ? (
                      <>
                        <b className="text-ink">{o.replyKind}</b> – {o.replySummary}
                      </>
                    ) : o.nextActionAt ? (
                      <span className="text-muted">{tr("Follow-up", "Follow-up")} {relTime(o.nextActionAt)}</span>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </span>
                  <ChevronRight className="hidden h-4 w-4 text-muted md:block" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- Candidates tab ---------- */

function CandidatesTab({ s }: { s: AgentStatus | undefined }) {
  const { data, isLoading } = useAgentCandidates(true);
  const meta = useOrgMeta().data;
  if (isLoading || !data) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] text-muted">
        {tr(
          `${n(data.total)} investors match the current filters (fit ≥ ${s?.settings.minFit ?? "?"}, ${s?.settings.countries.length ? s.settings.countries.join(", ") : tr("all countries", "alle Länder")}, with e-mail, not yet in outreach); ${n(data.priority)} of them in priority cities. The next ${data.next.length} the agent would approach:`,
          `${n(data.total)} Investoren passen zu den aktuellen Filtern (Fit ≥ ${s?.settings.minFit ?? "?"}, ${s?.settings.countries.length ? s.settings.countries.join(", ") : "alle Länder"}, mit E-Mail, noch nicht im Outreach); davon ${n(data.priority)} in bevorzugten Städten. Die nächsten ${data.next.length}, die der Agent ansprechen würde:`,
        )}
      </p>
      {!data.next.length ? (
        <EmptyState icon={<Bot className="h-5 w-5" />} title={tr("No candidates", "Keine Kandidaten")} text={tr("Add investors with an e-mail address, lower the minimum fit or widen the countries in the settings.", "Lege Investoren mit E-Mail-Adresse an, senke den Mindest-Fit oder erweitere die Länder in den Einstellungen.")} />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {data.next.map((c, i) => (
              <li key={c.orgId} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
                <span className="num text-[12px] text-muted">{i + 1}</span>
                <span className="min-w-0">
                  <Link to={`/investoren/${c.orgId}`} className="block truncate font-semibold hover:underline">
                    {c.name}
                  </Link>
                  <span className="block truncate text-[13px] text-muted">
                    {c.contact.name}
                    {c.contact.position ? `, ${c.contact.position}` : ""} · {[meta?.types.investor[c.type], c.city, c.country].filter(Boolean).join(", ")}
                    {c.priorOutcome && ` · ${meta?.priorOutcomes?.[c.priorOutcome] ?? c.priorOutcome}`}
                  </span>
                </span>
                <span className={cx("num text-[13px] font-semibold", fitBucket(c.fitScore).tone)}>{c.fitScore ?? "–"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------- Log tab ---------- */

function LogTab() {
  const { data, isLoading } = useAgentRuns();
  const users = useUserMap();
  const [openId, setOpenId] = useState<string | null>(null);
  if (isLoading) return <Skeleton className="h-60" />;
  if (!data?.length) return <EmptyState icon={<Bot className="h-5 w-5" />} title={tr("No runs yet", "Noch keine Läufe")} />;
  const kindLabel = (k: AgentRun["kind"]) => ({ inbox: tr("Inbox", "Posteingang"), followups: tr("Follow-ups", "Follow-ups"), drafts: tr("Drafts", "Entwürfe"), send: tr("Sending", "Versand") })[k];
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-line">
        {data.map((r) => {
          const by = r.triggeredBy ? users.get(r.triggeredBy)?.name : null;
          const open = openId === r.id;
          return (
            <li key={r.id}>
              <button onClick={() => setOpenId(open ? null : r.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface2/50">
                <span className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", r.status === "ok" ? "bg-pos" : r.status === "error" ? "bg-neg" : "bg-accent animate-pulse")} aria-label={r.status} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">
                    <b>{kindLabel(r.kind)}</b> <span className="text-muted">· {dateTime(r.startedAt)}{by ? ` · ${by}` : ` · ${tr("scheduled", "Zeitplan")}`}</span>
                  </span>
                  <span className="block text-[13.5px]">{r.summary || (r.status === "running" ? tr("Running …", "Läuft …") : "")}</span>
                </span>
                <ChevronRight className={cx("mt-1 h-4 w-4 shrink-0 text-muted transition", open && "rotate-90")} />
              </button>
              {open && r.log && r.log.length > 0 && (
                <ol className="space-y-1 border-t border-line bg-surface2/40 px-4 py-3 text-[13px]">
                  {r.log.map((l, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="num shrink-0 text-muted">{new Date(l.ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="whitespace-pre-wrap">{l.t}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Settings tab ---------- */

function SettingsTab({ s }: { s: AgentStatus }) {
  const qc = useQueryClient();
  const users = useUserMap();
  const [f, setF] = useState<AgentSettings>(s.settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(s.settings), [s.settings]);
  const set = <K extends keyof AgentSettings>(k: K, v: AgentSettings[K]) => setF({ ...f, [k]: v });
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : fallback);
  async function save() {
    setBusy(true);
    try {
      await api.patch("/api/agent/settings", f);
      qc.invalidateQueries({ queryKey: ["agent"] });
      toast.success(tr("Settings saved", "Einstellungen gespeichert"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="section-title">{tr("Operation", "Betrieb")}</h2>
        <Switch checked={f.enabled} onChange={(v) => set("enabled", v)} label={tr("Scheduler", "Zeitplan")} description={tr("Inbox every 15 minutes; drafts and follow-ups once a day at the draft hour; autopilot sending within the window.", "Posteingang alle 15 Minuten; Entwürfe und Follow-ups einmal täglich zur Entwurfsstunde; Autopilot-Versand im Sendefenster.")} />
        <Field label={tr("Mode", "Modus")} hint={tr("Review: every mail waits for a click. Autopilot: the agent sends first mails, follow-ups and clear yes/no replies on its own; answers to questions still wait for you.", "Prüfmodus: Jede Mail wartet auf einen Klick. Autopilot: Der Agent sendet Erstmails, Follow-ups und eindeutige Ja/Nein-Antworten selbstständig; Antworten auf Fragen warten weiter auf dich.")}>
          <Segmented<"review" | "autopilot"> value={f.mode} onChange={(v) => set("mode", v)} options={[{ value: "review", label: tr("Review", "Prüfmodus") }, { value: "autopilot", label: "Autopilot" }]} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Mailbox owner", "Postfach-Inhaber")} hint={tr("Mails go out from this person's connected mailbox and replies are read there.", "Mails gehen aus dem verbundenen Postfach dieser Person raus, Antworten werden dort gelesen.")} htmlFor="ag-owner">
            <Select id="ag-owner" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)}>
              {[...users.values()].map((u) => (
                <option key={u.id} value={u.email}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Draft hour (Europe/Berlin)", "Entwurfsstunde (Europe/Berlin)")} htmlFor="ag-hour">
            <input id="ag-hour" type="number" min={0} max={23} className="field" value={f.draftHour} onChange={(e) => set("draftHour", num(e.target.value, 7))} />
          </Field>
          <Field label={tr("Drafts per day", "Entwürfe pro Tag")} hint={tr("Quality before quantity – 20 is the default.", "Qualität vor Menge – 20 ist der Standard.")} htmlFor="ag-drafts">
            <input id="ag-drafts" type="number" min={1} max={100} className="field" value={f.dailyDrafts} onChange={(e) => set("dailyDrafts", num(e.target.value, 20))} />
          </Field>
          <Field label={tr("Sending cap per day (autopilot)", "Versandlimit pro Tag (Autopilot)")} htmlFor="ag-cap">
            <input id="ag-cap" type="number" min={1} max={200} className="field" value={f.dailyCap} onChange={(e) => set("dailyCap", num(e.target.value, 20))} />
          </Field>
          <Field label={tr("Max. open threads", "Max. offene Threads")} htmlFor="ag-open">
            <input id="ag-open" type="number" min={1} max={2000} className="field" value={f.maxOpen} onChange={(e) => set("maxOpen", num(e.target.value, 200))} />
          </Field>
          <Field label={tr("Follow-ups after (days, comma-separated)", "Follow-ups nach (Tage, kommagetrennt)")} htmlFor="ag-fu">
            <input id="ag-fu" className="field" value={f.followUpDays.join(", ")} onChange={(e) => set("followUpDays", e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0).slice(0, 4))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={tr("Sending window from", "Sendefenster von")} htmlFor="ag-from">
            <input id="ag-from" type="time" className="field" value={f.sendWindow.from} onChange={(e) => set("sendWindow", { ...f.sendWindow, from: e.target.value })} />
          </Field>
          <Field label={tr("to", "bis")} htmlFor="ag-to">
            <input id="ag-to" type="time" className="field" value={f.sendWindow.to} onChange={(e) => set("sendWindow", { ...f.sendWindow, to: e.target.value })} />
          </Field>
          <Field label={tr("Time zone", "Zeitzone")} htmlFor="ag-tz">
            <input id="ag-tz" className="field" value={f.sendWindow.tz} onChange={(e) => set("sendWindow", { ...f.sendWindow, tz: e.target.value })} placeholder="America/Los_Angeles" />
          </Field>
        </div>
        <Switch checked={f.workdaysOnly} onChange={(v) => set("workdaysOnly", v)} label={tr("Workdays only", "Nur Werktage")} />
        <Switch checked={f.autoReply} onChange={(v) => set("autoReply", v)} label={tr("Autopilot: reply to clear yes/no automatically", "Autopilot: eindeutige Ja/Nein-Antworten automatisch beantworten")} description={tr("Yes → deck link; decline → thank-you note. Questions always wait for you.", "Ja → Deck-Link; Absage → Dankes-Notiz. Fragen warten immer auf dich.")} />
        <Switch checked={f.webResearch} onChange={(v) => set("webResearch", v)} label={tr("Web research before writing", "Web-Recherche vor dem Schreiben")} description={tr("The model searches the investor's website and recent posts for a verified hook (needs an API key).", "Das Modell durchsucht Website und aktuelle Beiträge des Investors nach einem belegten Aufhänger (braucht einen API-Schlüssel).")} />
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="section-title">{tr("Candidates", "Kandidaten")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Countries (ISO codes, empty = all)", "Länder (ISO-Codes, leer = alle)")} hint={tr("Currently US investors only, Bay Area first.", "Aktuell nur US-Investoren, Bay Area zuerst.")} htmlFor="ag-countries">
            <input id="ag-countries" className="field" value={f.countries.join(", ")} onChange={(e) => set("countries", e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))} placeholder="US, DE, GB" />
          </Field>
          <Field label={tr("Minimum fit for nalpia", "Mindest-Fit für nalpia")} htmlFor="ag-fit">
            <input id="ag-fit" type="number" min={0} max={100} className="field" value={f.minFit} onChange={(e) => set("minFit", num(e.target.value, 55))} />
          </Field>
        </div>
        <Field label={tr("Priority cities (one per line)", "Bevorzugte Städte (eine pro Zeile)")} htmlFor="ag-cities">
          <textarea id="ag-cities" className="field min-h-[100px]" value={f.priorityCities.join("\n")} onChange={(e) => set("priorityCities", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
        </Field>
        <Switch checked={f.onePerFirm} onChange={(v) => set("onePerFirm", v)} label={tr("One contact per firm", "Ein Kontakt pro Firma")} />
        <Switch checked={f.includePriorDeclined} onChange={(v) => set("includePriorDeclined", v)} label={tr("Also approach investors who declined SINTRO", "Auch Investoren ansprechen, die SINTRO abgesagt haben")} description={tr("With a new angle – nalpia is a different product and company.", "Mit neuem Aufhänger – nalpia ist ein anderes Produkt und eine andere Firma.")} />
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="section-title">{tr("Mails", "Mails")}</h2>
        <Field label={tr("Subject ({firm} = investor name)", "Betreff ({firm} = Name des Investors)")} htmlFor="ag-subject">
          <input id="ag-subject" className="field" value={f.subject} onChange={(e) => set("subject", e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={tr("Deck link", "Deck-Link")} htmlFor="ag-deck">
            <input id="ag-deck" className="field" value={f.deckUrl} onChange={(e) => set("deckUrl", e.target.value)} placeholder="https://docsend.com/…" />
          </Field>
          <Field label={tr("Booking link", "Terminbuchungs-Link")} htmlFor="ag-cal">
            <input id="ag-cal" className="field" value={f.calendlyUrl} onChange={(e) => set("calendlyUrl", e.target.value)} placeholder="https://calendly.com/…" />
          </Field>
          <Field label={tr("First mail (English) – {firstName}, {personal}", "Erstmail (Englisch) – {firstName}, {personal}")} htmlFor="ag-en">
            <textarea id="ag-en" className="field min-h-[220px] font-sans text-[13.5px]" value={f.bodyEn} onChange={(e) => set("bodyEn", e.target.value)} />
          </Field>
          <Field label={tr("First mail (German)", "Erstmail (Deutsch)")} htmlFor="ag-de">
            <textarea id="ag-de" className="field min-h-[220px] font-sans text-[13.5px]" value={f.bodyDe} onChange={(e) => set("bodyDe", e.target.value)} />
          </Field>
          <Field label={tr("Reply to “yes” (English) – {firstName}, {deckUrl}", "Antwort auf „Ja“ (Englisch) – {firstName}, {deckUrl}")} htmlFor="ag-yes-en">
            <textarea id="ag-yes-en" className="field min-h-[120px] font-sans text-[13.5px]" value={f.yesReplyEn} onChange={(e) => set("yesReplyEn", e.target.value)} />
          </Field>
          <Field label={tr("Reply to “yes” (German)", "Antwort auf „Ja“ (Deutsch)")} htmlFor="ag-yes-de">
            <textarea id="ag-yes-de" className="field min-h-[120px] font-sans text-[13.5px]" value={f.yesReplyDe} onChange={(e) => set("yesReplyDe", e.target.value)} />
          </Field>
          <Field label={tr("Reply to a decline (English)", "Antwort auf Absage (Englisch)")} htmlFor="ag-pass-en">
            <textarea id="ag-pass-en" className="field min-h-[100px] font-sans text-[13.5px]" value={f.passReplyEn} onChange={(e) => set("passReplyEn", e.target.value)} />
          </Field>
          <Field label={tr("Reply to a decline (German)", "Antwort auf Absage (Deutsch)")} htmlFor="ag-pass-de">
            <textarea id="ag-pass-de" className="field min-h-[100px] font-sans text-[13.5px]" value={f.passReplyDe} onChange={(e) => set("passReplyDe", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="section-title">{tr("Playbook and style", "Playbook und Stil")}</h2>
        <Field label={tr("Playbook (positioning, arguments, rules for the personal paragraph, objections)", "Playbook (Positionierung, Argumente, Regeln für den persönlichen Absatz, Einwände)")} htmlFor="ag-pb">
          <textarea id="ag-pb" className="field min-h-[320px] font-sans text-[13.5px]" value={f.playbook} onChange={(e) => set("playbook", e.target.value)} />
        </Field>
        <Field label={tr("Denis's writing style", "Schreibstil von Denis")} htmlFor="ag-style">
          <textarea id="ag-style" className="field min-h-[240px] font-sans text-[13.5px]" value={f.styleProfile} onChange={(e) => set("styleProfile", e.target.value)} />
        </Field>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={async () => {
            if (!window.confirm(tr("Reset templates, playbook and writing style to the defaults? Your changes in these text fields are replaced (not saved until you click “Save settings”).", "Vorlagen, Playbook und Schreibstil auf den Standard zurücksetzen? Eure Änderungen in diesen Textfeldern werden ersetzt (gespeichert erst mit „Einstellungen speichern“)."))) return;
            try {
              const d = await api.get<AgentSettings>("/api/agent/defaults");
              setF({ ...f, subject: d.subject, bodyEn: d.bodyEn, bodyDe: d.bodyDe, yesReplyEn: d.yesReplyEn, yesReplyDe: d.yesReplyDe, passReplyEn: d.passReplyEn, passReplyDe: d.passReplyDe, playbook: d.playbook, styleProfile: d.styleProfile });
              toast.success(tr("Template texts restored – save to apply", "Vorlagentexte wiederhergestellt – zum Übernehmen speichern"));
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          {tr("Restore template texts", "Vorlagentexte wiederherstellen")}
        </Button>
        <Button variant="primary" icon={<Check className="h-4 w-4" />} loading={busy} onClick={save}>
          {tr("Save settings", "Einstellungen speichern")}
        </Button>
      </div>
    </div>
  );
}

/* ---------- Outreach sheet: review, edit, send one first mail ---------- */

function OutreachSheet() {
  const [params] = useSearchParams();
  const open = useOpenOutreach();
  const id = params.get("outreach") ?? undefined;
  const { data: o, isLoading } = useOutreachDetail(id);
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [personal, setPersonal] = useState("");
  const [body, setBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (o) {
      setSubject(o.subject);
      setPersonal(o.personal);
      setBody(o.body);
    }
  }, [o]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["agent"] });
    qc.invalidateQueries({ queryKey: ["orgs"] });
    qc.invalidateQueries({ queryKey: ["org"] });
  };
  const editable = !!o && ["draft", "needs_note", "approved"].includes(o.status);
  const dirty = !!o && (subject !== o.subject || personal !== o.personal || body !== o.body);

  async function saveEdits() {
    if (!o || !dirty) return;
    // When only the personal paragraph changed, let the server swap it inside the mail text
    const patch: Record<string, string> = { subject };
    if (personal !== o.personal && body === o.body) patch.personal = personal;
    else {
      patch.body = body;
      patch.personal = personal;
    }
    await api.patch(`/api/agent/outreach/${o.id}`, patch);
  }
  async function act(kind: "send" | "save" | "regenerate" | "discard" | "paused" | "done" | "draft") {
    if (!o) return;
    setBusy(kind);
    try {
      if (kind === "save") {
        await saveEdits();
        toast.success(tr("Saved", "Gespeichert"));
      } else if (kind === "send") {
        if (dirty) await saveEdits();
        await api.post(`/api/agent/outreach/${o.id}/send`);
        toast.success(tr("Sent", "Gesendet"), { description: `${o.toName} (${o.toEmail})` });
        open(null);
      } else if (kind === "regenerate") {
        await api.post(`/api/agent/outreach/${o.id}/regenerate`, instruction.trim() ? { instruction: instruction.trim() } : {});
        setInstruction("");
        toast.success(tr("New draft", "Neuer Entwurf"));
      } else if (kind === "discard") {
        if (!window.confirm(tr("Discard this draft? The investor goes back to the candidate list.", "Entwurf verwerfen? Der Investor landet wieder in der Kandidatenliste."))) return;
        await api.post(`/api/agent/outreach/${o.id}/status`, { status: "discarded" });
        open(null);
      } else {
        await api.post(`/api/agent/outreach/${o.id}/status`, { status: kind });
      }
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && open(null)} title={o ? o.orgName : tr("Outreach", "Outreach")} size="xl">
      {isLoading || !o ? (
        <Skeleton className="h-80" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
            <OutreachPill status={o.status} />
            <span className="text-muted">
              {o.toName} · {o.toEmail}
            </span>
            {o.fitScore !== null && <span className={cx("num font-semibold", fitBucket(o.fitScore).tone)}>Fit {o.fitScore}</span>}
            {o.quality !== null && <span className="num text-muted">{tr("Quality", "Qualität")} {o.quality}/10</span>}
            <Link to={`/investoren/${o.orgId}`} className="link ml-auto">
              {tr("Open investor", "Investor öffnen")}
            </Link>
          </div>
          {o.status === "needs_note" && (
            <p className="rounded-xl bg-neg-soft p-3 text-[13px] text-neg">
              {tr("The agent found no verified hook for a personal paragraph. Write it yourself below or regenerate with an instruction – the mail is not sendable until the paragraph is there.", "Der Agent hat keinen belegten Aufhänger für einen persönlichen Absatz gefunden. Schreib ihn unten selbst oder erzeuge den Entwurf mit einer Anweisung neu – ohne Absatz ist die Mail nicht sendbar.")}
            </p>
          )}
          {o.error && <p className="rounded-xl bg-neg-soft p-3 text-[13px] text-neg">{o.error}</p>}
          {o.research && (
            <details className="rounded-xl border border-line p-3" open>
              <summary className="cursor-pointer text-[13px] font-semibold">{tr("Research notes", "Recherche-Notizen")}</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-muted">{o.research}</pre>
            </details>
          )}
          {editable ? (
            <>
              <Field label={tr("Subject", "Betreff")} htmlFor="or-subject">
                <input id="or-subject" className="field" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label={tr("Personal paragraph", "Persönlicher Absatz")} hint={tr("The heart of the mail – one verified, current detail about the investor.", "Das Herzstück der Mail – ein belegtes, aktuelles Detail zum Investor.")} htmlFor="or-personal">
                <textarea id="or-personal" className="field min-h-[110px] font-sans text-[14px]" value={personal} onChange={(e) => setPersonal(e.target.value)} />
              </Field>
              <Field label={tr("Full mail", "Komplette Mail")} htmlFor="or-body">
                <textarea id="or-body" className="field min-h-[260px] font-sans text-[14px]" value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
                <Field label={tr("Regenerate with an instruction (optional)", "Mit Anweisung neu erzeugen (optional)")} className="min-w-[240px] flex-1" htmlFor="or-instr">
                  <input id="or-instr" className="field" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={tr("e.g. mention their investment in …", "z. B. Beteiligung an … aufgreifen")} />
                </Field>
                <Button variant="secondary" icon={<Wand2 className="h-4 w-4" />} loading={busy === "regenerate"} onClick={() => act("regenerate")}>
                  {tr("Regenerate", "Neu erzeugen")}
                </Button>
              </div>
            </>
          ) : (
            <pre className="whitespace-pre-wrap rounded-xl bg-surface2/60 p-3 font-sans text-[14px] leading-relaxed">{o.body}</pre>
          )}
          {o.messages.length > 0 && (
            <section>
              <h3 className="section-title">{tr("Thread", "Verlauf")}</h3>
              <ol className="mt-2 space-y-2">
                {o.messages.map((m) => (
                  <li key={m.id} className={cx("rounded-xl border p-3 text-[13.5px]", m.dir === "in" ? "border-pos/30 bg-pos-soft/40" : "border-line bg-surface")}>
                    <p className="mb-1 text-[12.5px] text-muted">
                      {m.dir === "in" ? tr("Received", "Erhalten") : m.status === "draft" ? tr("Draft", "Entwurf") : tr("Sent", "Gesendet")} · {m.kind} · {relTime(m.createdAt)}
                      {m.subject ? ` · ${m.subject}` : ""}
                    </p>
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed">{m.body}</pre>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {editable && (
              <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={busy === "discard"} onClick={() => act("discard")}>
                {tr("Discard", "Verwerfen")}
              </Button>
            )}
            {["sent", "followup"].includes(o.status) && (
              <Button variant="ghost" icon={<Pause className="h-4 w-4" />} loading={busy === "paused"} onClick={() => act("paused")}>
                {tr("Pause follow-ups", "Follow-ups pausieren")}
              </Button>
            )}
            {o.status === "paused" && (
              <Button variant="ghost" icon={<Play className="h-4 w-4" />} loading={busy === "draft"} onClick={() => act("done")}>
                {tr("Mark done", "Abschließen")}
              </Button>
            )}
            {editable && dirty && (
              <Button variant="secondary" loading={busy === "save"} onClick={() => act("save")}>
                {tr("Save", "Speichern")}
              </Button>
            )}
            {editable && (
              <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy === "send"} disabled={!personal.trim()} onClick={() => act("send")}>
                {tr("Send now", "Jetzt senden")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
