import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  Building2,
  CalendarDays,
  CheckSquare,
  Handshake,
  ChevronDown,
  Flag,
  Home,
  Inbox,
  Kanban,
  LogOut,
  Megaphone,
  Menu,
  Newspaper,
  Plus,
  Search,
  Settings,
  Shield,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useOverlays } from "@/lib/overlays";
import { useAgentStatus, useMailUnread, useMe, useNews, useNotifications } from "@/lib/queries";
import { Assistant } from "@/components/Assistant";
import { LangToggle, useProfileLang } from "@/components/LangToggle";
import { CommandPalette } from "@/components/CommandPalette";
import { ComposerSheet } from "@/components/Composer";
import { ContactSheet } from "@/components/ContactSheet";
import { MilestoneSheet } from "@/components/MilestoneSheet";
import { NewsComposer } from "@/components/NewsComposer";
import { NotificationsSheet } from "@/components/NotificationsSheet";
import { OrgSheet } from "@/components/OrgSheet";
import { Sheet } from "@/components/Sheet";
import { TaskSheet } from "@/components/TaskSheet";
import { TopicSheet } from "@/components/TopicSheet";
import { Avatar, cx, IconButton, Kbd } from "@/components/ui";
import { LogoFull, Wordmark } from "./Logo";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  end?: boolean;
}

function useNav(): { main: NavItem[]; crm: NavItem[]; more: NavItem[] } {
  const me = useMe().data;
  const news = useNews().data;
  const mail = useMailUnread(!!me?.features.mail).data;
  const agent = useAgentStatus(!!me?.user).data;
  const toReview = agent ? agent.counts.draft + agent.counts.needsNote + agent.counts.pendingMessages : 0;
  const main: NavItem[] = [
    { to: "/", label: tr("Home", "Start"), icon: Home, end: true },
    { to: "/news", label: "News", icon: Newspaper, badge: news?.unread },
    { to: "/aufgaben", label: tr("Tasks", "Aufgaben"), icon: CheckSquare },
    { to: "/themen", label: tr("Topics", "Themen"), icon: Kanban },
    { to: "/postfach", label: tr("Mail", "Postfach"), icon: Inbox, badge: mail?.unread },
    { to: "/kalender", label: tr("Calendar", "Kalender"), icon: CalendarDays },
  ];
  const crm: NavItem[] = [
    { to: "/investoren", label: tr("Investors", "Investoren"), icon: Building2 },
    { to: "/agent", label: tr("Agent", "Agent"), icon: Bot, badge: toReview },
    { to: "/partner", label: tr("Partners", "Partner"), icon: Handshake },
    { to: "/kontakte", label: tr("Contacts", "Kontakte"), icon: UsersRound },
  ];
  const more: NavItem[] = [
    { to: "/team", label: "Team", icon: Users },
    { to: "/einstellungen", label: tr("Settings", "Einstellungen"), icon: Settings },
    ...(me?.user?.role === "admin" ? [{ to: "/admin", label: tr("Admin", "Verwaltung"), icon: Shield }] : []),
  ];
  return { main, crm, more };
}

function Badge({ n, tone = "accent" }: { n?: number; tone?: "accent" | "neg" }) {
  if (!n) return null;
  return (
    <span className={cx("num grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-semibold leading-none", tone === "neg" ? "bg-neg text-white" : "bg-accent text-[#05224B]")}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      qc.clear();
      navigate("/login", { replace: true });
    }
  };
}

function CreateMenu({ trigger }: { trigger: ReactNode }) {
  const { open } = useOverlays();
  const items: { label: string; icon: LucideIcon; run: () => void }[] = [
    { label: tr("Task", "Aufgabe"), icon: CheckSquare, run: () => open({ kind: "task" }) },
    { label: tr("Topic", "Thema"), icon: Kanban, run: () => open({ kind: "topic" }) },
    { label: tr("Post", "Beitrag"), icon: Megaphone, run: () => open({ kind: "news" }) },
    { label: tr("E-mail", "E-Mail"), icon: Inbox, run: () => open({ kind: "compose", defaults: {} }) },
    { label: tr("Contact", "Kontakt"), icon: UserPlus, run: () => open({ kind: "contact" }) },
    { label: "Investor", icon: Building2, run: () => open({ kind: "org", orgKind: "investor" }) },
    { label: "Partner", icon: Handshake, run: () => open({ kind: "org", orgKind: "partner" }) },
    { label: tr("Milestone", "Meilenstein"), icon: Flag, run: () => open({ kind: "milestone" }) },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-[200px] rounded-xl border border-line bg-surface p-1.5 shadow-pop data-[state=open]:animate-pop-in">
          {items.map((i) => (
            <DropdownMenu.Item key={i.label} onSelect={i.run} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium outline-none data-[highlighted]:bg-surface2">
              <i.icon className="h-4 w-4 text-muted" />
              {i.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Rail() {
  const { main, crm, more } = useNav();
  const me = useMe().data?.user;
  const logout = useLogout();
  const navigate = useNavigate();
  const link = (i: NavItem) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.end}
      className={({ isActive }) =>
        cx(
          "group flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14.5px] font-medium transition",
          isActive ? "bg-rail-hover text-rail-ink" : "text-rail-muted hover:bg-rail-hover/60 hover:text-rail-ink",
        )
      }
    >
      {({ isActive }) => (
        <>
          <i.icon className={cx("h-[18px] w-[18px]", isActive && "text-accent")} />
          <span className="flex-1">{i.label}</span>
          <Badge n={i.badge} />
        </>
      )}
    </NavLink>
  );
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-rail px-3 pb-3 pt-5 text-rail-ink lg:flex">
      <div className="px-2.5 pb-1 pt-1">
        <LogoFull className="h-auto w-[132px] text-white" />
      </div>
      <CreateMenu
        trigger={
          <button className="mx-1 mt-5 flex h-10 items-center justify-center gap-2 rounded-[10px] bg-accent text-sm font-bold text-[#05224B] transition hover:brightness-105">
            <Plus className="h-4 w-4" strokeWidth={2.5} /> {tr("New", "Neu")}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </button>
        }
      />
      <nav className="mt-5 flex flex-col gap-0.5" aria-label={tr("Main navigation", "Hauptnavigation")}>
        {main.map(link)}
        <div className="my-3 h-px bg-rail-hover" />
        {crm.map(link)}
        <div className="my-3 h-px bg-rail-hover" />
        {more.map(link)}
      </nav>
      <div className="mt-auto">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition hover:bg-rail-hover">
              {me && <Avatar name={me.name} color={me.avatarColor} src={me.avatarUrl} size={34} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{me?.name}</span>
                <span className="block truncate text-[12px] text-rail-muted">{me?.title ? <Tx text={me.title} /> : me?.email}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-rail-muted" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="top" align="start" sideOffset={8} className="z-50 w-[220px] rounded-xl border border-line bg-surface p-1.5 shadow-pop">
              <DropdownMenu.Item onSelect={() => navigate("/einstellungen")} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface2">
                <Settings className="h-4 w-4 text-muted" /> {tr("Profile and settings", "Profil und Einstellungen")}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={logout} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neg outline-none data-[highlighted]:bg-neg-soft">
                <LogOut className="h-4 w-4" /> {tr("Sign out", "Abmelden")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </aside>
  );
}

function TopBar() {
  useProfileLang();
  const { open } = useOverlays();
  const notif = useNotifications().data;
  const me = useMe().data?.user;
  const navigate = useNavigate();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-2 px-4 lg:h-16 lg:px-8">
        <button className="flex items-center gap-2 lg:hidden" onClick={() => navigate("/")} aria-label={tr("Go to Home", "Zur Startseite")}>
          <Wordmark className="h-[19px] w-auto text-brand dark:text-ink" />
        </button>
        <button
          onClick={() => open({ kind: "palette" })}
          className="hidden h-10 w-[min(440px,40vw)] items-center gap-2.5 rounded-[11px] border border-line bg-surface px-3 text-left text-sm text-muted transition hover:border-muted/40 lg:flex"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1">{tr("Search or type a command", "Suchen oder Befehl eingeben")}</span>
          <Kbd>{mac ? "⌘" : tr("Ctrl", "Strg")}</Kbd>
          <Kbd>K</Kbd>
        </button>
        <div className="flex-1" />
        {/* on small phones the toggle moves into the "More" sheet */}
        <LangToggle className="hidden sm:inline-flex" />
        <IconButton label={tr("Search", "Suchen")} className="lg:hidden" onClick={() => open({ kind: "palette" })}>
          <Search className="h-5 w-5" />
        </IconButton>
        <IconButton label={notif?.unread ? tr(`Notifications (${notif.unread} new)`, `Benachrichtigungen (${notif.unread} neu)`) : tr("Notifications", "Benachrichtigungen")} onClick={() => open({ kind: "notifications" })}>
          <Bell className="h-5 w-5" />
          {!!notif?.unread && (
            <span className="absolute right-1.5 top-1.5">
              <Badge n={notif.unread} tone="neg" />
            </span>
          )}
        </IconButton>
        {me && (
          <button className="ml-1 lg:hidden" onClick={() => navigate("/einstellungen")} aria-label={tr("Profile and settings", "Profil und Einstellungen")}>
            <Avatar name={me.name} color={me.avatarColor} src={me.avatarUrl} size={32} />
          </button>
        )}
      </div>
    </header>
  );
}

function BottomNav() {
  const { main: all, crm, more: rest } = useNav();
  // The mobile bottom bar only fits four entries – the calendar lives under "More"
  const main = all.filter((i) => i.to !== "/kalender" && i.to !== "/themen");
  const more = [...all.filter((i) => i.to === "/themen" || i.to === "/kalender"), ...crm, ...rest];
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const logout = useLogout();
  const navigate = useNavigate();
  const moreActive = more.some((m) => loc.pathname.startsWith(m.to));
  useEffect(() => setMoreOpen(false), [loc.pathname]);
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden" aria-label={tr("Main navigation", "Hauptnavigation")}>
        <div className="mx-auto grid max-w-lg grid-cols-5 [padding-bottom:env(safe-area-inset-bottom)]">
          {main.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={({ isActive }) => cx("relative flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold transition", isActive ? "text-brand" : "text-muted")}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" />}
                  <span className="relative">
                    <i.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.3 : 1.9} />
                    {!!i.badge && (
                      <span className="absolute -right-3 -top-1.5">
                        <Badge n={i.badge} />
                      </span>
                    )}
                  </span>
                  {i.label}
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className={cx("relative flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold", moreActive ? "text-brand" : "text-muted")}
          >
            {moreActive && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" />}
            <Menu className="h-[22px] w-[22px]" />
            {tr("More", "Mehr")}
          </button>
        </div>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title={tr("More", "Mehr")}>
        <div className="grid grid-cols-2 gap-2">
          {more.map((m) => (
            <button key={m.to} onClick={() => navigate(m.to)} className="card flex h-20 flex-col items-start justify-between p-3 text-left active:scale-[.98]">
              <m.icon className="h-5 w-5 text-brand" />
              <span className="text-sm font-semibold">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5 sm:hidden">
          <span className="text-sm font-semibold">{tr("Language", "Sprache")}</span>
          <LangToggle />
        </div>
        <button onClick={logout} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold text-neg">
          <LogOut className="h-4 w-4" /> {tr("Sign out", "Abmelden")}
        </button>
      </Sheet>
    </>
  );
}

function Fab() {
  const loc = useLocation();
  const { open } = useOverlays();
  const p = loc.pathname;
  // In the open mail reader the button would cover the text
  if (p.startsWith("/postfach") && new URLSearchParams(loc.search).has("m")) return null;
  const action = p.startsWith("/postfach")
    ? { label: tr("New e-mail", "Neue E-Mail"), run: () => open({ kind: "compose", defaults: {} }) }
    : p.startsWith("/themen")
      ? { label: tr("New topic", "Neues Thema"), run: () => open({ kind: "topic" }) }
    : p.startsWith("/news")
      ? { label: tr("New post", "Neuer Beitrag"), run: () => open({ kind: "news" }) }
      : p.startsWith("/kontakte")
        ? { label: tr("New contact", "Neuer Kontakt"), run: () => open({ kind: "contact" }) }
        : p === "/investoren"
          ? { label: tr("New investor", "Neuer Investor"), run: () => open({ kind: "org", orgKind: "investor" as const }) }
          : p === "/partner"
            ? { label: tr("New partner", "Neuer Partner"), run: () => open({ kind: "org", orgKind: "partner" as const }) }
            : p.startsWith("/partner/") || p.startsWith("/investoren/") || p.startsWith("/agent")
              ? null
        : p.startsWith("/einstellungen") || p.startsWith("/admin") || p.startsWith("/team") || p.startsWith("/kalender")
          ? null
          : { label: tr("New task", "Neue Aufgabe"), run: () => open({ kind: "task" }) };
  if (!action) return null;
  return (
    <button
      onClick={action.run}
      aria-label={action.label}
      className="fixed right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-brand-ink shadow-pop transition active:scale-95 lg:hidden"
      style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
    >
      <Plus className="h-6 w-6" strokeWidth={2.4} />
    </button>
  );
}

export function AppShell() {
  const { open, stack } = useOverlays();
  const [params, setParams] = useSearchParams();

  // Deep links like /aufgaben?task=… (e.g. from notifications) open the task directly
  useEffect(() => {
    const t = params.get("task");
    if (t) {
      open({ kind: "task", id: t });
      params.delete("task");
      setParams(params, { replace: true });
    }
    const topic = params.get("thema");
    if (topic) {
      open({ kind: "topic", id: topic });
      params.delete("thema");
      setParams(params, { replace: true });
    }
  }, [params, open, setParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open({ kind: "palette" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-[100dvh]">
      <Rail />
      <div className="lg:pl-[248px]">
        <TopBar />
        <main className="mx-auto max-w-[1240px] overflow-x-clip px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-4 lg:px-8 lg:pb-12 lg:pt-6">
          <Suspense
            fallback={
              <div className="grid min-h-[40vh] place-items-center">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" aria-label={tr("Loading", "Lädt")} />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
      <BottomNav />
      {!stack.length && <Fab />}
      <TaskSheet />
      <TopicSheet />
      <MilestoneSheet />
      <NewsComposer />
      <ContactSheet />
      <OrgSheet />
      <ComposerSheet />
      <NotificationsSheet />
      <CommandPalette />
      <Assistant />
    </div>
  );
}
