import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Archive,
  BookmarkPlus,
  Building2,
  CheckSquare,
  ChevronDown,
  FileText,
  Forward,
  Inbox,
  Lock,
  Mail as MailIcon,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  ShieldCheck,
  Star,
  Sparkles,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { MailFrame } from "@/components/MailFrame";
import { useIsDesktop } from "@/components/Sheet";
import { Avatar, Button, cx, EmptyState, IconButton, Pill, Skeleton } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import { bytes, CONTACT_CATEGORIES, dateTime, mailTime, orgHref } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { MailConnectForm } from "@/components/MailConnect";
import { IMPORTANT_FOLDER, patchMailInLists, useImportantMail, useMailFolders, useMailListInfinite, useMailMessage, useMailStatus, useMe, useUserMap, useContactMeta } from "@/lib/queries";
import type { ContactLookup, MailFolder, MailMessage, MailSummary, MailSummaryAI, ReplySuggestions } from "@/lib/types";
import { tr } from "@/lib/i18n";

const FOLDER_ICON: Record<string, LucideIcon> = { inbox: Inbox, sent: Send, drafts: FileText, archive: Archive, trash: Trash2, spam: ShieldCheck };
const FOLDER_ORDER = ["inbox", "drafts", "sent", "archive", "custom", "snoozed", "outbox", "templates", "spam", "trash"];

function sortFolders(f: MailFolder[]) {
  return [...f].sort((a, b) => FOLDER_ORDER.indexOf(a.type) - FOLDER_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
}

function htmlText(html: string) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("style,script").forEach((n) => n.remove());
  return (d.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function addr(a: { name: string; email: string }) {
  return a.name || a.email;
}

function useLookup(emails: string[]) {
  const key = [...new Set(emails.filter(Boolean))].sort().join(",");
  return useQuery({
    queryKey: ["contact-lookup", key],
    queryFn: () => api.get<Record<string, ContactLookup>>(`/api/contacts/lookup${qs({ emails: key })}`),
    enabled: !!key,
    staleTime: 60_000,
  });
}

export function MailPage() {
  const me = useMe().data;
  const status = useMailStatus();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  useEffect(() => {
    if (params.get("verbunden")) {
      toast.success(tr("Mailbox connected", "Postfach verbunden"));
      qc.invalidateQueries({ queryKey: ["mail"] });
      params.delete("verbunden");
      setParams(params, { replace: true });
    }
  }, [params, setParams, qc]);

  if (!me) return null;
  if (!me.features.mail)
    return (
      <EmptyState
        icon={<MailIcon className="h-5 w-5" />}
        title={tr("Mailbox connection not set up yet", "Postfach-Anbindung noch nicht eingerichtet")}
        text={tr("An admin needs to configure the mail server on the server (MAIL_IMAP_HOST / MAIL_SMTP_HOST). The instructions are in the setup documentation.", "Eine Admin-Person muss auf dem Server den Mailserver einrichten (MAIL_IMAP_HOST / MAIL_SMTP_HOST). Die Anleitung steht in der Setup-Dokumentation.")}
      />
    );
  if (status.isLoading) return <Skeleton className="h-96" />;
  if (!status.data?.connected) return <ConnectMailbox error={params.get("fehler")} />;
  return <Mailbox />;
}

/** The server only puts error codes in the URL – the texts live here (no reflected text). */
const OAUTH_ERRORS = (): Record<string, string> => ({
  mismatch: tr(
    "The Zoho mailbox you signed in with doesn't belong to your intranet account. Sign in to Zoho with your own mailbox.",
    "Das Zoho-Postfach, mit dem du dich angemeldet hast, gehört nicht zu deinem Intranet-Konto. Melde dich bei Zoho mit deinem eigenen Postfach an.",
  ),
  denied: tr(
    "You didn't grant access in Zoho. Without access the intranet can't show your mailbox.",
    "Du hast den Zugriff in Zoho nicht freigegeben. Ohne Freigabe kann das Intranet dein Postfach nicht anzeigen.",
  ),
  invalid: tr("The Zoho sign-in expired or is invalid. Please start the connection again.", "Die Anmeldung bei Zoho ist abgelaufen oder ungültig. Bitte starte die Verbindung erneut."),
  no_refresh: tr(
    "Zoho didn't grant permanent access. Disconnect the app under accounts.zoho.eu → Security → Connected apps, then connect again.",
    "Zoho hat keinen dauerhaften Zugriff gewährt. Trenne die App unter accounts.zoho.eu → Sicherheit → Verbundene Apps und verbinde dann neu.",
  ),
  unknown_dc: tr("Your Zoho account is hosted in an unknown data center. Please contact an admin.", "Dein Zoho-Konto liegt in einem unbekannten Rechenzentrum. Bitte wende dich an die Admin-Person."),
  reconnect: tr("Zoho rejected the connection. Please connect your mailbox again.", "Zoho hat die Verbindung abgelehnt. Bitte verbinde dein Postfach erneut."),
  upstream: tr("Zoho can't be reached right now. Please try again in a few minutes.", "Zoho ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten erneut."),
});

function ConnectMailbox({ error: errorCode }: { error: string | null }) {
  const error = errorCode ? (OAUTH_ERRORS()[errorCode] ?? tr("Connecting the mailbox failed. Please try again.", "Die Verbindung mit dem Postfach ist fehlgeschlagen. Bitte versuche es erneut.")) : null;
  const me = useMe().data;
  const status = useMailStatus().data;
  const provider = status?.providerName || "Spacemail";
  return (
    <div className="mx-auto max-w-xl py-4">
      <div className="card overflow-hidden">
        <div className="bg-rail px-6 py-7 text-rail-ink">
          <MailIcon className="h-8 w-8 text-accent" />
          <h1 className="mt-4 text-[24px] font-extrabold leading-tight tracking-[-0.02em]">{tr("Your mailbox in the intranet", "Dein Postfach im Intranet")}</h1>
          <p className="mt-2 text-[15px] text-rail-muted">{tr("Read, reply and link to tasks and contacts – with AI drafts you review before sending.", "Lesen, beantworten und mit Aufgaben und Kontakten verknüpfen – mit KI-Entwürfen, die du vor dem Senden prüfst.")}</p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <ul className="space-y-3 text-[14.5px]">
            <li className="flex gap-3">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <span>
                <b>{tr("Only you can see your mailbox.", "Nur du siehst dein Postfach.")}</b>{" "}
                {tr(
                  `Admins have no access either. The connection applies only to your account (${me?.user?.email ?? ""}).`,
                  `Auch Admins haben keinen Zugriff. Die Verbindung gilt nur für dein Konto (${me?.user?.email ?? ""}).`,
                )}
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <span>
                {status?.mode === "imap"
                  ? tr(`Mail content isn't stored in the intranet; it's loaded live from ${provider}. Your mailbox password is stored encrypted on the server.`, `Mail-Inhalte werden nicht im Intranet gespeichert, sondern live von ${provider} geladen. Dein Postfach-Passwort liegt verschlüsselt auf dem Server.`)
                  : tr(`Mail content isn't stored in the intranet; it's loaded live from ${provider}. The access key is stored encrypted on the server.`, `Mail-Inhalte werden nicht im Intranet gespeichert, sondern live von ${provider} geladen. Der Zugangsschlüssel liegt verschlüsselt auf dem Server.`)}
              </span>
            </li>
            <li className="flex gap-3">
              <X className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
              <span>{tr("You can disconnect at any time in Settings. If your intranet password is reset, the intranet disconnects automatically.", "Du kannst die Verbindung jederzeit in den Einstellungen trennen. Wird dein Intranet-Passwort zurückgesetzt, trennt das Intranet sie automatisch.")}</span>
            </li>
          </ul>
          {error && <p className="rounded-xl bg-neg-soft px-3 py-2.5 text-sm font-medium text-neg">{error}</p>}
          <MailConnectForm status={status} />
          {status && status.mode !== "imap" && status.mode !== "demo" && (
            <p className="text-center text-[12.5px] text-muted">{tr(`You'll be redirected to ${provider} to sign in with your own mailbox.`, `Du wirst zu ${provider} weitergeleitet und meldest dich dort mit deinem eigenen Postfach an.`)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Mailbox() {
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const status = useMailStatus().data!;
  const folders = useMailFolders(true);
  const sorted = useMemo(() => sortFolders(folders.data ?? []), [folders.data]);
  const inbox = sorted.find((f) => f.type === "inbox");
  const folderId = params.get("f") ?? inbox?.id;
  const messageId = params.get("m");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [search, setSearch] = useState(params.get("q") ?? "");
  const important = folderId === IMPORTANT_FOLDER && !search;
  const normal = useMailListInfinite(search ? undefined : important ? undefined : folderId, search, !important && (!!folderId || !!search));
  const imp = useImportantMail(important);
  const list = important ? imp : normal;
  const items = useMemo(() => (list.data?.pages ?? []).flatMap((pg) => pg.items), [list.data]);
  const folder = sorted.find((f) => f.id === folderId);
  const scanned = important ? (imp.data?.pages ?? []).reduce((a, pg) => a + pg.scanned, 0) : 0;
  // Open mail: in the "Important" folder it actually lives in the inbox
  const readerFolder = params.get("mf") ?? (important ? inbox?.id : folderId);
  const { open } = useOverlays();
  const qc = useQueryClient();

  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: !("m" in patch) });
  };

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const senders = items.map((m) => (folder?.type === "sent" ? m.to[0]?.email : m.from.email) ?? "");
  const lookup = useLookup(senders).data ?? {};

  const showReader = !!messageId;
  const listPane = (
    <div className={cx("flex min-h-0 flex-col", desktop && "border-r border-line")}>
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
            <Search className="h-4 w-4 text-muted" />
            <input className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70" placeholder={tr("Search mail", "Mails durchsuchen")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search mail", "Mails durchsuchen")} />
            {q && (
              <button aria-label={tr("Clear search", "Suche löschen")} onClick={() => setQ("")}>
                <X className="h-4 w-4 text-muted" />
              </button>
            )}
          </div>
          <IconButton label={tr("Refresh", "Aktualisieren")} onClick={() => qc.invalidateQueries({ queryKey: ["mail"] })}>
            <RefreshCw className={cx("h-[18px] w-[18px]", list.isFetching && "animate-spin")} />
          </IconButton>
          <IconButton label={tr("New e-mail", "Neue E-Mail")} className="hidden lg:inline-grid" onClick={() => open({ kind: "compose", defaults: {} })}>
            <PenSquare className="h-[18px] w-[18px]" />
          </IconButton>
        </div>
        {!desktop && (
          <div className="scrollbar-none -mx-3 flex gap-1.5 overflow-x-auto px-3">
            {sorted
              .filter((f) => ["inbox", "drafts", "sent", "archive", "custom", "spam", "trash"].includes(f.type))
              .flatMap((f) => (f.type === "inbox" ? [f, { id: IMPORTANT_FOLDER, name: tr("Important", "Wichtig"), type: "important" as const, path: "" }] : [f]))
              .map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setQ("");
                    setParam({ f: f.id, m: null, mf: null });
                  }}
                  className={cx(
                    "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold",
                    f.id === folderId && !search ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted",
                  )}
                >
                  {f.type === "important" && <Star className="h-3.5 w-3.5" />}
                  {f.name}
                </button>
              ))}
          </div>
        )}
      </div>
      {status.needsReconnect && <ReconnectBanner />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorBox error={list.error} />
        ) : !items.length ? (
          important ? (
            <EmptyState
              icon={<Star className="h-5 w-5" />}
              title={tr("No important mail", "Keine wichtigen Mails")}
              text={tr(
                `None of the last ${scanned || 300} inbox messages are from investors, clients, partners or stakeholders.`,
                `In den letzten ${scanned || 300} Mails im Posteingang ist niemand aus Investoren, Kunden, Partnern oder Stakeholdern dabei.`,
              )}
            />
          ) : (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title={search ? tr("No results", "Keine Treffer") : tr("No messages", "Keine Nachrichten")} text={search ? tr(`Nothing found for "${search}".`, `Nichts gefunden für „${search}“.`) : tr("This folder is empty.", "Dieser Ordner ist leer.")} />
          )
        ) : (
          <ul>
            {important && (
              <li className="border-b border-line bg-surface2/50 px-3.5 py-2 text-[12.5px] text-muted">
                {tr(
                  `Mail from investors, clients, partners and stakeholders in the CRM – from the last ${scanned} inbox messages.`,
                  `Mails von Investoren, Kunden, Partnern und Stakeholdern aus dem CRM – aus den letzten ${scanned} Mails im Posteingang.`,
                )}
              </li>
            )}
            {items.map((m) => (
              <MailRow
                key={m.id}
                m={m}
                sent={folder?.type === "sent" || folder?.type === "drafts"}
                active={m.id === messageId}
                contact={lookup[(folder?.type === "sent" ? m.to[0]?.email : m.from.email) ?? ""]}
                onOpen={() => setParam(important ? { m: m.id, mf: m.folderId } : { f: m.folderId, m: m.id, mf: null })}
              />
            ))}
            {list.hasNextPage && (
              <li className="p-3">
                <Button variant="secondary" className="w-full" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                  {important ? tr("Search further back", "Weiter zurück suchen") : tr("Load older messages", "Ältere Nachrichten laden")}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );

  if (desktop) {
    return (
      <div className="-mb-12 -mt-6 grid h-[calc(100dvh-64px)] grid-cols-[210px_380px_1fr] overflow-hidden border-x border-line bg-surface lg:-mx-8">
        <nav className="flex flex-col gap-0.5 overflow-y-auto border-r border-line bg-bg/60 p-3" aria-label={tr("Folders", "Ordner")}>
          <Button variant="primary" className="mb-3 w-full" icon={<PenSquare className="h-4 w-4" />} onClick={() => open({ kind: "compose", defaults: {} })}>
            {tr("New e-mail", "Neue E-Mail")}
          </Button>
          {sorted.flatMap((f) => (f.type === "inbox" ? [f, { id: IMPORTANT_FOLDER, name: tr("Important", "Wichtig"), type: "important", path: "" }] : [f])).map((f) => {
            const Icon = f.type === "important" ? Star : (FOLDER_ICON[f.type] ?? MailIcon);
            return (
              <button
                key={f.id}
                onClick={() => {
                  setQ("");
                  setParam({ f: f.id, m: null, mf: null });
                }}
                className={cx("flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-left text-sm font-medium", f.id === folderId && !search ? "bg-surface text-ink shadow-[0_1px_3px_rgb(15_27_45/.1)]" : "text-muted hover:bg-surface2 hover:text-ink")}
              >
                <Icon className={cx("h-4 w-4 shrink-0", f.type === "important" && "text-accent")} />
                <span className="truncate">{f.name}</span>
              </button>
            );
          })}
          <p className="mt-auto truncate px-2.5 pt-4 text-[12px] text-muted" title={status.email}>
            {status.email}
          </p>
        </nav>
        {listPane}
        <div className="min-h-0 overflow-y-auto bg-bg">
          {messageId && readerFolder ? (
            <Reader key={messageId} folderId={readerFolder} messageId={messageId} onClose={() => setParam({ m: null, mf: null })} />
          ) : (
            <div className="grid h-full place-items-center text-center text-muted">
              <div>
                <MailOpen className="mx-auto h-8 w-8" />
                <p className="mt-2 text-sm">{tr("Select a message.", "Wähle eine Nachricht aus.")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4 -mt-4">
      {showReader && readerFolder ? (
        <Reader folderId={readerFolder} messageId={messageId!} onClose={() => setParam({ m: null, mf: null })} />
      ) : (
        <div className="min-h-[60vh] bg-surface">{listPane}</div>
      )}
    </div>
  );
}

function ReconnectBanner() {
  const status = useMailStatus().data;
  return (
    <div className="flex flex-wrap items-center gap-2 bg-accent-soft px-3 py-2.5 text-[13px]">
      <span className="flex-1">
        {status?.mode === "imap"
          ? tr(`${status.providerName} no longer accepts the stored password. Enter your current mailbox password:`, `${status.providerName} akzeptiert das gespeicherte Passwort nicht mehr. Gib dein aktuelles Postfach-Passwort ein:`)
          : tr("The connection to your mailbox has expired.", "Die Verbindung zu deinem Postfach ist abgelaufen.")}
      </span>
      <div className={status?.mode === "imap" ? "w-full" : ""}>
        <MailConnectForm compact status={status} />
      </div>
    </div>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? error.message : tr("Couldn't load the mailbox.", "Das Postfach konnte nicht geladen werden.");
  return (
    <div className="m-3 rounded-xl bg-neg-soft px-3 py-3 text-sm text-neg">
      <p className="font-semibold">{msg}</p>
      {error instanceof ApiError && error.code === "reconnect" && <ReconnectBanner />}
    </div>
  );
}

function MailRow({ m, sent, active, contact, onOpen }: { m: MailSummary; sent: boolean; active: boolean; contact?: ContactLookup; onOpen: () => void }) {
  const stageLabels = useContactMeta().data?.stageLabels;
  const who = sent ? (m.to[0] ? addr(m.to[0]) : tr("(no recipient)", "(kein Empfänger)")) : addr(m.from);
  return (
    <li>
      <button onClick={onOpen} className={cx("flex w-full gap-3 border-b border-line px-3.5 py-3 text-left transition", active ? "bg-info-soft/60" : "hover:bg-surface2/60")}>
        <div className="relative pt-0.5">
          <Avatar name={who} color={contact ? "navy" : "slate"} size={36} />
          {m.unread && <span className="absolute -left-1 top-0 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" aria-label={tr("Unread", "Ungelesen")} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cx("min-w-0 flex-1 truncate text-[14.5px]", m.unread ? "font-bold" : "font-semibold text-ink/90")}>
              {sent && <span className="font-normal text-muted">{tr("To: ", "An: ")}</span>}
              {who}
            </span>
            {m.hasAttachment && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-label={tr("Attachment", "Anhang")} />}
            <span className={cx("shrink-0 text-[12px]", m.unread ? "font-semibold text-ink" : "text-muted")}>{mailTime(m.date)}</span>
          </div>
          <p className={cx("truncate text-[14px]", m.unread ? "font-semibold" : "")}>{m.subject}</p>
          <p className="line-clamp-2 text-[13px] leading-snug text-muted">{m.snippet}</p>
          {!contact && m.importance && (
            <span className="mt-1.5 inline-flex items-center gap-1.5">
              <span className={cx("rounded px-1.5 py-px text-[11px] font-bold", CONTACT_CATEGORIES[m.importance.kind]?.tone)}>{CONTACT_CATEGORIES[m.importance.kind]?.label}</span>
              <span className="text-[11.5px] text-muted">{m.importance.label}</span>
            </span>
          )}
          {contact && (
            <span className="mt-1.5 inline-flex items-center gap-1.5">
              <span className={cx("rounded px-1.5 py-px text-[11px] font-bold", CONTACT_CATEGORIES[contact.category]?.tone)}>{CONTACT_CATEGORIES[contact.category]?.label}</span>
              <span className="text-[11.5px] text-muted">{stageLabels?.[contact.stage] ?? contact.stage}</span>
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function Reader({ folderId, messageId, onClose }: { folderId: string; messageId: string; onClose: () => void }) {
  const stageLabels = useContactMeta().data?.stageLabels;
  const qc = useQueryClient();
  const me = useMe().data;
  const { open } = useOverlays();
  const users = useUserMap();
  const { data: m, isLoading, error } = useMailMessage(folderId, messageId);
  const mailStatus = useMailStatus().data;
  const [showTo, setShowTo] = useState(false);
  const [summary, setSummary] = useState<MailSummaryAI | null>(null);
  const lookup = useLookup(m ? [m.from.email] : []).data ?? {};
  const contact = m ? lookup[m.from.email] : undefined;

  useEffect(() => {
    if (m && !m.unread) {
      // Refresh list & counter after the automatic mark-as-read
      patchMailInLists(qc, m.id, { unread: false });
      qc.invalidateQueries({ queryKey: ["mail", "unread"] });
    }
  }, [m, qc]);

  const summarize = useMutation({
    mutationFn: () => api.post<MailSummaryAI>("/api/ai/summarize", { folderId, messageId }),
    onSuccess: setSummary,
    onError: (e) => toast.error((e as Error).message),
  });

  const markUnread = useMutation({
    mutationFn: () => api.post("/api/mail/messages/read", { ids: [messageId], read: false }),
    onSuccess: () => {
      patchMailInLists(qc, messageId, { unread: true });
      qc.removeQueries({ queryKey: ["mail", "msg", folderId, messageId] });
      qc.invalidateQueries({ queryKey: ["mail", "unread"] });
      toast(tr("Marked as unread", "Als ungelesen markiert"));
      onClose();
    },
  });

  const logToContact = useMutation({
    mutationFn: (msg: MailMessage) =>
      api.post(`/api/contacts/${contact!.id}/activities`, {
        kind: "mail",
        // Prefix the direction – the client/investor overview uses it to spot open replies.
        // "Gesendet"/"Erhalten" are stored markers parsed by the server (org-dashboard), so they stay as is.
        body: `${[mailStatus?.email, ...(mailStatus?.addresses ?? [])].some((a) => a && a.toLowerCase() === msg.from.email.toLowerCase()) ? "Gesendet" : "Erhalten"}: ${msg.subject}\n\n${htmlText(msg.html).slice(0, 3000)}`,
        mailRef: { messageId: msg.id, folderId: msg.folderId, subject: msg.subject.slice(0, 300), date: msg.date },
      }),
    onSuccess: () => {
      toast.success(tr("Saved to contact activity", "Im Kontaktverlauf gespeichert"), { description: contact?.name });
      qc.invalidateQueries({ queryKey: ["contact", contact?.id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading)
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  if (error || !m)
    return (
      <div className="p-4">
        <button onClick={onClose} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
          <ArrowLeft className="h-4 w-4" /> {tr("Back", "Zurück")}
        </button>
        <ErrorBox error={error} />
      </div>
    );

  const myAddresses = new Set([...(mailStatus?.addresses ?? []), ...(me?.user ? [me.user.email] : [])].map((a) => a.toLowerCase()));
  const replyDefaults = (all: boolean, auto = false) => ({
    reply: {
      messageId: m.id,
      folderId: m.folderId,
      subject: m.subject,
      from: m.from.email,
      to: [m.from.email],
      cc: all ? [...m.to, ...m.cc].map((a) => a.email).filter((e) => e !== m.from.email && !myAddresses.has(e)) : [],
    },
    autoDraft: auto,
  });
  const forward = () => {
    const fromLine = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
    const toLine = m.to.map((a) => a.email).join(", ");
    open({
      kind: "compose",
      defaults: {
        subject: /^(wg|fwd?):/i.test(m.subject) ? m.subject : tr(`Fwd: ${m.subject}`, `WG: ${m.subject}`),
        body: tr(
          `\n\n---------- Forwarded message ----------\nFrom: ${fromLine}\nDate: ${dateTime(m.date)}\nSubject: ${m.subject}\nTo: ${toLine}\n\n${htmlText(m.html)}`,
          `\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${fromLine}\nDatum: ${dateTime(m.date)}\nBetreff: ${m.subject}\nAn: ${toLine}\n\n${htmlText(m.html)}`,
        ),
      },
    });
  };
  const createTask = (title?: string, due?: string | null) =>
    open({
      kind: "task",
      defaults: {
        title: title ?? tr(`Reply: ${m.subject}`, `Antworten: ${m.subject}`).slice(0, 200),
        dueDate: due ?? null,
        contactId: contact?.id ?? null,
        sourceMail: { ownerId: me?.user?.id ?? "", messageId: m.id, folderId: m.folderId, subject: m.subject.slice(0, 300), from: addr(m.from).slice(0, 300) },
      },
    });
  const owner = contact?.ownerId ? users.get(contact.ownerId) : undefined;
  const domain = m.from.email.split("@")[1] ?? "";
  const companyGuess = /gmail|gmx|web\.de|outlook|hotmail|yahoo|icloud|t-online/.test(domain) ? "" : domain.split(".").slice(-2, -1)[0]?.replace(/-/g, " ") ?? "";

  const actions: { label: string; icon: LucideIcon; run: () => void; primary?: boolean; ai?: boolean }[] = [
    { label: tr("Reply", "Antworten"), icon: Reply, run: () => open({ kind: "compose", defaults: replyDefaults(false) }), primary: true },
    ...(me?.features.ai ? [{ label: tr("AI reply", "KI-Antwort"), icon: Sparkles, run: () => open({ kind: "compose", defaults: replyDefaults(false, true) }), ai: true }] : []),
    { label: tr("Reply all", "Allen antworten"), icon: ReplyAll, run: () => open({ kind: "compose", defaults: replyDefaults(true) }) },
    { label: tr("Forward", "Weiterleiten"), icon: Forward, run: forward },
    { label: tr("Task", "Aufgabe"), icon: CheckSquare, run: () => createTask() },
  ];

  return (
    <article className="mx-auto max-w-[860px] px-4 pb-8 pt-3 lg:px-7 lg:pt-6">
      <div className="mb-3 flex items-center gap-1 lg:hidden">
        <button onClick={onClose} className="-ml-1 inline-flex h-10 items-center gap-1.5 pr-3 text-sm font-semibold text-muted">
          <ArrowLeft className="h-4 w-4" /> {tr("Mail", "Postfach")}
        </button>
        <div className="flex-1" />
        <IconButton label={tr("Mark as unread", "Als ungelesen markieren")} onClick={() => markUnread.mutate()}>
          <MailIcon className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
      <h1 className="text-[21px] font-extrabold leading-snug tracking-[-0.015em] lg:text-[24px]">{m.subject}</h1>
      <div className="mt-3 flex items-start gap-3">
        <Avatar name={addr(m.from)} color={contact ? "navy" : "slate"} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">
            {m.from.name || m.from.email}
            {m.from.name && <span className="font-normal text-muted"> &lt;{m.from.email}&gt;</span>}
          </p>
          <button className="flex max-w-full items-center gap-1 text-[13px] text-muted" onClick={() => setShowTo((v) => !v)} aria-expanded={showTo}>
            <span className="truncate">
              {tr("To", "An")} {m.to.map(addr).join(", ") || "–"}
            </span>
            <ChevronDown className={cx("h-3.5 w-3.5 shrink-0 transition", showTo && "rotate-180")} />
          </button>
          {showTo && (
            <div className="mt-1 space-y-0.5 text-[12.5px] text-muted">
              <p>{tr("To:", "An:")} {m.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}</p>
              {m.cc.length > 0 && <p>Cc: {m.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}</p>}
            </div>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[12.5px] text-muted">{mailTime(m.date)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
        {contact ? (
          <>
            <Link to={`/kontakte/${contact.id}`} className="flex min-w-0 flex-1 items-center gap-2">
              <Pill className={CONTACT_CATEGORIES[contact.category]?.tone}>{CONTACT_CATEGORIES[contact.category]?.label}</Pill>
              <span className="min-w-0 truncate text-[13.5px]">
                <b>{contact.name}</b>
                {contact.company && <span className="text-muted">, {contact.company}</span>}
                {contact.stage && <span className="text-muted">, {stageLabels?.[contact.stage] ?? contact.stage}</span>}
                {owner && <span className="text-muted">{tr(`, managed by ${owner.name.split(" ")[0]}`, `, betreut von ${owner.name.split(" ")[0]}`)}</span>}
              </span>
            </Link>
            {contact.organizationId && (
              <Link
                to={orgHref(contact.organizationKind, contact.organizationId)}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-[12.5px] font-semibold hover:bg-line/60"
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{contact.organizationName}</span>
              </Link>
            )}
            <Button size="sm" variant="ghost" icon={<BookmarkPlus className="h-4 w-4" />} loading={logToContact.isPending} onClick={() => logToContact.mutate(m)}>
              {tr("Save to activity", "Im Verlauf speichern")}
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-[13px] text-muted">{tr("Not a contact in the CRM yet.", "Noch kein Kontakt im CRM.")}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={<UserPlus className="h-4 w-4" />}
              onClick={() => open({ kind: "contact", defaults: { name: m.from.name || "", email: m.from.email, company: companyGuess.replace(/\b\w/g, (c) => c.toUpperCase()) } })}
            >
              {tr("Add as contact", "Als Kontakt anlegen")}
            </Button>
          </>
        )}
      </div>

      <div className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
        {actions.map((a) => (
          <Button key={a.label} size="sm" variant={a.primary ? "primary" : a.ai ? "accent" : "secondary"} icon={<a.icon className="h-4 w-4" />} onClick={a.run} className="shrink-0">
            {a.label}
          </Button>
        ))}
        {me?.features.ai && (
          <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} loading={summarize.isPending} onClick={() => summarize.mutate()} className="shrink-0">
            {tr("Summarize", "Zusammenfassen")}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<MailIcon className="h-4 w-4" />} onClick={() => markUnread.mutate()} className="hidden shrink-0 lg:inline-flex">
          {tr("Unread", "Ungelesen")}
        </Button>
      </div>

      {me?.features.ai && !myAddresses.has(m.from.email.toLowerCase()) && (
        <ReplySuggestionsBox
          folderId={folderId}
          messageId={messageId}
          auto={me.prefs?.autoSuggest !== false}
          onPick={(sg) => open({ kind: "compose", defaults: { ...replyDefaults(false), body: sg.text, suggestion: sg.label } })}
        />
      )}

      {summary && (
        <section className="mt-3 rounded-2xl border border-accent/40 bg-accent-soft/40 p-4 animate-slide-up">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h2 className="flex-1 text-sm font-bold">{tr("Summary", "Zusammenfassung")}</h2>
            {summary.needsReply && <Pill className="bg-surface text-ink">{tr("Reply expected", "Antwort erwartet")}</Pill>}
            {summary.urgency === "hoch" && <Pill className="bg-neg-soft text-neg">{tr("Urgent", "Dringend")}</Pill>}
            <IconButton label={tr("Close summary", "Zusammenfassung schließen")} size="sm" onClick={() => setSummary(null)}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <p className="mt-2 text-[14.5px] leading-relaxed">{summary.summary}</p>
          {summary.keyPoints.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
              {summary.keyPoints.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          )}
          {summary.actions.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[12.5px] font-semibold text-muted">{tr("Suggested tasks", "Vorgeschlagene Aufgaben")}</p>
              {summary.actions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
                  <CheckSquare className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 text-sm">{a.title}</span>
                  <Button size="sm" variant="ghost" onClick={() => createTask(a.title, a.due)}>
                    {tr("Add task", "Übernehmen")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {m.attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <a
              key={a.id}
              href={`/api/mail/messages/${m.folderId}/${m.id}/attachments/${a.id}${qs({ name: a.name })}`}
              className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] hover:bg-surface2"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted" />
              <span className="truncate font-semibold">{a.name}</span>
              <span className="num shrink-0 text-muted">{bytes(a.size)}</span>
            </a>
          ))}
        </div>
      )}

      <div className="mt-4">
        <MailFrame html={m.html} messageKey={m.id} />
      </div>
      <p className="mt-3 text-[12px] text-muted">{dateTime(m.date)}</p>
    </article>
  );
}

/** Automatic AI reply suggestions below a received mail */
function ReplySuggestionsBox({
  folderId,
  messageId,
  auto,
  onPick,
}: {
  folderId: string;
  messageId: string;
  auto: boolean;
  onPick: (s: ReplySuggestions["suggestions"][number]) => void;
}) {
  const qc = useQueryClient();
  const [wanted, setWanted] = useState(auto);
  const key = ["ai-suggest", folderId, messageId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.post<ReplySuggestions>("/api/ai/suggestions", { folderId, messageId }),
    enabled: wanted,
    staleTime: Infinity,
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => api.post<ReplySuggestions>("/api/ai/suggestions", { folderId, messageId, refresh: true }),
    onSuccess: (d) => qc.setQueryData(key, d),
    onError: (e) => toast.error((e as Error).message),
  });

  if (!wanted)
    return (
      <div className="mt-3">
        <Button size="sm" variant="ghost" icon={<Sparkles className="h-4 w-4 text-accent" />} onClick={() => setWanted(true)}>
          {tr("Show reply suggestions", "Antwortvorschläge anzeigen")}
        </Button>
      </div>
    );

  return (
    <section className="mt-3 rounded-2xl border border-line bg-surface p-3.5" aria-label={tr("Reply suggestions", "Antwortvorschläge")} aria-busy={q.isLoading || refresh.isPending}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="flex-1 text-sm font-bold">{tr("Reply suggestions", "Antwortvorschläge")}</h2>
        {q.data && (
          <button type="button" className="link text-[12.5px]" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            {refresh.isPending ? tr("Regenerating …", "Wird neu erstellt …") : tr("Suggest again", "Neu vorschlagen")}
          </button>
        )}
      </div>
      {q.isLoading ? (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[74px]" />
          ))}
        </div>
      ) : q.error ? (
        <p className="mt-2 text-[13px] text-muted">
          {(q.error as Error).message}{" "}
          <button className="link" onClick={() => void q.refetch()}>
            {tr("Try again", "Erneut versuchen")}
          </button>
        </p>
      ) : q.data && q.data.suggestions.length ? (
        <>
          {!q.data.needsReply && <p className="mt-1 text-[12.5px] text-muted">{tr("This mail probably doesn't need a reply.", "Diese Mail braucht vermutlich keine Antwort.")}</p>}
          <div className={cx("mt-2.5 grid gap-2", q.data.suggestions.length > 1 && "sm:grid-cols-2", q.data.suggestions.length > 2 && "lg:grid-cols-3")}>
            {q.data.suggestions.map((sg) => (
              <button
                key={sg.label}
                type="button"
                onClick={() => onPick(sg)}
                className="group flex flex-col rounded-xl border border-line bg-bg/50 p-3 text-left transition hover:border-accent/60 hover:bg-accent-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <span className="text-[13.5px] font-bold">{sg.label}</span>
                <span className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{sg.gist}</span>
                <span className="mt-2 text-[12.5px] font-semibold text-accent-ink group-hover:underline">{tr("Use and adjust", "Übernehmen und anpassen")}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-muted">{tr('No fitting suggestions – write the reply with "AI reply".', "Keine passenden Vorschläge – schreib die Antwort mit „KI-Antwort“.")}</p>
      )}
    </section>
  );
}
