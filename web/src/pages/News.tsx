import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, MessageSquare, MoreHorizontal, Newspaper, Pencil, Pin, Plus, Search, Send, SmilePlus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { plainText } from "@/lib/text";
import { Avatar, Button, cx, EmptyState, IconButton, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, NEWS_CATEGORIES, relTime } from "@/lib/format";
import { useOverlays } from "@/lib/overlays";
import { useMe, useNews, useNewsItem, useUserMap } from "@/lib/queries";
import type { NewsItem, Reaction } from "@/lib/types";
import { locale, tr } from "@/lib/i18n";
import { Tx, TxPlain } from "@/lib/translate";
import { TxMarkdown } from "@/components/TxMarkdown";

const EMOJIS = ["👍", "🎉", "💡", "🚀", "❤️"];

function Reactions({ item }: { item: NewsItem }) {
  const qc = useQueryClient();
  const users = useUserMap();
  const [list, setList] = useState<Reaction[]>(item.reactions);
  const [picker, setPicker] = useState(false);
  async function toggle(emoji: string) {
    setPicker(false);
    const prev = list;
    const has = list.find((r) => r.emoji === emoji);
    const optimistic = has
      ? list.map((r) => (r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r)).filter((r) => r.count > 0)
      : [...list, { emoji, count: 1, mine: true, userIds: [] }];
    setList(optimistic);
    try {
      const r = await api.post<{ reactions: Reaction[] }>(`/api/news/${item.id}/reactions`, { emoji });
      setList(r.reactions);
      qc.invalidateQueries({ queryKey: ["news"] });
    } catch (e) {
      setList(prev);
      toast.error((e as Error).message);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {list.map((r) => (
        <button
          key={r.emoji}
          onClick={() => toggle(r.emoji)}
          title={r.userIds.map((id) => users.get(id)?.name ?? "").filter(Boolean).join(", ")}
          className={cx("inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[13px] transition", r.mine ? "border-info/50 bg-info-soft" : "border-line bg-surface hover:bg-surface2")}
        >
          <span>{r.emoji}</span>
          <span className="num text-[12px] font-semibold">{r.count}</span>
        </button>
      ))}
      <div className="relative">
        <IconButton label={tr("Add reaction", "Reaktion hinzufügen")} size="sm" onClick={() => setPicker((v) => !v)} className="text-muted">
          <SmilePlus className="h-[18px] w-[18px]" />
        </IconButton>
        {picker && (
          <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-full border border-line bg-surface p-1 shadow-pop animate-pop-in">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => toggle(e)} className="grid h-9 w-9 place-items-center rounded-full text-[18px] transition hover:scale-110 hover:bg-surface2" aria-label={tr(`React with ${e}`, `Reagieren mit ${e}`)}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact reaction summary for the list (reacting happens inside the post) */
function ReactionSummary({ item }: { item: NewsItem }) {
  if (!item.reactions.length) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-muted" aria-label={tr(`${item.reactions.reduce((a, r) => a + r.count, 0)} reactions`, `${item.reactions.reduce((a, r) => a + r.count, 0)} Reaktionen`)}>
      {item.reactions.slice(0, 3).map((r) => (
        <span key={r.emoji}>{r.emoji}</span>
      ))}
      <span className="num font-semibold">{item.reactions.reduce((a, r) => a + r.count, 0)}</span>
    </span>
  );
}

function CategoryTag({ category, className }: { category: string; className?: string }) {
  const c = NEWS_CATEGORIES[category];
  return <span className={cx("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11.5px] font-bold", c?.tone, className)}>{c?.label ?? category}</span>;
}

const monthKey = (ms: number) => new Date(ms).toLocaleDateString(locale(), { month: "long", year: "numeric", timeZone: "Europe/Berlin" });
const dayParts = (ms: number) => {
  const d = new Date(ms);
  return {
    day: d.toLocaleDateString(locale(), { day: "numeric", timeZone: "Europe/Berlin" }).replace(".", ""),
    wd: d.toLocaleDateString(locale(), { weekday: "short", timeZone: "Europe/Berlin" }).replace(".", ""),
  };
};

export function NewsPage() {
  const me = useMe().data?.user;
  const [seeding, setSeeding] = useState(false);
  const [cat, setCat] = useState<string | undefined>();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [q, setQ] = useState("");
  const { data, isLoading } = useNews();
  const users = useUserMap();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const qc = useQueryClient();
  async function seed() {
    setSeeding(true);
    try {
      const r = await api.post<{ created: string[] }>("/api/news/template");
      toast.success(r.created.length === 1 ? tr("1 post created", "1 Beitrag angelegt") : tr(`${r.created.length} posts created`, `${r.created.length} Beiträge angelegt`));
      qc.invalidateQueries({ queryKey: ["news"] });
      qc.invalidateQueries({ queryKey: ["home"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSeeding(false);
    }
  }
  async function readAll() {
    await api.post("/api/news/read-all");
    qc.invalidateQueries({ queryKey: ["news"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  }

  const all = data?.items ?? [];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of all) m.set(n.category, (m.get(n.category) ?? 0) + 1);
    return m;
  }, [all]);
  const needle = q.trim().toLocaleLowerCase();
  const visible = all.filter(
    (n) =>
      (!cat || n.category === cat) &&
      (!onlyUnread || !n.read) &&
      (!needle || n.title.toLocaleLowerCase().includes(needle) || plainText(n.body).toLocaleLowerCase().includes(needle)),
  );
  const filtering = !!cat || onlyUnread || !!needle;
  // Pinned posts get their own strip on top – only in the unfiltered view, otherwise they stay in the feed
  const pinned = filtering ? [] : visible.filter((n) => n.pinned);
  const feed = filtering ? visible : visible.filter((n) => !n.pinned);
  const groups = useMemo(() => {
    const out: { month: string; items: NewsItem[] }[] = [];
    for (const n of [...feed].sort((a, b) => b.createdAt - a.createdAt)) {
      const m = monthKey(n.createdAt);
      const g = out.at(-1);
      if (g?.month === m) g.items.push(n);
      else out.push({ month: m, items: [n] });
    }
    return out;
  }, [feed]);

  const chip = (active: boolean) =>
    cx(
      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition",
      active ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-muted hover:text-ink",
    );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.025em]">News</h1>
          <p className="text-[14px] text-muted">
            {tr("What's happening at the company", "Was im Unternehmen passiert")}
            {all.length > 0 && (
              <>
                {" "}
                – {all.length} {all.length === 1 ? tr("post", "Beitrag") : tr("posts", "Beiträge")}
                {data?.unread ? tr(`, ${data.unread} unread`, `, ${data.unread} ungelesen`) : ""}
              </>
            )}
            .
          </p>
        </div>
        <div className="flex gap-2">
          {!!data?.unread && (
            <Button variant="ghost" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={readAll}>
              {tr("Mark all as read", "Alle gelesen")}
            </Button>
          )}
          <Button variant="primary" className="hidden sm:inline-flex" icon={<Plus className="h-4 w-4" />} onClick={() => open({ kind: "news" })}>
            {tr("Write post", "Beitrag schreiben")}
          </Button>
        </div>
      </header>

      {all.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
          <label className="relative block shrink-0 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="field h-10 pl-9 text-[14px]" placeholder={tr("Search news", "In News suchen")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("Search news", "In News suchen")} />
          </label>
          <div className="scrollbar-none -mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <button className={chip(!cat)} onClick={() => setCat(undefined)}>
              {tr("All", "Alle")}
            </button>
            {Object.entries(NEWS_CATEGORIES)
              .filter(([k]) => counts.get(k))
              .map(([k, c]) => (
                <button key={k} className={chip(cat === k)} onClick={() => setCat(cat === k ? undefined : k)} aria-pressed={cat === k}>
                  {c.label}
                  <span className="num text-[11.5px] opacity-70">{counts.get(k)}</span>
                </button>
              ))}
            {!!data?.unread && (
              <button className={chip(onlyUnread)} onClick={() => setOnlyUnread((v) => !v)} aria-pressed={onlyUnread}>
                <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
                {tr("Unread", "Ungelesen")}
                <span className="num text-[11.5px] opacity-70">{data.unread}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      ) : !all.length ? (
        <EmptyState
          icon={<Newspaper className="h-5 w-5" />}
          title={tr("No posts yet", "Noch keine Beiträge")}
          text={tr("Share results, events and decisions with the team.", "Teile Ergebnisse, Termine und Entscheidungen mit dem Team.")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => open({ kind: "news" })}>
                {tr("Write the first post", "Ersten Beitrag schreiben")}
              </Button>
              {me?.role === "admin" && (
                <Button variant="secondary" loading={seeding} onClick={seed}>
                  {tr("Create nalpia starter posts", "nalpia-Startbeiträge anlegen")}
                </Button>
              )}
            </div>
          }
        />
      ) : !visible.length ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title={tr("No matching posts", "Keine passenden Beiträge")}
          text={tr("Change your search or filters.", "Ändere Suche oder Filter.")}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setCat(undefined);
                setOnlyUnread(false);
                setQ("");
              }}
            >
              {tr("Reset filters", "Filter zurücksetzen")}
            </Button>
          }
        />
      ) : (
        <>
          {pinned.length > 0 && (
            <section aria-labelledby="news-pinned">
              <h2 id="news-pinned" className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-muted">
                <Pin className="h-3.5 w-3.5 text-accent" />
                {tr("Pinned", "Angeheftet")}
              </h2>
              <div className={cx("grid gap-3", pinned.length > 1 && "sm:grid-cols-2")}>
                {pinned.map((n) => (
                  <Link
                    key={n.id}
                    to={`/news/${n.id}`}
                    className="card group flex flex-col gap-2 border-accent/30 bg-accent-soft/40 p-4 transition hover:border-accent/60 sm:p-5"
                  >
                    <div className="flex items-center gap-2">
                      <CategoryTag category={n.category} />
                      {!n.read && <span className="h-2 w-2 rounded-full bg-accent" aria-label={tr("Unread", "Ungelesen")} />}
                      <span className="ml-auto text-[12px] text-muted">{relTime(n.createdAt)}</span>
                    </div>
                    <h3 className="text-[17px] font-extrabold leading-snug tracking-[-0.015em] group-hover:underline"><Tx text={n.title} /></h3>
                    <p className="line-clamp-2 text-[14px] leading-relaxed text-muted"><TxPlain text={n.body} /></p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {groups.map((g) => (
            <section key={g.month} aria-label={g.month}>
              <h2 className="mb-2 flex items-baseline gap-2 text-[13px] font-bold text-muted">
                {g.month}
                <span className="num font-semibold opacity-70">{g.items.length}</span>
              </h2>
              <ul className="card divide-y divide-line overflow-hidden">
                {g.items.map((n) => {
                  const a = users.get(n.authorId);
                  const d = dayParts(n.createdAt);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/news/${n.id}`)}
                        className="flex w-full items-start gap-3 px-3 py-3.5 text-left transition hover:bg-surface2/60 sm:gap-4 sm:px-4"
                      >
                        <span className="flex w-10 shrink-0 flex-col items-center pt-0.5 leading-none" aria-hidden>
                          <span className="num text-[18px] font-bold">{d.day}</span>
                          <span className="mt-1 text-[11px] font-semibold text-muted">{d.wd}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <CategoryTag category={n.category} />
                            {n.pinned && <Pin className="h-3.5 w-3.5 text-accent" aria-label={tr("Pinned", "Angeheftet")} />}
                            {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={tr("Unread", "Ungelesen")} />}
                          </span>
                          <span className={cx("mt-1 block text-[15.5px] leading-snug", n.read ? "font-semibold" : "font-extrabold")}><Tx text={n.title} /></span>
                          <span className="mt-0.5 line-clamp-1 text-[13.5px] text-muted sm:line-clamp-2"><TxPlain text={n.body} /></span>
                        </span>
                        <span className="hidden shrink-0 flex-col items-end gap-1.5 pt-0.5 sm:flex">
                          <span className="text-[12.5px] text-muted">{a?.name ?? tr("Former member", "Ehemalig")}</span>
                          <span className="flex items-center gap-3">
                            <ReactionSummary item={n} />
                            {n.commentCount > 0 && (
                              <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                                <MessageSquare className="h-3.5 w-3.5" />
                                <span className="num font-semibold">{n.commentCount}</span>
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

export function NewsDetailPage() {
  const { id } = useParams();
  const { data: n, isLoading, error } = useNewsItem(id);
  const users = useUserMap();
  const me = useMe().data?.user;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { open } = useOverlays();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (error || !n) return <EmptyState title={tr("Post not found", "Beitrag nicht gefunden")} text={(error as Error)?.message} action={<Link to="/news" className="link">{tr("Back to News", "Zu den News")}</Link>} />;
  const a = users.get(n.authorId);
  const canEdit = me && (me.role === "admin" || me.id === n.authorId);

  async function send() {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/news/${n!.id}/comments`, { body: comment.trim() });
      setComment("");
      qc.invalidateQueries({ queryKey: ["news-item", n!.id] });
      qc.invalidateQueries({ queryKey: ["news"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(tr("Delete this post?", "Beitrag wirklich löschen?"))) return;
    await api.del(`/api/news/${n!.id}`);
    qc.invalidateQueries({ queryKey: ["news"] });
    qc.invalidateQueries({ queryKey: ["home"] });
    toast(tr("Post deleted", "Beitrag gelöscht"));
    navigate("/news");
  }
  async function togglePin() {
    await api.patch(`/api/news/${n!.id}`, { pinned: !n!.pinned });
    qc.invalidateQueries({ queryKey: ["news-item", n!.id] });
    qc.invalidateQueries({ queryKey: ["news"] });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/news" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> News
      </Link>
      <article className="card p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <Avatar name={a?.name ?? "?"} color={a?.avatarColor} src={a?.avatarUrl} size={40} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{a?.name ?? tr("Former member", "Ehemalig")}</p>
            <p className="text-[13px] text-muted">
              {dateTime(n.createdAt)}
              {n.updatedAt - n.createdAt > 60_000 && tr(", edited", ", bearbeitet")}
            </p>
          </div>
          {canEdit && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label={tr("Options", "Optionen")}>
                  <MoreHorizontal className="h-5 w-5" />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" className="z-50 min-w-[180px] rounded-xl border border-line bg-surface p-1.5 shadow-pop">
                  <DropdownMenu.Item onSelect={() => open({ kind: "news", id: n.id })} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface2">
                    <Pencil className="h-4 w-4 text-muted" /> {tr("Edit", "Bearbeiten")}
                  </DropdownMenu.Item>
                  {me?.role === "admin" && (
                    <DropdownMenu.Item onSelect={togglePin} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface2">
                      <Pin className="h-4 w-4 text-muted" /> {n.pinned ? tr("Unpin", "Nicht mehr anheften") : tr("Pin to top", "Oben anheften")}
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item onSelect={remove} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neg outline-none data-[highlighted]:bg-neg-soft">
                    <Trash2 className="h-4 w-4" /> {tr("Delete", "Löschen")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
        <div className="mt-5 flex items-center gap-2">
          <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", NEWS_CATEGORIES[n.category]?.tone)}>{NEWS_CATEGORIES[n.category]?.label}</span>
          {n.pinned && (
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent-ink">
              <Pin className="h-3.5 w-3.5" /> {tr("Pinned", "Angeheftet")}
            </span>
          )}
        </div>
        <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[30px]"><Tx text={n.title} /></h1>
        <TxMarkdown className="mt-4 max-w-[68ch] text-[16px]" text={n.body} />
        <div className="mt-6 border-t border-line pt-4">
          <Reactions item={n} />
        </div>
      </article>
      <section className="card p-4 sm:p-5">
        <h2 className="section-title">
          {tr("Comments", "Kommentare")} <span className="num text-muted">{n.comments.length}</span>
        </h2>
        <div className="mt-3 space-y-3">
          {n.comments.map((c) => {
            const u = c.userId ? users.get(c.userId) : undefined;
            return (
              <div key={c.id} className="flex gap-2.5">
                <Avatar name={u?.name ?? "?"} color={u?.avatarColor} src={u?.avatarUrl} size={30} />
                <div className="min-w-0 flex-1 rounded-xl bg-surface2/70 px-3 py-2">
                  <p className="text-[12.5px]">
                    <b>{u?.name ?? tr("Former member", "Ehemalig")}</b> <span className="text-muted">{relTime(c.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[14.5px]"><Tx text={c.body} /></p>
                </div>
              </div>
            );
          })}
          <div className="flex items-end gap-2 pt-1">
            <textarea
              rows={1}
              className="field min-h-[44px] flex-1 resize-none"
              placeholder={tr("Add a comment …", "Kommentieren …")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              }}
              aria-label={tr("Comment", "Kommentar")}
            />
            <Button variant="primary" onClick={send} loading={busy} disabled={!comment.trim()} icon={<Send className="h-4 w-4" />} aria-label={tr("Send comment", "Kommentar senden")} />
          </div>
        </div>
      </section>
    </div>
  );
}
