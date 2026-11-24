import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { Button, Field, Spinner } from "@/components/ui";
import { LangToggle } from "@/components/LangToggle";
import { LogoFull } from "@/layout/Logo";
import { tr } from "@/lib/i18n";

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-rail text-rail-ink lg:block">
        <svg className="absolute inset-0 h-full w-full opacity-[0.12]" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <path d="M-20 760h80v-80h80v-80h80v-80h80v-80h80v-80h80v-80h80v-80h80" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M-20 820h80v-80h80v-80h80v-80h80v-80h80v-80h80v-80h80v-80h80" fill="none" stroke="#fff" strokeWidth="1" />
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <LogoFull className="h-auto w-[230px] text-white" />
          <div className="max-w-md">
            <p className="text-[40px] font-extrabold leading-[1.05] tracking-[-0.025em]">{tr("Everything the team needs today.", "Alles, was das Team heute braucht.")}</p>
            <p className="mt-4 text-[16px] leading-relaxed text-rail-muted">{tr("Fundraising CRM with an AI agent, tasks and milestones, your mailbox and partners in one place.", "Fundraising-CRM mit KI-Agent, Aufgaben und Meilensteine, dein Postfach und die Partner an einem Ort.")}</p>
          </div>
          <p className="text-[12.5px] text-rail-muted">{tr("Internal system. Access for the nalpia team only.", "Internes System. Zugriff nur für das nalpia-Team.")}</p>
        </div>
      </aside>
      <main className="relative flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <LangToggle persist={false} />
        </div>
        <div className="mx-auto w-full max-w-[400px]">
          <div className="mb-9 lg:hidden">
            <LogoFull className="h-auto w-[190px] text-brand dark:text-ink" />
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
    </div>
  );
}

function PasswordInput({ value, onChange, id, autoComplete, autoFocus }: { value: string; onChange: (v: string) => void; id: string; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        className="field h-12 pr-12"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
      />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? tr("Hide password", "Passwort verbergen") : tr("Show password", "Passwort anzeigen")} className="absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface2">
        {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      </button>
    </div>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useMe().data;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password, code: needCode ? code : undefined });
      await qc.invalidateQueries();
      const next = params.get("weiter");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "totp_required") {
        setNeedCode(true);
        setError(null);
      } else setError(err instanceof ApiError ? err.message : tr("Sign-in failed.", "Anmeldung fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={needCode ? tr("Verification code", "Bestätigungscode") : tr("Sign in", "Anmelden")} subtitle={needCode ? tr("Enter the 6-digit code from your authenticator app.", "Gib den 6-stelligen Code aus deiner Authenticator-App ein.") : tr("With your nalpia e-mail address.", "Mit deiner nalpia-E-Mail-Adresse.")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {!needCode ? (
          <>
            <Field label={tr("E-mail address", "E-Mail-Adresse")} htmlFor="email">
              <input id="email" type="email" inputMode="email" autoComplete="username" className="field h-12" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required placeholder={tr("firstname@nalpia.com", "vorname@nalpia.com")} />
            </Field>
            <Field label={tr("Password", "Passwort")} htmlFor="password">
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
          </>
        ) : (
          <Field label="Code" htmlFor="code" hint={tr("No access to the app? Enter one of your recovery codes.", "Kein Zugriff auf die App? Gib einen deiner Wiederherstellungscodes ein.")}>
            <input
              id="code"
              className="field num h-12 text-center text-[22px] tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={14}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-neg-soft px-3 py-2.5 text-sm font-medium text-neg">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={needCode ? code.trim().length < 6 : !email || !password}>
          {needCode ? tr("Confirm", "Bestätigen") : tr("Sign in", "Anmelden")}
        </Button>
        <div className="flex items-center justify-between pt-1 text-sm">
          {needCode ? (
            <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-muted hover:text-ink" onClick={() => setNeedCode(false)}>
              <ArrowLeft className="h-4 w-4" /> {tr("Back", "Zurück")}
            </button>
          ) : (
            <Link to="/passwort-vergessen" className="link">
              {tr("Forgot password?", "Passwort vergessen?")}
            </Link>
          )}
        </div>
        {me?.features.demo && !needCode && (
          <div className="rounded-xl border border-dashed border-accent/60 bg-accent-soft/50 px-3 py-2.5 text-[13px]">
            <b>{tr("Demo mode:", "Demo-Modus:")}</b> {tr("sign in e.g. with", "Anmeldung z. B. mit")} <span className="num">denis@nalpia.demo</span> {tr("and password", "und Passwort")} <span className="num">nalpia-demo-2026</span>.
          </div>
        )}
      </form>
    </AuthLayout>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "email" | "admin">("idle");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      const r = await api.post<{ mode: "email" | "admin" }>("/api/auth/forgot", { email });
      setState(r.mode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr("That didn't work.", "Das hat nicht geklappt."));
      setState("idle");
    }
  }
  return (
    <AuthLayout title={tr("Forgot password", "Passwort vergessen")} subtitle={tr("We'll help you get back in.", "Wir helfen dir, wieder hineinzukommen.")}>
      {state === "email" ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-pos-soft px-3 py-3 text-sm">{tr("If there is an account for", "Falls es ein Konto für")} <b>{email}</b>{tr(", a reset link is on its way. It is valid for 24 hours.", " gibt, ist ein Link zum Zurücksetzen unterwegs. Er ist 24 Stunden gültig.")}</p>
          <Link to="/login" className="link">
            {tr("Back to sign-in", "Zur Anmeldung")}
          </Link>
        </div>
      ) : state === "admin" ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-surface2 px-3 py-3 text-sm">{tr("Please contact an admin (e.g. Jona or Denis). They can create a reset link for you in Admin.", "Bitte wende dich an eine Admin-Person (z. B. Jona oder Denis). Sie kann dir in der Verwaltung einen Link zum Zurücksetzen erzeugen.")}</p>
          <Link to="/login" className="link">
            {tr("Back to sign-in", "Zur Anmeldung")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={tr("E-mail address", "E-Mail-Adresse")} htmlFor="femail">
            <input id="femail" type="email" inputMode="email" autoComplete="username" className="field h-12" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </Field>
          {error && <p className="text-sm font-medium text-neg">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={state === "busy"} disabled={!email}>
            {tr("Request link", "Link anfordern")}
          </Button>
          <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> {tr("Back to sign-in", "Zurück zur Anmeldung")}
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

export function TokenPage({ kind }: { kind: "invite" | "reset" }) {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ["token", kind, token], queryFn: () => api.get<{ email: string; name: string }>(`/api/auth/token/${kind}/${token}`), retry: false });
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = strength(pw);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setError(tr("The passwords don't match.", "Die Passwörter stimmen nicht überein."));
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ loggedIn: boolean }>("/api/auth/token/complete", { kind, token, password: pw });
      await qc.invalidateQueries();
      navigate(r.loggedIn ? "/" : "/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr("That didn't work.", "Das hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  }

  if (info.isLoading)
    return (
      <AuthLayout title={kind === "invite" ? tr("Welcome", "Willkommen") : tr("New password", "Neues Passwort")}>
        <Spinner />
      </AuthLayout>
    );
  if (info.isError)
    return (
      <AuthLayout title={tr("Invalid link", "Link ungültig")} subtitle={(info.error as Error).message}>
        <Link to="/login" className="link">
          {tr("Back to sign-in", "Zur Anmeldung")}
        </Link>
      </AuthLayout>
    );

  const first = info.data!.name.split(" ")[0];
  return (
    <AuthLayout
      title={kind === "invite" ? tr(`Welcome, ${first}`, `Willkommen, ${first}`) : tr("New password", "Neues Passwort")}
      subtitle={kind === "invite" ? tr("Set your password to start using the intranet.", "Lege dein Passwort fest, um das Intranet zu nutzen.") : tr(`For ${info.data!.email}`, `Für ${info.data!.email}`)}
    >
      <form onSubmit={submit} className="space-y-4">
        <input type="email" autoComplete="username" value={info.data!.email} readOnly hidden />
        <Field label={tr("New password", "Neues Passwort")} htmlFor="pw" hint={tr("At least 10 characters. A sentence of several words is secure and easy to remember.", "Mindestens 10 Zeichen. Ein Satz aus mehreren Wörtern ist sicher und gut zu merken.")}>
          <PasswordInput id="pw" value={pw} onChange={setPw} autoComplete="new-password" autoFocus />
        </Field>
        <div className="flex gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < s ? (s < 2 ? "bg-neg" : s < 3 ? "bg-accent" : "bg-pos") : "bg-surface2"}`} />
          ))}
        </div>
        <Field label={tr("Repeat password", "Passwort wiederholen")} htmlFor="pw2">
          <PasswordInput id="pw2" value={pw2} onChange={setPw2} autoComplete="new-password" />
        </Field>
        {error && <p className="rounded-xl bg-neg-soft px-3 py-2.5 text-sm font-medium text-neg">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={pw.length < 10 || !pw2} icon={<KeyRound className="h-4 w-4" />}>
          {tr("Save password", "Passwort speichern")}
        </Button>
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {tr("Tip: after signing in, set up two-factor authentication in Settings.", "Tipp: Richte nach der Anmeldung die Zwei-Faktor-Anmeldung in den Einstellungen ein.")}
        </p>
      </form>
    </AuthLayout>
  );
}
