import { ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { Sheet } from "./Sheet";
import { Button, Field } from "./ui";
import { tr } from "@/lib/i18n";

/** Thrown when the person cancels the confirmation – no error toast needed. */
export class ReauthCancelled extends Error {
  constructor() {
    super(tr("Cancelled", "Abgebrochen"));
  }
}

type Run = <T>(fn: () => Promise<T>) => Promise<T>;
const Ctx = createContext<Run>((fn) => fn());

/**
 * Sensitive admin actions require a fresh confirmation (password + code).
 * `run(fn)` runs the action; if the server reports "reauth_required", the dialog appears
 * and the action is retried exactly once after a successful confirmation.
 */
export function ReauthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const navigate = useNavigate();

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  };

  const run = useCallback<Run>(
    async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ApiError && e.code === "reauth_required") {
          if (!(await ask())) throw new ReauthCancelled();
          return await fn();
        }
        if (e instanceof ApiError && e.code === "admin_2fa_required") {
          toast.error(e.message, { action: { label: tr("Set up", "Einrichten"), onClick: () => navigate("/einstellungen?tab=sicherheit") } });
          throw new ReauthCancelled();
        }
        throw e;
      }
    },
    [ask, navigate],
  );

  return (
    <Ctx.Provider value={run}>
      {children}
      <ReauthDialog open={open} onDone={finish} />
    </Ctx.Provider>
  );
}

export const useGuarded = () => useContext(Ctx);

function ReauthDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const me = useMe().data?.user;
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  const close = (ok: boolean) => {
    setPassword("");
    setCode("");
    setErr({});
    onDone(ok);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr({});
    try {
      await api.post("/api/auth/confirm", { password, code: me?.totpEnabled ? code : undefined });
      close(true);
    } catch (x) {
      setErr(x instanceof ApiError ? { ...x.fields, _: x.message } : { _: tr("Confirmation failed.", "Bestätigung fehlgeschlagen.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && close(false)} title={tr("Confirm action", "Aktion bestätigen")} variant="dialog">
      <form className="space-y-4" onSubmit={submit}>
        <p className="flex items-start gap-2.5 text-[14px] text-muted">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          {tr("This change affects the security of an account. Please confirm it – you'll then be cleared for 10 minutes.", "Diese Änderung betrifft die Sicherheit eines Kontos. Bitte bestätige sie – danach bist du für 10 Minuten freigeschaltet.")}
        </p>
        <Field label={tr("Your password", "Dein Passwort")} error={err.password} htmlFor="reauth-pw">
          <input id="reauth-pw" type="password" autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        {me?.totpEnabled && (
          <Field label={tr("Code from your authenticator app", "Code aus der Authenticator-App")} error={err.code} htmlFor="reauth-code">
            <input
              id="reauth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="field num tracking-[0.2em]"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={14}
            />
          </Field>
        )}
        {err._ && !err.password && !err.code && <p className="text-sm font-medium text-neg">{err._}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!password || (me?.totpEnabled && code.trim().length < 6)}>
            {tr("Confirm", "Bestätigen")}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
