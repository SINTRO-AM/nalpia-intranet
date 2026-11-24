import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, cx } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useMailStatus, useMe } from "@/lib/queries";
import type { MailStatus } from "@/lib/types";

/** Starts the provider's sign-in (Zoho / demo) – IMAP mailboxes use the password form instead. */
export async function startOAuthConnect() {
  const { url } = await api.post<{ url: string }>("/api/mail/connect");
  window.location.href = url;
}

/**
 * Connect (or reconnect) the signed-in person's own mailbox.
 * IMAP (Spacemail): mailbox password, checked against IMAP and SMTP, stored encrypted.
 * Zoho / demo: redirect to the provider's sign-in.
 */
export function MailConnectForm({ compact = false, status: given, onDone }: { compact?: boolean; status?: MailStatus; onDone?: () => void }) {
  const me = useMe().data;
  const live = useMailStatus().data;
  const status = given ?? live;
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = status?.providerName || "Spacemail";
  const email = status?.email || me?.user?.email || "";

  if (status && status.mode !== "imap") {
    return (
      <Button
        variant="primary"
        size={compact ? "sm" : "lg"}
        className={compact ? "" : "w-full"}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await startOAuthConnect();
          } catch (e) {
            toast.error((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {status.mode === "demo"
          ? tr("Connect demo mailbox", "Demo-Postfach verbinden")
          : status.connected
            ? tr(`Reconnect with ${provider}`, `Mit ${provider} neu verbinden`)
            : tr(`Connect with ${provider}`, `Mit ${provider} verbinden`)}
      </Button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/mail/connect-password", { password });
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["mail"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      toast.success(tr("Mailbox connected", "Postfach verbunden"), { description: email });
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={cx("space-y-2", compact && "w-full")}>
      {!compact && (
        <div className="rounded-xl bg-surface2 px-3 py-2.5 text-[13.5px]">
          <span className="text-muted">{tr("Mailbox", "Postfach")}: </span>
          <b>{email}</b> <span className="text-muted">({provider})</span>
        </div>
      )}
      <div className={cx("flex gap-2", compact ? "flex-row" : "flex-col sm:flex-row")}>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{tr(`${provider} password for ${email}`, `${provider}-Passwort für ${email}`)}</span>
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="password"
            className="field pl-9"
            autoComplete="current-password"
            name="mailbox-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tr(`${provider} password`, `${provider}-Passwort`)}
            required
          />
        </label>
        <Button type="submit" variant="primary" size={compact ? "sm" : "lg"} loading={busy} disabled={!password}>
          {status?.connected ? tr("Reconnect", "Neu verbinden") : tr("Connect", "Verbinden")}
        </Button>
      </div>
      {error && <p className="rounded-xl bg-neg-soft px-3 py-2 text-[13px] font-medium text-neg">{error}</p>}
      {!compact && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {tr(
            `The password you use for ${provider} webmail. The intranet checks it against the mail server, stores it encrypted and uses it only for your mailbox and calendar. If you change it at ${provider}, reconnect here.`,
            `Das Passwort, mit dem du dich im ${provider}-Webmail anmeldest. Das Intranet prüft es am Mailserver, speichert es verschlüsselt und nutzt es nur für dein Postfach und deinen Kalender. Änderst du es bei ${provider}, verbindest du hier neu.`,
          )}
        </p>
      )}
    </form>
  );
}
