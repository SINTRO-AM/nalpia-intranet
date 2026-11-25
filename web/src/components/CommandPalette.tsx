import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Building2,
  CheckSquare,
  Flag,
  Home,
  Inbox,
  Handshake,
  Kanban,
  Bot,
  Megaphone,
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
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, qs } from "@/lib/api";
import { CONTACT_CATEGORIES, dueInfo, orgHref, TOPIC_KIND, TOPIC_STAGE } from "@/lib/format";
import type { OrgKind } from "@/lib/types";
import { useOverlay, useOverlays } from "@/lib/overlays";
import { useMe } from "@/lib/queries";
import type { User } from "@/lib/types";
import { Avatar } from "./ui";
import { tr } from "@/lib/i18n";
import { Tx } from "@/lib/translate";

interface SearchResult {
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  news: { id: string; title: string; category: string }[];
  contacts: { id: string; name: string; company: string; category: string; email: string }[];
  milestones: { id: string; title: string; dueDate: string | null; status: string }[];
  people: User[];
  orgs: { id: string; name: string; kind: OrgKind; type: string; stage: string; city: string }[];
  topics?: { id: string; title: string; kind: string; stage: string; area: string; counterpart: string }[];
}

export function CommandPalette() {
  const o = useOverlay("palette");
  const { open, close } = useOverlays();
  const navigate = useNavigate();
  const me = useMe().data?.user;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!o) setQ("");
  }, [o]);

  const search = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchResult>(`/api/search${qs({ q: debounced })}`),
    enabled: debounced.length >= 2,
  });

  const go = (fn: () => void) => {
    close("palette");
    setTimeout(fn, 10);
  };

  const actions: { label: string; icon: LucideIcon; run: () => void; kw: string }[] = [
    { label: tr("New task", "Neue Aufgabe"), icon: Plus, run: () => open({ kind: "task" }), kw: "task todo new to-do aufgabe neu" },
    { label: tr("New topic", "Neues Thema"), icon: Kanban, run: () => open({ kind: "topic" }), kw: "topic project matter pipeline thema projekt vorgang intern extern" },
    { label: tr("Write a new post", "Neuen Beitrag schreiben"), icon: Megaphone, run: () => open({ kind: "news" }), kw: "news post update announcement beitrag neuigkeit" },
    { label: tr("New e-mail", "Neue E-Mail"), icon: Inbox, run: () => open({ kind: "compose", defaults: {} }), kw: "mail email write compose schreiben" },
    { label: tr("Add a new contact", "Neuen Kontakt anlegen"), icon: UserPlus, run: () => open({ kind: "contact" }), kw: "contact crm investor partner person kontakt" },
    { label: tr("New milestone", "Neuer Meilenstein"), icon: Flag, run: () => open({ kind: "milestone" }), kw: "milestone goal target meilenstein ziel" },
    { label: tr("New partner", "Neuer Partner"), icon: Handshake, run: () => open({ kind: "org", orgKind: "partner" }), kw: "partner broker exchange data provider accelerator service program" },
    { label: tr("New investor", "Neuer Investor"), icon: Building2, run: () => open({ kind: "org", orgKind: "investor" }), kw: "investor vc angel business angel fundraising" },
  ];
  const nav: { label: string; icon: LucideIcon; to: string }[] = [
    { label: tr("Home", "Start"), icon: Home, to: "/" },
    { label: "News", icon: Newspaper, to: "/news" },
    { label: tr("Tasks", "Aufgaben"), icon: CheckSquare, to: "/aufgaben" },
    { label: tr("Task board", "Aufgaben-Board"), icon: CheckSquare, to: "/aufgaben?ansicht=board" },
    { label: tr("Topics", "Themen"), icon: Kanban, to: "/themen" },
    { label: tr("Milestones", "Meilensteine"), icon: Flag, to: "/aufgaben?ansicht=meilensteine" },
    { label: tr("Mail", "Postfach"), icon: Inbox, to: "/postfach" },
    { label: tr("Partners", "Partner"), icon: Handshake, to: "/partner" },
    { label: tr("Fundraising agent", "Fundraising-Agent"), icon: Bot, to: "/agent" },
    { label: tr("Investors", "Investoren"), icon: Building2, to: "/investoren" },
    { label: tr("Contacts", "Kontakte"), icon: UsersRound, to: "/kontakte" },
    { label: "Team", icon: Users, to: "/team" },
    { label: tr("Settings", "Einstellungen"), icon: Settings, to: "/einstellungen" },
    ...(me?.role === "admin" ? [{ label: tr("Admin", "Verwaltung"), icon: Shield, to: "/admin" }] : []),
  ];
  const ql = q.trim().toLowerCase();
  const fa = actions.filter((a) => !ql || (a.label + " " + a.kw).toLowerCase().includes(ql));
  const fn = nav.filter((n) => !ql || n.label.toLowerCase().includes(ql));
  const r = debounced.length >= 2 ? search.data : undefined;

  // When search results arrive, move the selection to the first hit –
  // otherwise Enter would trigger the previously highlighted action ("New …").
  const [selected, setSelected] = useState("");
  const firstHit = r
    ? r.people[0]
      ? `p-${r.people[0].id}`
      : r.orgs?.[0]
        ? `o-${r.orgs[0].id}`
        : r.topics?.[0]
          ? `tp-${r.topics[0].id}`
        : r.tasks[0]
          ? `t-${r.tasks[0].id}`
          : r.contacts[0]
            ? `c-${r.contacts[0].id}`
            : r.milestones[0]
              ? `m-${r.milestones[0].id}`
              : r.news[0]
                ? `n-${r.news[0].id}`
                : ""
    : "";
  useEffect(() => {
    if (firstHit) setSelected(firstHit);
  }, [firstHit]);

  const item = "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] aria-selected:bg-surface2";
  const group = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted";

  return (
    <Dialog.Root open={!!o} onOpenChange={(v) => !v && close("palette")}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[#05224B]/35 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-[60] mx-auto flex max-h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-pop outline-none data-[state=open]:animate-pop-in sm:top-[10vh] sm:max-h-[70vh] sm:w-[min(640px,calc(100vw-32px))] sm:rounded-2xl sm:border sm:border-line"
        >
          <Dialog.Title className="sr-only">{tr("Search and commands", "Suchen und Befehle")}</Dialog.Title>
          <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col" loop value={selected} onValueChange={setSelected}>
            <div className="safe-top flex items-center gap-2 border-b border-line px-4">
              <Search className="h-5 w-5 shrink-0 text-muted" />
              <Command.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder={tr("Search tasks, topics, investors, people …", "Suchen: Aufgaben, Themen, Investoren, Personen …")}
                className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted/70"
              />
              <button className="text-sm font-semibold text-muted sm:hidden" onClick={() => close("palette")}>
                {tr("Close", "Schließen")}
              </button>
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">{search.isFetching ? tr("Searching …", "Suche läuft …") : tr("No results.", "Keine Treffer.")}</Command.Empty>
              {r && r.people.length > 0 && (
                <Command.Group heading={tr("People", "Personen")} className={group}>
                  {r.people.map((p) => (
                    <Command.Item key={p.id} value={`p-${p.id}`} className={item} onSelect={() => go(() => navigate(`/team/${p.id}`))}>
                      <Avatar name={p.name} color={p.avatarColor} src={p.avatarUrl} size={26} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="truncate text-[13px] text-muted"><Tx text={p.title} /></span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r && r.orgs?.length > 0 && (
                <Command.Group heading={tr("Organizations", "Institutionen")} className={group}>
                  {r.orgs.map((o) => {
                    const I = o.kind === "investor" ? Building2 : Handshake;
                    return (
                      <Command.Item key={o.id} value={`o-${o.id}`} className={item} onSelect={() => go(() => navigate(orgHref(o.kind, o.id)))}>
                        <I className="h-4 w-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate">
                          {o.name}
                          {o.city && <span className="text-muted">, {o.city}</span>}
                        </span>
                        <span className="text-[12.5px] text-muted">{o.kind === "investor" ? "Investor" : "Partner"}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}
              {r && (r.topics?.length ?? 0) > 0 && (
                <Command.Group heading={tr("Topics", "Themen")} className={group}>
                  {r.topics!.map((t) => (
                    <Command.Item key={t.id} value={`tp-${t.id}`} className={item} onSelect={() => go(() => open({ kind: "topic", id: t.id }))}>
                      <Kanban className="h-4 w-4 shrink-0 text-muted" />
                      <span className={`min-w-0 flex-1 truncate ${t.stage === "erledigt" || t.stage === "verworfen" ? "text-muted" : ""}`}>
                        <Tx text={t.title} />
                        {t.counterpart && <span className="text-muted"> – {t.counterpart}</span>}
                      </span>
                      <span className="text-[12.5px] text-muted">{TOPIC_KIND[t.kind]?.label} · {TOPIC_STAGE[t.stage]?.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r && r.tasks.length > 0 && (
                <Command.Group heading={tr("Tasks", "Aufgaben")} className={group}>
                  {r.tasks.map((t) => (
                    <Command.Item key={t.id} value={`t-${t.id}`} className={item} onSelect={() => go(() => open({ kind: "task", id: t.id }))}>
                      <CheckSquare className="h-4 w-4 shrink-0 text-muted" />
                      <span className={`min-w-0 flex-1 truncate ${t.status === "erledigt" ? "text-muted line-through" : ""}`}><Tx text={t.title} /></span>
                      {t.dueDate && <span className="text-[12.5px] text-muted">{dueInfo(t.dueDate).label}</span>}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r && r.contacts.length > 0 && (
                <Command.Group heading={tr("Contacts", "Kontakte")} className={group}>
                  {r.contacts.map((c) => (
                    <Command.Item key={c.id} value={`c-${c.id}`} className={item} onSelect={() => go(() => navigate(`/kontakte/${c.id}`))}>
                      <UsersRound className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        {c.name}
                        {c.company && <span className="text-muted"> – {c.company}</span>}
                      </span>
                      <span className="text-[12.5px] text-muted">{CONTACT_CATEGORIES[c.category]?.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r && r.milestones.length > 0 && (
                <Command.Group heading={tr("Milestones", "Meilensteine")} className={group}>
                  {r.milestones.map((m) => (
                    <Command.Item key={m.id} value={`m-${m.id}`} className={item} onSelect={() => go(() => navigate(`/aufgaben/meilensteine/${m.id}`))}>
                      <Flag className="h-4 w-4 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate"><Tx text={m.title} /></span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {r && r.news.length > 0 && (
                <Command.Group heading="News" className={group}>
                  {r.news.map((n) => (
                    <Command.Item key={n.id} value={`n-${n.id}`} className={item} onSelect={() => go(() => navigate(`/news/${n.id}`))}>
                      <Newspaper className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate"><Tx text={n.title} /></span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {fa.length > 0 && (
                <Command.Group heading={tr("New", "Neu")} className={group}>
                  {fa.map((a) => (
                    <Command.Item key={a.label} value={a.label} className={item} onSelect={() => go(a.run)}>
                      <a.icon className="h-4 w-4 shrink-0 text-muted" />
                      {a.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {fn.length > 0 && (
                <Command.Group heading={tr("Go to", "Gehe zu")} className={group}>
                  {fn.map((n) => (
                    <Command.Item key={n.to} value={`nav-${n.to}`} className={item} onSelect={() => go(() => navigate(n.to))}>
                      <n.icon className="h-4 w-4 shrink-0 text-muted" />
                      {n.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
