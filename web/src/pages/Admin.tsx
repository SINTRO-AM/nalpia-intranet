import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FileJson, Lock, Mail, MoreHorizontal, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AvatarEditor } from "@/components/AvatarEditor";
import { Select } from "@/components/pickers";
import { ReauthCancelled, ReauthProvider, useGuarded } from "@/components/Reauth";
import { Sheet } from "@/components/Sheet";
import { Avatar, Button, cx, EmptyState, Field, IconButton, Pill, Segmented, Skeleton, Switch } from "@/components/ui";
import { api, ApiError, qs } from "@/lib/api";
import { relTime } from "@/lib/format";
import { useMe } from "@/lib/queries";
import type { User } from "@/lib/types";
import { locale, tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

interface AdminUser extends User {
  totpEnabled: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  locked: boolean;
  mail: { email: string; needsReconnect: boolean } | null;
}

type Tab = "personen" | "protokoll" | "einstellungen" | "import";

export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "personen";
  return (
    <ReauthProvider>
    <div className="space-y-4">
      <header>
        <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{tr("Admin", "Verwaltung")}</h1>
        <p className="text-[14px] text-muted">{tr("Access, security, audit log and data import.", "Zugänge, Sicherheit, Protokoll und Datenimport.")}</p>
      </header>
      <Segmented<Tab>
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[
          { value: "personen", label: tr("People", "Personen") },
          { value: "protokoll", label: tr("Audit log", "Protokoll") },
          { value: "einstellungen", label: tr("Security", "Sicherheit") },
          { value: "import", label: "Import" },
        ]}
      />
      {tab === "personen" && <People />}
      {tab === "protokoll" && <AuditLog />}
      {tab === "einstellungen" && <OrgSettings />}
      {tab === "import" && (
        <div className="space-y-4">
          <TeamTemplate />
          <NewsTemplate />
          <CrmImport />
        </div>
      )}
    </div>
    </ReauthProvider>
  );
}

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
      <code className="num min-w-0 flex-1 truncate text-[12.5px]">{url}</code>
      <IconButton
        label={tr("Copy link", "Link kopieren")}
        size="sm"
        onClick={() =>
          navigator.clipboard.writeText(url).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? <Check className="h-4 w-4 text-pos" /> : <Copy className="h-4 w-4" />}
      </IconButton>
    </div>
  );
}

function People() {
  const qc = useQueryClient();
  const me = useMe().data?.user;
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => api.get<{ users: AdminUser[]; smtp: boolean; allowedDomains: string[] }>("/api/admin/users") });
  const [invite, setInvite] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string; kind: string } | null>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const guarded = useGuarded();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["users"] });
  };
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await guarded(fn);
      refresh();
      if (ok) toast.success(ok);
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error((e as Error).message);
    }
  };

  if (isLoading || !data) return <Skeleton className="h-72" />;
  const statusPill = (u: AdminUser) =>
    u.status === "active" ? <Pill className="bg-pos-soft text-pos">{tr("Active", "Aktiv")}</Pill> : u.status === "invited" ? <Pill className="bg-accent-soft text-accent-ink">{tr("Invited", "Eingeladen")}</Pill> : <Pill>{tr("Disabled", "Deaktiviert")}</Pill>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          <span className="num font-semibold text-ink">{data.users.filter((u) => u.status === "active").length}</span> {tr("active", "aktiv")},{" "}
          <span className="num font-semibold text-ink">{data.users.filter((u) => u.status === "invited").length}</span> {tr("invited", "eingeladen")}
        </p>
        <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInvite(true)}>
          {tr("Invite people", "Personen einladen")}
        </Button>
      </div>
      {link && (
        <div className="card space-y-2 p-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">
              {link.kind === "invite" ? tr(`Invite link for ${link.name}`, `Einladungslink für ${link.name}`) : tr(`Password setup link for ${link.name}`, `Link zum Passwort-Setzen für ${link.name}`)}
            </p>
            <button className="text-[13px] font-semibold text-muted" onClick={() => setLink(null)}>
              {tr("Close", "Schließen")}
            </button>
          </div>
          <CopyLink url={link.url} />
          <p className="text-[12.5px] text-muted">
            {tr("Send the link personally (e.g. via Signal or Teams).", "Schicke den Link persönlich (z. B. per Signal oder Teams).")} {link.kind === "invite" ? tr("Valid for 7 days.", "7 Tage gültig.") : tr("Valid for 24 hours. The person will be notified and will then need to reconnect their mailbox themselves.", "24 Stunden gültig. Die Person wird informiert, und ihr Postfach muss sie danach selbst neu verbinden.")}
          </p>
        </div>
      )}
      <div className="card divide-y divide-line">
        {data.users.map((u) => (
          <div key={u.id} className={cx("flex items-center gap-3 px-4 py-3", u.status === "disabled" && "opacity-60")}>
            <Avatar name={u.name} color={u.avatarColor} src={u.avatarUrl} size={38} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="truncate font-semibold">{u.name}</span>
                {u.role === "admin" && <Pill className="bg-info-soft text-info">Admin</Pill>}
                {statusPill(u)}
                {u.locked && <Pill className="bg-neg-soft text-neg">{tr("Locked", "Gesperrt")}</Pill>}
              </p>
              <p className="truncate text-[13px] text-muted">
                {u.email}
                {u.title && <>, <Tx text={u.title} /></>}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted">
                <span className={cx("inline-flex items-center gap-1", u.totpEnabled && "text-pos")}>
                  <ShieldCheck className="h-3.5 w-3.5" /> {u.totpEnabled ? tr("2FA active", "2FA aktiv") : tr("no 2FA", "ohne 2FA")}
                </span>
                <span className={cx("inline-flex items-center gap-1", u.mail && "text-pos")}>
                  <Mail className="h-3.5 w-3.5" /> {u.mail ? (u.mail.needsReconnect ? tr("Mailbox: reconnect needed", "Postfach: neu verbinden") : tr("Mailbox connected", "Postfach verbunden")) : tr("no mailbox", "kein Postfach")}
                </span>
                <span>{u.lastLoginAt ? tr(`last seen ${relTime(u.lastLoginAt)}`, `zuletzt ${relTime(u.lastLoginAt)}`) : tr("never signed in", "noch nie angemeldet")}</span>
              </p>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label={tr(`Actions for ${u.name}`, `Aktionen für ${u.name}`)}>
                  <MoreHorizontal className="h-5 w-5" />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" className="z-50 min-w-[230px] rounded-xl border border-line bg-surface p-1.5 shadow-pop">
                  {u.status !== "disabled" && (
                    <MenuItem
                      onSelect={() =>
                        act(async () => {
                          const r = await api.post<{ url: string | null; kind: string; emailed: boolean }>(`/api/admin/users/${u.id}/link`, { sendEmail: data.smtp });
                          if (r.url) setLink({ name: u.name, url: r.url, kind: r.kind });
                          if (r.emailed) toast.success(tr(`Link e-mailed to ${u.email}`, `Link per E-Mail an ${u.email} verschickt`));
                        })
                      }
                    >
                      {u.status === "invited" ? tr("Create new invite link", "Neuen Einladungslink erzeugen") : tr("Password reset link", "Link zum Passwort-Zurücksetzen")}
                    </MenuItem>
                  )}
                  {u.id !== me?.id && (
                    <MenuItem onSelect={() => act(() => api.patch(`/api/admin/users/${u.id}`, { role: u.role === "admin" ? "member" : "admin" }), tr("Role changed", "Rolle geändert"))}>
                      {u.role === "admin" ? tr("Remove admin rights", "Adminrechte entziehen") : tr("Make admin", "Zur Admin-Person machen")}
                    </MenuItem>
                  )}
                  {u.totpEnabled && u.id !== me?.id && (
                    <MenuItem
                      onSelect={() =>
                        window.confirm(tr(`Reset 2FA for ${u.name}? They will be signed out everywhere and will need to set up 2FA again and reconnect their mailbox.`, `2FA für ${u.name} zurücksetzen? Die Person wird überall abgemeldet, muss 2FA neu einrichten und ihr Postfach neu verbinden.`)) &&
                        act(() => api.post(`/api/admin/users/${u.id}/reset-2fa`), tr("2FA reset", "2FA zurückgesetzt"))
                      }
                    >
                      {tr("Reset 2FA", "2FA zurücksetzen")}
                    </MenuItem>
                  )}
                  {u.status !== "disabled" && <MenuItem onSelect={() => setPhotoFor(u.id)}>{u.avatarUrl ? tr("Change profile photo", "Profilfoto ändern") : tr("Upload profile photo", "Profilfoto hochladen")}</MenuItem>}
                  {u.locked && <MenuItem onSelect={() => act(() => api.post(`/api/admin/users/${u.id}/unlock`), tr("Unlocked", "Entsperrt"))}>{tr("Unlock", "Sperre aufheben")}</MenuItem>}
                  {u.id !== me?.id && u.status !== "invited" && (
                    <MenuItem
                      danger={u.status === "active"}
                      onSelect={() =>
                        (u.status !== "active" || window.confirm(tr(`Disable ${u.name}? All sessions will be ended and the mailbox will be disconnected.`, `${u.name} deaktivieren? Alle Sitzungen werden beendet und das Postfach wird getrennt.`))) &&
                        act(() => api.patch(`/api/admin/users/${u.id}`, { status: u.status === "active" ? "disabled" : "active" }), u.status === "active" ? tr("Disabled", "Deaktiviert") : tr("Reactivated", "Reaktiviert"))
                      }
                    >
                      {u.status === "active" ? tr("Disable", "Deaktivieren") : tr("Reactivate", "Wieder aktivieren")}
                    </MenuItem>
                  )}
                  {u.status === "invited" && (
                    <MenuItem danger onSelect={() => act(() => api.del(`/api/admin/users/${u.id}`), tr("Invite deleted", "Einladung gelöscht"))}>
                      {tr("Delete invite", "Einladung löschen")}
                    </MenuItem>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        ))}
      </div>
      {(() => {
        const pu = data.users.find((x) => x.id === photoFor);
        return (
          <Sheet open={!!pu} onOpenChange={(v) => !v && setPhotoFor(null)} title={pu ? `${tr("Profile photo", "Profilfoto")}: ${pu.name}` : tr("Profile photo", "Profilfoto")} variant="dialog">
            {pu && (
              <div className="space-y-3">
                <AvatarEditor name={pu.name} color={pu.avatarColor} src={pu.avatarUrl} endpoint={`/api/admin/users/${pu.id}/avatar`} size={80} />
                <p className="text-[12.5px] text-muted">{tr("Everyone can also change their own photo under Settings → Profile.", "Jede Person kann ihr Foto auch selbst unter Einstellungen → Profil ändern.")}</p>
              </div>
            )}
          </Sheet>
        );
      })()}
      <InviteSheet open={invite} onOpenChange={setInvite} smtp={data.smtp} domains={data.allowedDomains} onDone={refresh} />
    </div>
  );
}

function MenuItem({ children, onSelect, danger }: { children: React.ReactNode; onSelect: () => unknown; danger?: boolean }) {
  return (
    <DropdownMenu.Item
      onSelect={() => void onSelect()}
      className={cx("cursor-pointer rounded-lg px-2.5 py-2 text-sm outline-none", danger ? "text-neg data-[highlighted]:bg-neg-soft" : "data-[highlighted]:bg-surface2")}
    >
      {children}
    </DropdownMenu.Item>
  );
}

function InviteSheet({ open, onOpenChange, smtp, domains, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; smtp: boolean; domains: string[]; onDone: () => void }) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [f, setF] = useState({ name: "", email: "", title: "", role: "member" as "member" | "admin" });
  const [bulk, setBulk] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ name: string; email: string; url?: string; ok: boolean; message: string }[]>([]);
  const guarded = useGuarded();

  async function submit() {
    setBusy(true);
    setErr({});
    try {
      if (mode === "single") {
        const r = await guarded(() => api.post<{ user: AdminUser; inviteUrl: string; emailed: boolean }>("/api/admin/users", { ...f, sendEmail }));
        setResults([{ name: r.user.name, email: r.user.email, url: r.inviteUrl, ok: true, message: r.emailed ? tr("E-mail sent", "E-Mail versendet") : tr("Link ready", "Link bereit") }, ...results]);
        setF({ name: "", email: "", title: "", role: "member" });
      } else {
        const r = await api.post<{ results: { line: string; ok: boolean; message: string; inviteUrl?: string; email?: string }[] }>("/api/admin/users/bulk", { text: bulk, sendEmail });
        setResults(r.results.map((x) => ({ name: x.line, email: x.email ?? "", url: x.inviteUrl, ok: x.ok, message: x.message })));
        setBulk("");
      }
      onDone();
    } catch (e) {
      if (e instanceof ReauthCancelled) return;
      setErr(e instanceof ApiError ? { ...e.fields, _: e.message } : { _: tr("Failed", "Fehlgeschlagen") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResults([]); }} title={tr("Invite people", "Personen einladen")}>
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "single", label: tr("One person", "Eine Person") },
            { value: "bulk", label: tr("Several", "Mehrere") },
          ]}
        />
        {mode === "single" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" error={err.name} htmlFor="i-name">
              <input id="i-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            </Field>
            <Field label={tr("E-mail", "E-Mail")} error={err.email} htmlFor="i-email" hint={domains.length ? `${tr("Allowed", "Erlaubt")}: ${domains.join(", ")}` : undefined}>
              <input id="i-email" type="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label={tr("Role / title", "Rolle / Titel")} htmlFor="i-title">
              <input id="i-title" className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={tr("e.g. Account Manager", "z. B. Account Manager")} />
            </Field>
            <Field label={tr("Permissions", "Rechte")} htmlFor="i-role">
              <Select id="i-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "member" | "admin" })}>
                <option value="member">{tr("Member", "Mitglied")}</option>
                <option value="admin">{tr("Admin (admin area, pinning)", "Admin (Verwaltung, anheften)")}</option>
              </Select>
            </Field>
          </div>
        ) : (
          <Field label={tr("One person per line", "Eine Person pro Zeile")} hint={tr("Format: Name; e-mail; title – e.g. “Mira Hansen; mira@nalpia.com; Founding Engineer”", "Format: Name; E-Mail; Titel – z. B. „Alex Mense; am@sintro.eu; Account Manager“")}>
            <textarea className="field num min-h-[160px] text-[13.5px]" value={bulk} onChange={(e) => setBulk(e.target.value)} />
          </Field>
        )}
        {smtp ? (
          <Switch checked={sendEmail} onChange={setSendEmail} label={tr("Send invite by e-mail", "Einladung per E-Mail senden")} description={tr("Otherwise you get the link to copy.", "Sonst bekommst du den Link zum Kopieren.")} />
        ) : (
          <p className="flex items-start gap-2 rounded-xl bg-surface2 px-3 py-2 text-[13px] text-muted">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {tr("No SMTP configured – you get the invite links to pass on.", "Kein SMTP eingerichtet – du bekommst die Einladungslinks zum Weitergeben.")}
          </p>
        )}
        {err._ && <p className="text-sm font-medium text-neg">{err._}</p>}
        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} loading={busy} disabled={mode === "single" ? !f.email || !f.name : !bulk.trim()}>
            {tr("Invite", "Einladen")}
          </Button>
        </div>
        {results.length > 0 && (
          <div className="space-y-2 border-t border-line pt-4">
            {results.map((r, i) => (
              <div key={i} className="space-y-1.5">
                <p className={cx("text-[13px] font-semibold", r.ok ? "text-ink" : "text-neg")}>
                  {r.name} {r.email && r.name !== r.email && <span className="font-normal text-muted">{r.email}</span>} – {r.message}
                </p>
                {r.url && <CopyLink url={r.url} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** [English, German] */
const ACTION_LABEL: Record<string, [string, string]> = {
  "login.success": ["Sign-in", "Anmeldung"],
  "login.failed": ["Sign-in failed", "Anmeldung fehlgeschlagen"],
  "login.locked": ["Sign-in locked", "Anmeldung gesperrt"],
  "login.totp_failed": ["Wrong 2FA code", "2FA-Code falsch"],
  "login.recovery_code_used": ["Recovery code used", "Wiederherstellungscode genutzt"],
  logout: ["Sign-out", "Abmeldung"],
  "password.changed": ["Password changed", "Passwort geändert"],
  "password.reset": ["Password reset", "Passwort zurückgesetzt"],
  "password.reset_requested": ["Reset requested", "Zurücksetzen angefordert"],
  "invite.accepted": ["Invite accepted", "Einladung angenommen"],
  "2fa.enabled": ["2FA enabled", "2FA aktiviert"],
  "2fa.disabled": ["2FA disabled", "2FA deaktiviert"],
  "session.revoked": ["Device signed out", "Gerät abgemeldet"],
  "session.revoked_others": ["Other devices signed out", "Andere Geräte abgemeldet"],
  "user.invited": ["Person invited", "Person eingeladen"],
  "user.updated": ["Person updated", "Person geändert"],
  "user.invite_renewed": ["Invite renewed", "Einladung erneuert"],
  "user.reset_link": ["Reset link created", "Reset-Link erzeugt"],
  "user.2fa_reset": ["2FA reset", "2FA zurückgesetzt"],
  "user.unlocked": ["Unlocked", "Sperre aufgehoben"],
  "user.avatar_set": ["Profile photo set", "Profilfoto gesetzt"],
  "user.avatar_removed": ["Profile photo removed", "Profilfoto entfernt"],
  "org.deleted": ["Organization deleted", "Organisation gelöscht"],
  "org.exported": ["List exported", "Liste exportiert"],
  "org.imported": ["List imported", "Liste importiert"],
  "settings.investor_round": ["Funding round changed", "Finanzierungsrunde geändert"],
  "crm.import": ["CRM data imported", "CRM-Daten importiert"],
  "user.invite_deleted": ["Invite deleted", "Einladung gelöscht"],
  "mail.connected": ["Mailbox connected", "Postfach verbunden"],
  "mail.disconnected": ["Mailbox disconnected", "Postfach getrennt"],
  "mail.connect_mismatch": ["Someone else's mailbox rejected", "Fremdes Postfach abgelehnt"],
  "mail.sent": ["E-mail sent", "E-Mail gesendet"],
  "mail.replied": ["E-mail replied to", "E-Mail beantwortet"],
  "mail.draft_saved": ["Draft saved", "Entwurf gespeichert"],
  "settings.require_2fa": ["2FA requirement changed", "2FA-Pflicht geändert"],
  "reauth.success": ["Action confirmed", "Aktion bestätigt"],
  "reauth.failed": ["Confirmation failed", "Bestätigung fehlgeschlagen"],
  "reauth.totp_failed": ["Confirmation: wrong code", "Bestätigung: Code falsch"],
  "mail.attachment": ["Attachment downloaded", "Anhang geladen"],
  "ai.draft": ["AI draft created", "KI-Entwurf erstellt"],
  "ai.summarize": ["AI summary", "KI-Zusammenfassung"],
  "task.deleted": ["Task deleted", "Aufgabe gelöscht"],
  "news.deleted": ["Post deleted", "Beitrag gelöscht"],
  "contact.deleted": ["Contact deleted", "Kontakt gelöscht"],
  "milestone.deleted": ["Milestone deleted", "Meilenstein gelöscht"],
  "cli.reset_link": ["Reset link (command line)", "Reset-Link (Kommandozeile)"],
  "cli.admin_promoted": ["Made admin (command line)", "Admin (Kommandozeile)"],
};
const actionLabel = (k: string): string | undefined => (ACTION_LABEL[k] ? tr(...ACTION_LABEL[k]) : undefined);

/** [English, German] */
const REASON: Record<string, [string, string]> = {
  user: ["self", "selbst"],
  password_reset: ["due to password reset", "wegen Passwort-Reset"],
  "2fa_reset": ["due to 2FA reset", "wegen 2FA-Reset"],
  disabled: ["account disabled", "Konto deaktiviert"],
};
const reasonLabel = (k: string): string | undefined => (REASON[k] ? tr(...REASON[k]) : undefined);

function AuditLog() {
  const { data: users } = useQuery({ queryKey: ["admin-users"], queryFn: () => api.get<{ users: AdminUser[] }>("/api/admin/users") });
  const names = new Map((users?.users ?? []).map((u) => [u.id, u.name]));
  const [action, setAction] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["audit", action],
    queryFn: ({ pageParam }) => api.get<{ id: number; ts: number; userId: string | null; action: string; target: string; ip: string; meta: Record<string, unknown> }[]>(`/api/admin/audit${qs({ action, before: pageParam, limit: 60 })}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.length === 60 ? last[last.length - 1]!.id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];
  return (
    <div className="space-y-3">
      <Select className="w-[260px]" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter">
        <option value="">{tr("All events", "Alle Ereignisse")}</option>
        <option value="login">{tr("Sign-ins", "Anmeldungen")}</option>
        <option value="password">{tr("Passwords", "Passwörter")}</option>
        <option value="2fa">{tr("Two-factor", "Zwei-Faktor")}</option>
        <option value="user">{tr("People management", "Personenverwaltung")}</option>
        <option value="mail">{tr("Mailbox", "Postfach")}</option>
        <option value="settings">{tr("Settings", "Einstellungen")}</option>
        <option value="reauth">{tr("Confirmations", "Bestätigungen")}</option>
        <option value="ai">{tr("AI usage", "KI-Nutzung")}</option>
      </Select>
      {q.isLoading ? (
        <Skeleton className="h-72" />
      ) : !rows.length ? (
        <EmptyState title={tr("No entries", "Keine Einträge")} />
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13.5px]">
              <span className="num w-[132px] shrink-0 text-[12px] text-muted">{new Date(r.ts).toLocaleString(locale(), { dateStyle: "short", timeStyle: "medium" })}</span>
              <span className={cx("font-semibold", /failed|locked|mismatch/.test(r.action) && "text-neg")}>{actionLabel(r.action) ?? r.action}</span>
              <span className="text-muted">{r.userId ? names.get(r.userId) ?? tr("unknown", "unbekannt") : typeof r.meta.email === "string" ? r.meta.email : "System"}</span>
              {r.target && names.get(r.target) && <span className="text-muted">→ {names.get(r.target)}</span>}
              {typeof r.meta.reason === "string" && reasonLabel(r.meta.reason) && <span className="text-muted">({reasonLabel(r.meta.reason)})</span>}
              {r.ip && <span className="num ml-auto text-[12px] text-muted">{r.ip}</span>}
            </div>
          ))}
        </div>
      )}
      {q.hasNextPage && (
        <Button variant="secondary" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
          {tr("Load older", "Ältere laden")}
        </Button>
      )}
    </div>
  );
}

function OrgSettings() {
  const qc = useQueryClient();
  const me = useMe().data;
  const { data } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.get<{ require2fa: boolean }>("/api/admin/settings") });
  const guarded = useGuarded();
  async function set2fa(v: boolean) {
    try {
      await guarded(() => api.patch("/api/admin/settings", { require2fa: v }));
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(v ? tr("2FA is now required", "2FA ist jetzt Pflicht") : tr("2FA is now optional", "2FA ist freiwillig"));
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error((e as Error).message);
    }
  }
  const row = (label: string, ok: boolean, hint: string) => (
    <div className="flex items-start gap-3 py-2.5">
      <span className={cx("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", ok ? "bg-pos" : "bg-line")} />
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-[12.5px] text-muted">{hint}</p>
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <Switch
          checked={!!data?.require2fa}
          onChange={set2fa}
          label={tr("Require two-factor authentication for everyone", "Zwei-Faktor-Anmeldung für alle verpflichtend")}
          description={tr("Anyone who hasn't set it up yet is taken straight to setup after signing in. Recommended for a regulated company.", "Wer sie noch nicht eingerichtet hat, wird nach der Anmeldung direkt zur Einrichtung geführt. Empfohlen für ein reguliertes Unternehmen.")}
          disabled={!me?.user?.totpEnabled && !data?.require2fa}
        />
        {!me?.user?.totpEnabled && <p className="mt-2 text-[12.5px] text-muted">{tr("Set up two-factor authentication for yourself first (Settings → Security).", "Richte zuerst selbst die Zwei-Faktor-Anmeldung ein (Einstellungen → Sicherheit).")}</p>}
      </section>
      <section className="card divide-y divide-line px-5 py-2">
        {row(tr("Mailbox connection", "Postfach-Anbindung"), !!me?.features.mail, me?.features.demo ? tr("Demo mode active", "Demo-Modus aktiv") : tr("IMAP/SMTP (Spacemail: mail.spacemail.com) – each person connects with their own mailbox password", "IMAP/SMTP (Spacemail: mail.spacemail.com) – jede Person verbindet sich mit ihrem eigenen Postfach-Passwort"))}
        {row(tr("AI drafts (Claude)", "KI-Entwürfe (Claude)"), !!me?.features.ai, tr("ANTHROPIC_API_KEY in the server configuration", "ANTHROPIC_API_KEY in der Server-Konfiguration"))}
        {row(tr("System e-mails (SMTP)", "System-E-Mails (SMTP)"), !!me?.features.smtp, tr("For invites and “Forgot password”. Without SMTP, links are passed on manually.", "Für Einladungen und „Passwort vergessen“. Ohne SMTP werden Links manuell weitergegeben."))}
      </section>
    </div>
  );
}

/* ---------- CRM import ---------- */

interface ImportCounts {
  created: number;
  linked: number;
  updated: number;
  unchanged: number;
}
interface ImportResult {
  dryRun: boolean;
  owner: { id: string; name: string } | null;
  orgs: ImportCounts;
  contacts: ImportCounts;
  activities: { created: number; skipped: number };
  tasks: { created: number; skipped: number; updated?: number };
  round: string;
  warnings: string[];
}
interface BundleInfo {
  name: string;
  size: number;
  blob: Blob;
  investors: number;
  clients: number;
  contacts: number;
  activities: number;
  source: string;
}

type Bundle = { format?: string; source?: string; orgs?: { kind: string }[]; contacts?: unknown[]; activities?: unknown[] };

/**
 * Finds the CRM bundle even if the file got wrapped during download
 * (as quoted JSON text, inside an object like { data: … } or in a list).
 */
function unwrapBundle(raw: unknown): Bundle {
  let v = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof v === "string") {
      v = JSON.parse(v.replace(/^\uFEFF/, ""));
      continue;
    }
    if (Array.isArray(v) && v.length === 1) {
      v = v[0];
      continue;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.format === "nalpia-crm-bundle" || o.format === "sintro-crm-bundle") return o as Bundle;
      const inner = Object.values(o).find((x) => (x && typeof x === "object" && ["nalpia-crm-bundle", "sintro-crm-bundle"].includes(String((x as Record<string, unknown>).format))) || typeof x === "string");
      if (inner !== undefined && Object.keys(o).length <= 3) {
        v = inner;
        continue;
      }
    }
    break;
  }
  const found =
    v && typeof v === "object" && !Array.isArray(v)
      ? `${tr("Found", "Gefunden")}: ${Object.keys(v as object).slice(0, 6).join(", ") || tr("empty object", "leeres Objekt")}`
      : `${tr("Found", "Gefunden")}: ${Array.isArray(v) ? tr(`list with ${v.length} ${v.length === 1 ? "entry" : "entries"}`, `Liste mit ${v.length} ${v.length === 1 ? "Eintrag" : "Einträgen"}`) : typeof v}`;
  throw new Error(tr(`This is not a CRM bundle (${found}). Expected a file like investors-bundle.json (format nalpia-crm-bundle).`, `Das ist kein CRM-Paket (${found}). Erwartet wird eine Datei wie investors-bundle.json (Format nalpia-crm-bundle).`));
}

function CrmImport() {
  const qc = useQueryClient();
  const me = useMe().data;
  const needs2fa = !!me && !me.user?.totpEnabled && !me.features.demo;
  const guarded = useGuarded();
  const [file, setFile] = useState<BundleInfo | null>(null);
  const [update, setUpdate] = useState(false);
  const [withTasks, setWithTasks] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean, info = file, upd = update, tsk = withTasks) {
    if (!info) return;
    setBusy(true);
    try {
      const url = `/api/admin/import-crm${qs({ probe: dryRun ? 1 : undefined, aktualisieren: upd ? 1 : undefined, aufgaben: tsk ? 1 : undefined })}`;
      // For the real import, check permission and confirmation first, then upload the bundle
      if (!dryRun) await guarded(() => api.post("/api/admin/import-crm/bereit"));
      const r = dryRun ? await api.post<ImportResult>(url, info.blob) : await guarded(() => api.post<ImportResult>(url, info.blob));
      if (dryRun) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
        setFile(null);
        for (const k of ["orgs", "org", "contacts", "contact", "org-round", "home", "search", "tasks", "task", "milestones"]) qc.invalidateQueries({ queryKey: [k] });
        toast.success(tr("CRM data imported", "CRM-Daten importiert"));
      }
    } catch (e) {
      if (!(e instanceof ReauthCancelled)) toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    setDone(null);
    setPreview(null);
    try {
      const j = unwrapBundle(JSON.parse((await f.text()).replace(/^\uFEFF/, "")));
      const info: BundleInfo = {
        name: f.name,
        size: f.size,
        blob: new Blob([JSON.stringify(j)], { type: "application/json" }),
        investors: j.orgs?.filter((o) => o.kind === "investor").length ?? 0,
        clients: j.orgs?.filter((o) => o.kind === "partner").length ?? 0,
        contacts: j.contacts?.length ?? 0,
        activities: j.activities?.length ?? 0,
        source: j.source ?? "",
      };
      setFile(info);
      await send(true, info, update, withTasks);
    } catch (e) {
      toast.error(e instanceof SyntaxError ? tr("The file is not valid JSON.", "Die Datei ist kein gültiges JSON.") : (e as Error).message);
    }
  }

  const n = (x: number) => x.toLocaleString(locale());
  const counts = (label: string, c: ImportCounts) => (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <span className="font-semibold">{label}</span>
      <span className="text-[13px] text-muted">
        <b className="text-ink">{n(c.created)}</b> {tr("new", "neu")}
        {c.linked > 0 && <>, <b className="text-ink">{n(c.linked)}</b> {tr("linked to existing", "mit Bestehendem verknüpft")}</>}
        {c.updated > 0 && <>, <b className="text-ink">{n(c.updated)}</b> {tr("updated", "aktualisiert")}</>}
        {c.unchanged > 0 && <>, {n(c.unchanged)} {tr("already present", "schon vorhanden")}</>}
      </span>
    </li>
  );
  const summary = (r: ImportResult) => (
    <ul className="divide-y divide-line text-sm">
      {counts(tr("Organizations", "Organisationen"), r.orgs)}
      {counts(tr("Contacts", "Kontakte"), r.contacts)}
      <li className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
        <span className="font-semibold">{tr("Activity", "Verlauf")}</span>
        <span className="text-[13px] text-muted">
          <b className="text-ink">{n(r.activities.created)}</b> {r.activities.created === 1 ? tr("entry", "Eintrag") : tr("entries", "Einträge")}{r.activities.skipped > 0 && <>, {n(r.activities.skipped)} {tr("already present", "schon vorhanden")}</>}
        </span>
      </li>
      <li className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
        <span className="font-semibold">{tr("Tasks", "Aufgaben")}</span>
        <span className="text-[13px] text-muted">
          <b className="text-ink">{n(r.tasks?.created ?? 0)}</b> {tr("new", "neu")}{(r.tasks?.updated ?? 0) > 0 && <>, {n(r.tasks.updated ?? 0)} {tr("updated", "aktualisiert")}</>}{(r.tasks?.skipped ?? 0) > 0 && <>, {n(r.tasks.skipped)} {tr("already present", "schon vorhanden")}</>}
        </span>
      </li>
      <li className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
        <span className="font-semibold">{tr("Owner", "Zuständig")}</span>
        <span className="text-[13px] text-muted">{r.owner?.name ?? tr("nobody", "niemand")}</span>
      </li>
    </ul>
  );

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-[15px] font-bold">{tr("Import investors (CRM bundle)", "Investoren importieren (CRM-Paket)")}</h2>
        <p className="mt-1 max-w-[62ch] text-[13.5px] text-muted">
          {tr(
            "Loads investors and partners with their contacts, profile (focus, stage, ticket, history with SINTRO) and notes from a CRM bundle – e.g. data/seed/investors-bundle.json with all investors taken over from the SINTRO CRM. You see what will happen first. Importing again never creates duplicates; manually created organizations and contacts with the same name or e-mail are linked. The fit for nalpia is calculated on import.",
            "Lädt Investoren und Partner samt Ansprechpartnern, Profil (Fokus, Phase, Ticket, Vorgeschichte mit SINTRO) und Notizen aus einem CRM-Paket – z. B. data/seed/investors-bundle.json mit allen aus dem SINTRO-CRM übernommenen Investoren. Du siehst zuerst, was passiert. Mehrfaches Importieren legt nichts doppelt an; von Hand angelegte Organisationen und Kontakte mit gleichem Namen bzw. gleicher E-Mail werden verknüpft. Der Fit für nalpia wird beim Import berechnet.",
          )}
        </p>
        {needs2fa && (
          <p className="mt-3 rounded-lg bg-accent-soft p-3 text-[13px] text-accent-ink">
            {tr("You need active two-factor authentication to import.", "Für den Import brauchst du eine aktive Zwei-Faktor-Anmeldung.")}{" "}
            <Link className="font-semibold underline" to="/einstellungen?tab=sicherheit">
              {tr("Set it up now", "Jetzt einrichten")}
            </Link>{" "}
            {tr("– the preview works without it.", "– die Vorschau funktioniert auch ohne.")}
          </p>
        )}
        <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 hover:border-muted/50 focus-within:ring-2 focus-within:ring-brand/40">
          <FileJson className="h-6 w-6 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{file ? file.name : tr("Choose CRM bundle", "CRM-Paket auswählen")}</span>
            <span className="block text-[12.5px] text-muted">
              {file
                ? tr(
                    `${n(file.investors)} ${file.investors === 1 ? "investor" : "investors"}, ${n(file.clients)} ${file.clients === 1 ? "partner" : "partners"}, ${n(file.contacts)} ${file.contacts === 1 ? "person" : "people"}, ${n(file.activities)} activity ${file.activities === 1 ? "entry" : "entries"}`,
                    `${n(file.investors)} ${file.investors === 1 ? "Investor" : "Investoren"}, ${n(file.clients)} Partner, ${n(file.contacts)} ${file.contacts === 1 ? "Person" : "Personen"}, ${n(file.activities)} ${file.activities === 1 ? "Verlaufseintrag" : "Verlaufseinträge"}`,
                  ) + ` · ${(file.size / 1024 / 1024).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
                : tr("JSON file, up to 40 MB", "JSON-Datei, bis 40 MB")}
            </span>
          </span>
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {preview && (
          <div className="mt-4 space-y-3">
            <p className="text-[13px] font-semibold text-muted">{tr("Preview – nothing saved yet", "Vorschau – noch nichts gespeichert")}</p>
            {summary(preview)}
            {preview.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-surface2 p-3 text-[12.5px]">
                {preview.warnings.slice(0, 8).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {preview.warnings.length > 8 && <li className="text-muted">{tr(`and ${preview.warnings.length - 8} more ${preview.warnings.length - 8 === 1 ? "notice" : "notices"}`, `und ${preview.warnings.length - 8} ${preview.warnings.length - 8 === 1 ? "weiterer Hinweis" : "weitere Hinweise"}`)}</li>}
              </ul>
            )}
            <Switch
              checked={withTasks}
              onChange={(v) => {
                setWithTasks(v);
                void send(true, file, update, v);
              }}
              label={tr("Create tasks from the CRM", "Aufgaben aus dem CRM anlegen")}
              description={tr("For pending replies and dated next steps (excluding “waiting for reply”), one task per organization is created for the owner.", "Für offene Antworten und datierte nächste Schritte (ohne „auf Antwort warten“) entsteht je Institution eine Aufgabe für die zuständige Person.")}
            />
            <Switch
              checked={update}
              onChange={(v) => {
                setUpdate(v);
                void send(true, file, v, withTasks);
              }}
              label={tr("Overwrite previously imported records", "Bereits importierte Datensätze überschreiben")}
              description={tr("Only turn this on if the CRM is the source of truth. Changes you made in the intranet to imported records will be lost.", "Nur einschalten, wenn das CRM die führende Quelle ist. Änderungen, die ihr im Intranet an importierten Datensätzen gemacht habt, gehen dabei verloren.")}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                }}
              >
                {tr("Cancel", "Abbrechen")}
              </Button>
              <Button variant="primary" loading={busy} onClick={() => send(false)} disabled={!preview.orgs.created && !preview.contacts.created && !preview.activities.created && !preview.orgs.updated && !preview.contacts.updated && !preview.orgs.linked && !preview.contacts.linked && !preview.tasks?.created && !preview.tasks?.updated}>
                {tr("Import", "Importieren")}
              </Button>
            </div>
          </div>
        )}
        {done && (
          <div className="mt-4 space-y-3">
            <p className="text-[13px] font-semibold text-pos">{tr("Import complete", "Import abgeschlossen")}</p>
            {summary(done)}
            <div className="flex flex-wrap gap-3 text-sm">
              <Link className="link" to="/investoren">
                {tr("Open investors", "Investoren öffnen")}
              </Link>
              <Link className="link" to="/partner">
                {tr("Open partners", "Partner öffnen")}
              </Link>
              <Link className="link" to="/kontakte?kategorie=stakeholder">
                {tr("Open stakeholders", "Stakeholder öffnen")}
              </Link>
            </div>
          </div>
        )}
      </section>
      <p className="text-[12.5px] text-muted">
        {tr("Alternatively, on the server:", "Alternativ auf dem Server:")} <code className="rounded bg-surface2 px-1.5 py-0.5">node dist/server/cli.js import-crm --file data/seed/investors-bundle.json</code>
      </p>
    </div>
  );
}

/* ---------- nalpia team ---------- */

interface TeamResult {
  dryRun: boolean;
  created: string[];
  updated: string[];
  unchanged: string[];
  unconfirmedEmails: { name: string; email: string }[];
  externals: string;
}

function TeamTemplate() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<TeamResult | null>(null);
  const [done, setDone] = useState<TeamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [structure, setStructure] = useState(false);
  async function run(dryRun: boolean, struct = structure) {
    setBusy(true);
    try {
      const r = await api.post<TeamResult>(`/api/team/template${qs({ probe: dryRun ? 1 : undefined, struktur: struct ? 1 : undefined })}`);
      if (dryRun) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
        qc.invalidateQueries({ queryKey: ["users"] });
        qc.invalidateQueries({ queryKey: ["admin-users"] });
        qc.invalidateQueries({ queryKey: ["team-externals"] });
        toast.success(tr("Team imported", "Team übernommen"));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const r = done ?? preview;
  const list = (label: string, names: string[]) =>
    names.length > 0 && (
      <li className="py-2">
        <span className="font-semibold">{label}:</span> <span className="text-muted">{names.join(", ")}</span>
      </li>
    );
  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-bold">{tr("Create nalpia team", "nalpia-Team anlegen")}</h2>
      <p className="mt-1 max-w-[62ch] text-[13.5px] text-muted">
        {tr(
          "Creates the core team with role, area and manager for the org chart – as invited accounts, without sending any links. People who already exist keep their details; only empty fields are filled in. You can then create invite links under “People”.",
          "Legt das Kernteam mit Rolle, Bereich und Vorgesetzten fürs Organigramm an – als eingeladene Konten, ohne dass Links verschickt werden. Bereits vorhandene Personen behalten ihre Angaben; nur leere Felder werden ergänzt. Einladungslinks erzeugst du danach unter „Personen“.",
        )}
      </p>
      {r && (
        <ul className="mt-3 divide-y divide-line text-[13.5px]">
          {list(r.dryRun ? tr("Will be created", "Wird angelegt") : tr("Created", "Angelegt"), r.created)}
          {list(r.dryRun ? tr("Will be completed", "Wird ergänzt") : tr("Completed", "Ergänzt"), r.updated)}
          {list(tr("Already complete", "Schon vollständig"), r.unchanged)}
          {r.externals === "gesetzt" && <li className="py-2 text-muted">{tr("Advisory board and external partners will be added.", "Beirat und externe Partner werden eingetragen.")}</li>}
        </ul>
      )}
      {preview && (
        <div className="mt-3">
          <Switch
            checked={structure}
            onChange={(v) => {
              setStructure(v);
              void run(true, v);
            }}
            label={tr("Apply roles and reporting lines from the template", "Rollen und Berichtslinien aus der Vorlage übernehmen")}
            description={tr("Resets the core team's titles, areas, order and managers to the template – even if they were already changed. Bios, contact details and photos are kept.", "Setzt Titel, Bereich, Reihenfolge und Vorgesetzte des Kernteams auf die Vorlage zurück – auch wenn sie schon geändert wurden. Kurzprofile, Kontaktdaten und Fotos bleiben.")}
          />
        </div>
      )}
      {r && r.unconfirmedEmails.length > 0 && (
        <p className="mt-2 rounded-lg bg-accent-soft p-3 text-[13px] text-accent-ink">
          {tr(
            `${r.unconfirmedEmails.map((x) => `${x.name} (${x.email})`).join(" and ")} ${r.unconfirmedEmails.length === 1 ? "has" : "have"} no mailbox yet. Adjust the address in the org chart before inviting (pencil on the card).`,
            `Für ${r.unconfirmedEmails.map((x) => `${x.name} (${x.email})`).join(" und ")} gibt es noch kein Postfach. Passe die Adresse vor der Einladung im Organigramm an (Stift auf der Karte).`,
          )}
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {done ? (
          <Link className="link text-sm" to="/team">
            {tr("Open org chart", "Organigramm öffnen")}
          </Link>
        ) : !preview ? (
          <Button variant="secondary" onClick={() => run(true)} loading={busy}>
            {tr("Preview", "Vorschau")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {tr("Cancel", "Abbrechen")}
            </Button>
            <Button variant="primary" onClick={() => run(false)} loading={busy} disabled={!preview.created.length && !preview.updated.length && preview.externals !== "gesetzt"}>
              {tr("Create team", "Team anlegen")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

type NewsTemplateResult = { dryRun: boolean; created: string[]; existing: string[]; author: string };

function NewsTemplate() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<NewsTemplateResult | null>(null);
  const [done, setDone] = useState<NewsTemplateResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.post<NewsTemplateResult>(`/api/news/template${qs({ probe: dryRun ? 1 : undefined })}`);
      if (dryRun) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
        qc.invalidateQueries({ queryKey: ["news"] });
        toast.success(tr(`${r.created.length} ${r.created.length === 1 ? "post" : "posts"} created`, `${r.created.length} ${r.created.length === 1 ? "Beitrag" : "Beiträge"} angelegt`));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const r = done ?? preview;
  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-bold">{tr("Create nalpia news", "nalpia-Neuigkeiten anlegen")}</h2>
      <p className="mt-1 max-w-[62ch] text-[13.5px] text-muted">
        {tr(
          "Fills News with starter posts: welcome, positioning, pre-seed round, partners and team. No notifications are sent, nothing is duplicated, and edited or deleted posts stay as they are.",
          "Füllt die News mit Startbeiträgen: Willkommen, Positionierung, Pre-Seed-Runde, Partner und Team. Es gehen keine Benachrichtigungen raus, nichts wird doppelt angelegt, und bearbeitete oder gelöschte Beiträge bleiben, wie sie sind.",
        )}
      </p>
      {r && (
        <div className="mt-3 text-[13.5px]">
          <p className="font-semibold">
            {r.dryRun
              ? tr(`${r.created.length} ${r.created.length === 1 ? "post" : "posts"} will be created`, `${r.created.length} ${r.created.length === 1 ? "Beitrag wird" : "Beiträge werden"} angelegt`)
              : tr(`${r.created.length} ${r.created.length === 1 ? "post" : "posts"} created`, `${r.created.length} ${r.created.length === 1 ? "Beitrag" : "Beiträge"} angelegt`)}
            {r.created.length > 0 && <span className="font-normal text-muted"> – {tr("author", "Autor")}: {r.author}</span>}
            {r.existing.length > 0 && <span className="font-normal text-muted">, {r.existing.length} {tr("already present", "schon vorhanden")}</span>}
          </p>
          {r.created.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
              {r.created.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {done ? (
          <Link className="link text-sm" to="/news">
            {tr("Open News", "News öffnen")}
          </Link>
        ) : !preview ? (
          <Button variant="secondary" onClick={() => run(true)} loading={busy}>
            {tr("Preview", "Vorschau")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {tr("Cancel", "Abbrechen")}
            </Button>
            <Button variant="primary" onClick={() => run(false)} loading={busy} disabled={!preview.created.length}>
              {tr("Create posts", "Beiträge anlegen")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
