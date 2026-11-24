import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Button, Spinner } from "@/components/ui";
import { AppShell, useLogout } from "@/layout/AppShell";
import { LogoMark, Wordmark } from "@/layout/Logo";
import { onUnauthenticated } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { applyTheme, currentTheme } from "@/lib/theme";
import type { Me } from "@/lib/types";
import { ForgotPage, LoginPage, TokenPage } from "@/pages/Auth";
import { HomePage } from "@/pages/Home";
import { tr } from "@/lib/i18n";

// Pages load on demand – keeps the home page fast
const CalendarPage = lazy(() => import("@/pages/Calendar").then((m) => ({ default: m.CalendarPage })));
const AdminPage = lazy(() => import("@/pages/Admin").then((m) => ({ default: m.AdminPage })));
const ContactsPage = lazy(() => import("@/pages/Contacts").then((m) => ({ default: m.ContactsPage })));
const ContactDetailPage = lazy(() => import("@/pages/Contacts").then((m) => ({ default: m.ContactDetailPage })));
const OrgsPage = lazy(() => import("@/pages/Orgs").then((m) => ({ default: m.OrgsPage })));
const OrgDetailPage = lazy(() => import("@/pages/Orgs").then((m) => ({ default: m.OrgDetailPage })));
const MailPage = lazy(() => import("@/pages/Mail").then((m) => ({ default: m.MailPage })));
const MilestoneDetailPage = lazy(() => import("@/pages/MilestoneDetail").then((m) => ({ default: m.MilestoneDetailPage })));
const NewsPage = lazy(() => import("@/pages/News").then((m) => ({ default: m.NewsPage })));
const NewsDetailPage = lazy(() => import("@/pages/News").then((m) => ({ default: m.NewsDetailPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));
const TasksPage = lazy(() => import("@/pages/Tasks").then((m) => ({ default: m.TasksPage })));
const TeamPage = lazy(() => import("@/pages/Team").then((m) => ({ default: m.TeamPage })));
const AgentPage = lazy(() => import("@/pages/Agent").then((m) => ({ default: m.AgentPage })));
const PersonPage = lazy(() => import("@/pages/Team").then((m) => ({ default: m.PersonPage })));

function PageFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner />
    </div>
  );
}

function Splash() {
  return (
    <div className="grid min-h-[100dvh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="h-12 w-12" />
        <Spinner />
      </div>
    </div>
  );
}

function TwoFactorGate() {
  const logout = useLogout();
  return (
    <div className="min-h-[100dvh] px-4 py-8">
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between">
        <div className="flex items-center gap-2">
          <Wordmark className="h-5 w-auto text-brand dark:text-ink" />
        </div>
        <Button size="sm" variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={logout}>
          {tr("Sign out", "Abmelden")}
        </Button>
      </div>
      <Suspense fallback={<PageFallback />}>
        <SettingsPage forced2fa />
      </Suspense>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <Splash />;
  if (!me.data?.user) return <Navigate to={`/login?weiter=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.data.mustSetup2fa) return <TwoFactorGate />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Splash />;
  if (me.data?.user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const qc = useQueryClient();
  const me = useMe().data;

  useEffect(
    () =>
      onUnauthenticated(() => {
        const cur = qc.getQueryData<Me>(["me"]);
        if (cur?.user) qc.setQueryData(["me"], { ...cur, user: null });
      }),
    [qc],
  );

  // Apply the saved color scheme (synced across devices; the local value only wins until loaded)
  useEffect(() => {
    const t = me?.prefs?.theme;
    if (t && t !== currentTheme()) applyTheme(t);
  }, [me?.prefs?.theme]);

  return (
    <Suspense fallback={<Splash />}>
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/passwort-vergessen" element={<PublicOnly><ForgotPage /></PublicOnly>} />
      <Route path="/einladung/:token" element={<TokenPage kind="invite" />} />
      <Route path="/passwort-neu/:token" element={<TokenPage kind="reset" />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="news/:id" element={<NewsDetailPage />} />
        <Route path="aufgaben" element={<TasksPage />} />
        <Route path="aufgaben/meilensteine/:id" element={<MilestoneDetailPage />} />
        <Route path="postfach" element={<MailPage />} />
        <Route path="kalender" element={<CalendarPage />} />
        <Route path="kontakte" element={<ContactsPage />} />
        <Route path="kontakte/:id" element={<ContactDetailPage />} />
        <Route path="investoren" element={<OrgsPage kind="investor" key="investor" />} />
        <Route path="investoren/:id" element={<OrgDetailPage kind="investor" key="investor-d" />} />
        <Route path="partner" element={<OrgsPage kind="partner" key="partner" />} />
        <Route path="partner/:id" element={<OrgDetailPage kind="partner" key="partner-d" />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="team/:id" element={<PersonPage />} />
        <Route path="einstellungen" element={<SettingsPage />} />
        <Route path="admin" element={me?.user?.role === "admin" ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-[48px] font-extrabold text-muted/40">404</p>
      <p className="font-bold">{tr("This page doesn't exist.", "Diese Seite gibt es nicht.")}</p>
      <a href="/" className="link mt-2 inline-block">
        {tr("Go to Home", "Zur Startseite")}
      </a>
    </div>
  );
}
