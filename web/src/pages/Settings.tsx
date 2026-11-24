import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Laptop, LogOut, Moon, ShieldCheck, Smartphone, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AvatarEditor } from "@/components/AvatarEditor";
import { LangToggle } from "@/components/LangToggle";
import { MailConnectForm } from "@/components/MailConnect";
import { Select } from "@/components/pickers";
import { Button, cx, Field, Segmented, Skeleton, Switch } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { AVATAR, relTime } from "@/lib/format";
import { useMailStatus, useMe } from "@/lib/queries";
import { applyTheme, currentTheme, type Theme } from "@/lib/theme";
import type { Prefs, SelfUser } from "@/lib/types";
import { tr } from "@/lib/i18n";

type Tab = "profil" | "sicherheit" | "postfach" | "ki" | "darstellung";

export function SettingsPage({ forced2fa }: { forced2fa?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = forced2fa ? "sicherheit" : ((params.get("tab") as Tab) || "profil");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">{forced2fa ? tr("Set up two-factor authentication", "Zwei-Faktor-Anmeldung einrichten") : tr("Settings", "Einstellungen")}</h1>
        {forced2fa && <p className="text-[14px] text-muted">{tr("Your company requires two-factor authentication. Set it up now to continue.", "Für dein Unternehmen ist die Zwei-Faktor-Anmeldung Pflicht. Richte sie jetzt ein, um weiterzumachen.")}</p>}
      </header>
      {!forced2fa && (
        <Segmented<Tab>
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[
            { value: "profil", label: tr("Profile", "Profil") },
            { value: "sicherheit", label: tr("Security", "Sicherheit") },
            { value: "postfach", label: tr("Mailbox", "Postfach") },
            { value: "ki", label: tr("AI style", "KI-Stil") },
            { value: "darstellung", label: tr("Appearance", "Darstellung") },
          ]}
        />
      )}
      {tab === "profil" && <ProfileTab />}
      {tab === "sicherheit" && <SecurityTab forced={forced2fa} />}
      {tab === "postfach" && <MailTab />}
      {tab === "ki" && <AiTab />}
      {tab === "darstellung" && <AppearanceTab />}
    </div>
  );
}

function Card({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="section-title">{title}</h2>
      {text && <p className="mt-0.5 text-[13.5px] text-muted">{text}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProfileTab() {
  const qc = useQueryClient();
  const me = useMe().data?.user;
  const [f, setF] = useState<Pick<SelfUser, "name" | "title" | "phone" | "location" | "responsibilities" | "avatarColor" | "bio" | "linkedin"> | null>(null);
  const [resp, setResp] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (me && !f) setF({ name: me.name, title: me.title, phone: me.phone, location: me.location, responsibilities: me.responsibilities, avatarColor: me.avatarColor, bio: me.bio ?? "", linkedin: me.linkedin ?? "" });
  }, [me, f]);
  if (!f || !me) return <Skeleton className="h-80" />;
  const addResp = () => {
    const v = resp.trim();
    if (v && !f.responsibilities.includes(v) && f.responsibilities.length < 12) setF({ ...f, responsibilities: [...f.responsibilities, v] });
    setResp("");
  };
  async function save() {
    setBusy(true);
    try {
      await api.patch("/api/me", f);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(tr("Profile saved", "Profil gespeichert"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={tr("Profile", "Profil")} text={tr("This is how the team sees you in the directory and as an owner.", "So sieht dich das Team im Verzeichnis und bei Zuständigkeiten.")}>
      <div className="space-y-4">
        <AvatarEditor name={f.name} color={f.avatarColor} src={me.avatarUrl} endpoint="/api/me/avatar" />
        {!me.avatarUrl && (
          <div>
            <p className="label">{tr("Color without photo", "Farbe ohne Foto")}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("Initials color", "Farbe der Initialen")}>
              {Object.keys(AVATAR).map((c) => (
                <button key={c} role="radio" aria-checked={f.avatarColor === c} aria-label={c} onClick={() => setF({ ...f, avatarColor: c })} className={cx("h-8 w-8 rounded-full transition", AVATAR[c], f.avatarColor === c ? "ring-2 ring-info ring-offset-2 ring-offset-surface" : "opacity-80 hover:opacity-100")} />
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="p-name">
            <input id="p-name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={tr("Role / title", "Rolle / Titel")} htmlFor="p-title">
            <input id="p-title" className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={tr("e.g. Head of IT", "z. B. Head of IT")} />
          </Field>
          <Field label={tr("Phone", "Telefon")} htmlFor="p-phone">
            <input id="p-phone" type="tel" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label={tr("Location", "Standort")} htmlFor="p-loc">
            <input id="p-loc" className="field" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Frankfurt, Berlin, Zürich …" />
          </Field>
        </div>
        <Field label={tr("Responsibilities", "Zuständigkeiten")} hint={tr("Topics people should come to you for. Press Enter to add.", "Themen, für die man dich ansprechen soll. Enter zum Hinzufügen.")}>
          <div className="flex flex-wrap gap-1.5 rounded-[10px] border border-line bg-surface p-2">
            {f.responsibilities.map((r) => (
              <span key={r} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface2 pl-2.5 pr-1 text-[13px] font-semibold">
                {r}
                <button aria-label={tr(`Remove ${r}`, `${r} entfernen`)} onClick={() => setF({ ...f, responsibilities: f.responsibilities.filter((x) => x !== r) })} className="grid h-5 w-5 place-items-center rounded-full hover:bg-line">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-[14px] outline-none"
              value={resp}
              onChange={(e) => setResp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addResp();
                }
              }}
              onBlur={addResp}
              placeholder={tr("e.g. Compliance", "z. B. Compliance")}
              aria-label={tr("Add responsibility", "Zuständigkeit hinzufügen")}
            />
          </div>
        </Field>
        <Field label={tr("Bio", "Kurzprofil")} htmlFor="p-bio" hint={tr("Background and focus areas in two or three sentences – shown in the org chart.", "Werdegang und Schwerpunkte in zwei, drei Sätzen – erscheint im Organigramm.")}>
          <textarea id="p-bio" className="field min-h-[96px]" maxLength={1500} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
        </Field>
        <Field label="LinkedIn" htmlFor="p-li">
          <input id="p-li" className="field" value={f.linkedin} onChange={(e) => setF({ ...f, linkedin: e.target.value })} placeholder="linkedin.com/in/…" />
        </Field>
        <p className="text-[13px] text-muted">{tr("E-mail address", "E-Mail-Adresse")}: {me.email} ({tr("changed by an admin", "ändert eine Admin-Person")})</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={save} loading={busy}>
            {tr("Save profile", "Profil speichern")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SecurityTab({ forced }: { forced?: boolean }) {
  const qc = useQueryClient();
  const me = useMe().data;
  const user = me?.user;
  return (
    <div className="space-y-4">
      {!forced && <PasswordCard />}
      <TwoFactorCard enabled={!!user?.totpEnabled} required={!!me?.org.require2fa} onChange={() => qc.invalidateQueries({ queryKey: ["me"] })} />
      {!forced && <SessionsCard />}
    </div>
  );
}

function PasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr({});
    try {
      await api.post("/api/auth/password", { current: cur, next });
      setCur("");
      setNext("");
      toast.success(tr("Password changed", "Passwort geändert"), { description: tr("Other devices were signed out.", "Andere Geräte wurden abgemeldet.") });
    } catch (ex) {
      setErr(ex instanceof ApiError ? { ...ex.fields, _: ex.message } : { _: tr("Failed", "Fehlgeschlagen") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={tr("Change password", "Passwort ändern")} text={tr("At least 10 characters. All other devices are signed out after the change.", "Mindestens 10 Zeichen. Nach der Änderung werden alle anderen Geräte abgemeldet.")}>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={tr("Current password", "Aktuelles Passwort")} error={err.current} htmlFor="s-cur">
          <input id="s-cur" type="password" className="field" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label={tr("New password", "Neues Passwort")} error={err.next} htmlFor="s-next">
          <input id="s-next" type="password" className="field" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        {err._ && !err.current && !err.next && <p className="text-sm text-neg sm:col-span-2">{err._}</p>}
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" icon={<KeyRound className="h-4 w-4" />} loading={busy} disabled={!cur || next.length < 10}>
            {tr("Change password", "Passwort ändern")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorCard({ enabled, required, onChange }: { enabled: boolean; required: boolean; onChange: () => void }) {
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "disable">("idle");
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ secret: string; qrSvg: string }>("/api/auth/2fa/setup", { password: pw });
      setSetup(r);
      setStep("scan");
      setPw("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function enable() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { code });
      setCodes(r.recoveryCodes);
      setStep("codes");
      setCode("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/2fa/disable", { password: pw, code });
      setStep("idle");
      setPw("");
      setCode("");
      onChange();
      toast(tr("Two-factor authentication disabled", "Zwei-Faktor-Anmeldung deaktiviert"));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function downloadCodes() {
    const blob = new Blob([`${tr("nalpia Intranet – recovery codes\nEach code works exactly once.", "nalpia Intranet – Wiederherstellungscodes\nJeder Code funktioniert genau einmal.")}\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = tr("nalpia-intranet-recovery-codes.txt", "nalpia-intranet-wiederherstellungscodes.txt");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card title={tr("Two-factor authentication", "Zwei-Faktor-Anmeldung")} text={tr("In addition to your password, the intranet asks for a code from an authenticator app (e.g. Microsoft Authenticator, 1Password, Google Authenticator).", "Zusätzlich zum Passwort fragt das Intranet einen Code aus einer Authenticator-App ab (z. B. Microsoft Authenticator, 1Password, Google Authenticator).")}>
      {step === "codes" ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-pos-soft px-3 py-2.5 text-sm font-semibold text-pos">{tr("Enabled. Keep these recovery codes somewhere safe – each one works exactly once in case you lose your phone.", "Aktiviert. Bewahre diese Wiederherstellungscodes sicher auf – jeder funktioniert genau einmal, falls du dein Handy verlierst.")}</p>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface2 p-3 sm:grid-cols-4">
            {codes.map((c) => (
              <code key={c} className="num text-center text-[13px]">
                {c}
              </code>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast(tr("Copied", "Kopiert")))}>
              {tr("Copy", "Kopieren")}
            </Button>
            <Button size="sm" icon={<Download className="h-4 w-4" />} onClick={downloadCodes}>
              {tr("Save as file", "Als Datei speichern")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => { setStep("idle"); onChange(); }}>
              {tr("Done", "Fertig")}
            </Button>
          </div>
        </div>
      ) : enabled ? (
        step === "disable" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tr("Password", "Passwort")} htmlFor="d-pw">
              <input id="d-pw" type="password" className="field" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label={tr("Code from the app", "Code aus der App")} htmlFor="d-code">
              <input id="d-code" className="field num" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            {err && <p className="text-sm text-neg sm:col-span-2">{err}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setStep("idle")}>
                {tr("Cancel", "Abbrechen")}
              </Button>
              <Button variant="danger" onClick={disable} loading={busy}>
                {tr("Disable", "Deaktivieren")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-pos" />
            <p className="flex-1 text-sm font-semibold">{tr("Active", "Aktiv")}</p>
            {!required && (
              <Button size="sm" variant="ghost" onClick={() => setStep("disable")}>
                {tr("Disable", "Deaktivieren")}
              </Button>
            )}
          </div>
        )
      ) : step === "idle" ? (
        <Button variant="primary" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setStep("password")}>
          {tr("Set up now", "Jetzt einrichten")}
        </Button>
      ) : step === "password" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
          className="space-y-3"
        >
          <Field label={tr("Please confirm with your password", "Bitte bestätige mit deinem Passwort")} htmlFor="t-pw">
            <input id="t-pw" type="password" className="field" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          {err && <p className="text-sm text-neg">{err}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep("idle")}>
              {tr("Cancel", "Abbrechen")}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!pw}>
              {tr("Continue", "Weiter")}
            </Button>
          </div>
        </form>
      ) : (
        setup && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[180px_1fr]">
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`} alt={tr("QR code for the authenticator app", "QR-Code für die Authenticator-App")} className="h-[180px] w-[180px] rounded-xl border border-line bg-white p-2" />
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>{tr("Open your authenticator app and scan the QR code.", "Öffne deine Authenticator-App und scanne den QR-Code.")}</li>
                <li>{tr("Enter the 6-digit code the app shows.", "Gib den 6-stelligen Code ein, den die App anzeigt.")}</li>
              </ol>
              <p className="text-[12.5px] text-muted">
                {tr("Can't scan? Enter the key manually:", "Kein Scan möglich? Schlüssel manuell eingeben:")} <code className="num select-all break-all text-ink">{setup.secret}</code>
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void enable();
                }}
                className="flex gap-2"
              >
                <input className="field num w-[140px] text-center text-[18px] tracking-[0.25em]" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Code" />
                <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>
                  {tr("Enable", "Aktivieren")}
                </Button>
              </form>
              {err && <p className="text-sm text-neg">{err}</p>}
            </div>
          </div>
        )
      )}
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<{ id: string; createdAt: number; lastSeenAt: number; userAgent: string; ip: string; current: boolean }[]>("/api/auth/sessions"),
  });
  const device = (ua: string) => {
    const mobile = /iPhone|Android|Mobile/i.test(ua);
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
    return { mobile, label: `${browser}${os ? ` ${tr("on", "auf")} ${os}` : ""}` };
  };
  return (
    <Card title={tr("Signed-in devices", "Angemeldete Geräte")} text={tr("Sign out devices you no longer use or don't recognize.", "Melde Geräte ab, die du nicht mehr nutzt oder nicht kennst.")}>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : (
        <ul className="divide-y divide-line">
          {(data ?? []).map((s) => {
            const d = device(s.userAgent);
            const I = d.mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <I className="h-5 w-5 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {d.label} {s.current && <span className="ml-1 rounded-full bg-pos-soft px-2 py-px text-[11.5px] text-pos">{tr("This device", "Dieses Gerät")}</span>}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {tr("Last active", "Zuletzt aktiv")} {relTime(s.lastSeenAt)}
                    {s.ip && `, ${s.ip}`}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.del(`/api/auth/sessions/${s.id}`);
                      qc.invalidateQueries({ queryKey: ["sessions"] });
                    }}
                  >
                    {tr("Sign out", "Abmelden")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(data?.length ?? 0) > 1 && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3"
          icon={<LogOut className="h-4 w-4" />}
          onClick={async () => {
            await api.post("/api/auth/sessions/revoke-others");
            qc.invalidateQueries({ queryKey: ["sessions"] });
            toast(tr("All other devices signed out", "Alle anderen Geräte abgemeldet"));
          }}
        >
          {tr("Sign out all others", "Alle anderen abmelden")}
        </Button>
      )}
    </Card>
  );
}

function usePrefsSaver() {
  const qc = useQueryClient();
  return async (p: Partial<Prefs>, msg = tr("Saved", "Gespeichert")) => {
    try {
      await api.patch("/api/me/prefs", p);
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
}

function MailTab() {
  const qc = useQueryClient();
  const me = useMe().data;
  const status = useMailStatus().data;
  const save = usePrefsSaver();
  const [sig, setSig] = useState<string | null>(null);
  useEffect(() => {
    if (me?.prefs && sig === null) setSig(me.prefs.signature ?? "");
  }, [me, sig]);

  async function disconnect() {
    if (!window.confirm(status?.mode === "imap" ? tr("Disconnect your mailbox? The stored mailbox password will be deleted from the intranet.", "Postfach-Verbindung wirklich trennen? Das gespeicherte Postfach-Passwort wird aus dem Intranet gelöscht.") : tr("Disconnect your mailbox? The access key will be deleted and revoked at the provider.", "Postfach-Verbindung wirklich trennen? Der Zugriffsschlüssel wird gelöscht und beim Anbieter widerrufen."))) return;
    await api.post("/api/mail/disconnect");
    qc.invalidateQueries({ queryKey: ["mail"] });
    toast(tr("Mailbox disconnected", "Postfach getrennt"));
  }

  return (
    <div className="space-y-4">
      <Card title={tr("Connection", "Verbindung")} text={tr("Your mailbox is visible only to you – admins have no access either.", "Dein Postfach ist nur für dich sichtbar – auch Admins haben keinen Zugriff.")}>
        {!me?.features.mail ? (
          <p className="text-sm text-muted">{tr("The mailbox connection hasn't been set up on the server yet.", "Die Postfach-Anbindung ist auf dem Server noch nicht eingerichtet.")}</p>
        ) : !status ? (
          <Skeleton className="h-12" />
        ) : status.connected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-pos-soft text-pos">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{tr("Connected to", "Verbunden mit")} {status.email}</p>
                <p className="text-[12.5px] text-muted">{status.connectedAt ? tr(`since ${relTime(status.connectedAt)}`, `seit ${relTime(status.connectedAt)}`) : ""}</p>
              </div>
              <Button size="sm" variant="danger" onClick={disconnect}>
                {tr("Disconnect", "Trennen")}
              </Button>
            </div>
            {status.needsReconnect && (
              <div className="space-y-2 rounded-xl bg-accent-soft px-3 py-2.5 text-sm">
                <p>{status.mode === "imap" ? tr("The mailbox no longer accepts the stored password. Enter your current password:", "Das Postfach akzeptiert das gespeicherte Passwort nicht mehr. Gib dein aktuelles Passwort ein:") : tr("The connection has expired.", "Die Verbindung ist abgelaufen.")}</p>
                <MailConnectForm compact status={status} />
              </div>
            )}
            {status.mode === "imap" && !status.needsReconnect && (
              <details className="text-[13px]">
                <summary className="cursor-pointer text-muted">{tr("Changed your mailbox password?", "Postfach-Passwort geändert?")}</summary>
                <div className="mt-2">
                  <MailConnectForm compact status={status} />
                </div>
              </details>
            )}
            {(status.addresses?.length ?? 0) > 1 && (
              <Field label={tr("Default sender", "Standard-Absender")} hint={tr("Other addresses (aliases) of your mailbox.", "Weitere Adressen (Aliase) deines Postfachs.")} htmlFor="m-from">
                <Select id="m-from" value={me.prefs?.fromAddress || status.email} onChange={(e) => save({ fromAddress: e.target.value }, tr("Sender saved", "Absender gespeichert"))}>
                  {status.addresses!.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        ) : (
          <MailConnectForm status={status} />
        )}
      </Card>
      <Card title={tr("Signature", "Signatur")} text={tr("Added to your e-mails when sending.", "Wird beim Senden an deine Mails angehängt.")}>
        <textarea className="field min-h-[120px]" value={sig ?? ""} onChange={(e) => setSig(e.target.value)} placeholder={tr("First name Last name\nRole", "Vorname Nachname\nRolle") + "\nnalpia GmbH i. G.\nRosenthaler Straße 50, 10178 Berlin"} aria-label={tr("Signature", "Signatur")} />
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => save({ signature: sig ?? "" }, tr("Signature saved", "Signatur gespeichert"))}>
            {tr("Save signature", "Signatur speichern")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AiTab() {
  const me = useMe().data;
  const save = usePrefsSaver();
  const [style, setStyle] = useState<string | null>(null);
  useEffect(() => {
    if (me?.prefs && style === null) setStyle(me.prefs.aiStyle ?? "");
  }, [me, style]);
  if (!me) return <Skeleton className="h-60" />;
  return (
    <Card title={tr("How the AI writes for you", "So schreibt die KI für dich")} text={tr("Applies to drafts in Mail. Drafts are never sent automatically.", "Gilt für Entwürfe im Postfach. Entwürfe werden nie automatisch gesendet.")}>
      {!me.features.ai && <p className="mb-4 rounded-xl bg-surface2 px-3 py-2 text-sm text-muted">{tr("The AI features haven't been set up on the server yet (ANTHROPIC_API_KEY).", "Die KI-Funktionen sind auf dem Server noch nicht eingerichtet (ANTHROPIC_API_KEY).")}</p>}
      <div className="space-y-5">
        <Field label={tr("Form of address (German e-mails)", "Anrede (deutsche Mails)")}>
          <Segmented
            value={me.prefs?.salutation ?? "auto"}
            onChange={(v) => save({ salutation: v as Prefs["salutation"] }, tr("Form of address saved", "Anrede gespeichert"))}
            options={[
              { value: "auto", label: tr("As in the e-mail", "Wie in der Mail") },
              { value: "sie", label: tr("Always formal (Sie)", "Immer Sie") },
              { value: "du", label: tr("Always informal (du)", "Immer Du") },
            ]}
          />
        </Field>
        <Switch
          checked={me.prefs?.autoSuggest !== false}
          onChange={(v) => save({ autoSuggest: v }, v ? tr("Reply suggestions on", "Antwortvorschläge an") : tr("Reply suggestions off", "Antwortvorschläge aus"))}
          label={tr("Show reply suggestions automatically", "Antwortvorschläge automatisch anzeigen")}
          description={tr("When you open an incoming e-mail, the AI suggests up to three replies. When off, they only appear when you click the button.", "Beim Öffnen einer eingegangenen Mail schlägt die KI bis zu drei Antworten vor. Ausgeschaltet erscheinen sie erst auf Knopfdruck.")}
        />
        <Switch
          checked={me.prefs?.assistant !== false}
          onChange={(v) => save({ assistant: v }, v ? tr("Assistant on", "Assistent an") : tr("Assistant off", "Assistent aus"))}
          label={tr("Show personal AI assistant", "Persönlichen KI-Assistenten anzeigen")}
          description={tr("The chat window at the bottom right with briefings and suggestions for the current page. When closed, it appears as a small robot icon at the bottom right.", "Das Chatfenster unten rechts mit Briefings und Vorschlägen zur jeweiligen Seite. Geschlossen erscheint es als kleines Robotersymbol unten rechts.")}
        />
        <Field label={tr("Personal style notes", "Persönliche Stilhinweise")} hint={tr("Examples: “Short sentences, no filler”, “English e-mails in British English”, “Sign-off: Best regards”.", "Beispiele: „Kurze Sätze, keine Floskeln“, „Englische Mails in britischem Englisch“, „Grußformel: Beste Grüße“.")}>
          <textarea className="field min-h-[130px]" value={style ?? ""} onChange={(e) => setStyle(e.target.value)} aria-label={tr("Style notes", "Stilhinweise")} />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => save({ aiStyle: style ?? "" }, tr("Style saved", "Stil gespeichert"))}>
            {tr("Save", "Speichern")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AppearanceTab() {
  const [theme, setTheme] = useState<Theme>(currentTheme());
  const save = usePrefsSaver();
  return (
    <Card title={tr("Appearance", "Darstellung")} text={tr("Theme applies to this device.", "Das Farbschema gilt für dieses Gerät.")}>
      <Segmented<Theme>
        value={theme}
        onChange={(t) => {
          setTheme(t);
          applyTheme(t);
          void save({ theme: t }, tr("Appearance saved", "Darstellung gespeichert"));
        }}
        options={[
          { value: "system", label: <span className="inline-flex items-center gap-1.5"><Laptop className="h-4 w-4" /> System</span> },
          { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="h-4 w-4" /> {tr("Light", "Hell")}</span> },
          { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="h-4 w-4" /> {tr("Dark", "Dunkel")}</span> },
        ]}
      />
      <div className="mt-5 space-y-2">
        <p className="label">Language / Sprache</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <LangToggle />
          <span className="text-[13px] text-muted">{tr("Saved to your account – applies on every device.", "Wird in deinem Konto gespeichert und gilt auf allen Geräten.")}</span>
        </div>
      </div>
      <div className="mt-5 flex gap-3 rounded-xl bg-surface2 px-3.5 py-3">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <p className="text-[13.5px]">
          <b>{tr("As an app on your phone:", "Als App aufs Handy:")}</b> {tr("In Safari “Share → Add to Home Screen”, in Chrome “Menu → Install app”. The intranet then opens full screen like an app.", "In Safari „Teilen → Zum Home-Bildschirm“, in Chrome „Menü → App installieren“. Das Intranet startet dann im Vollbild wie eine App.")}
        </p>
      </div>
    </Card>
  );
}
