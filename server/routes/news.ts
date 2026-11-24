import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Ctx, UserRow } from "../context.js";
import { audit, notify } from "../lib/audit.js";
import { body, forbidden, notFound, query, zMsg, zText } from "../lib/http.js";
import { applyNewsTemplate } from "../lib/news-template.js";
import { newId } from "../lib/util.js";
import { tr } from "../lib/i18n.js";

export const newsRoutes = new Hono<AppEnv>();

export const NEWS_CATEGORIES = ["allgemein", "fundraising", "produkt", "vertrieb", "regulatorik", "team"] as const;
export const REACTIONS = ["👍", "🎉", "💡", "🚀", "❤️"] as const;

interface NewsRow {
  id: string;
  author_id: string;
  title: string;
  body: string;
  category: string;
  pinned: number;
  created_at: number;
  updated_at: number;
  is_read: number;
  comment_count: number;
}

const select = `SELECT n.*,
  EXISTS(SELECT 1 FROM news_reads r WHERE r.news_id = n.id AND r.user_id = @me) AS is_read,
  (SELECT COUNT(*) FROM news_comments c WHERE c.news_id = n.id) AS comment_count
  FROM news n`;

function reactionsFor(c: Ctx, ids: string[], me: string) {
  const out = new Map<string, { emoji: string; count: number; mine: boolean; userIds: string[] }[]>();
  if (!ids.length) return out;
  const rows = c
    .get("deps")
    .db.prepare(`SELECT news_id, emoji, user_id FROM news_reactions WHERE news_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`)
    .all(...ids) as { news_id: string; emoji: string; user_id: string }[];
  for (const r of rows) {
    const list = out.get(r.news_id) ?? [];
    let e = list.find((x) => x.emoji === r.emoji);
    if (!e) {
      e = { emoji: r.emoji, count: 0, mine: false, userIds: [] };
      list.push(e);
    }
    e.count++;
    e.userIds.push(r.user_id);
    if (r.user_id === me) e.mine = true;
    out.set(r.news_id, list);
  }
  return out;
}

function mapNews(r: NewsRow, reactions: ReturnType<typeof reactionsFor>) {
  return {
    id: r.id,
    authorId: r.author_id,
    title: r.title,
    body: r.body,
    category: r.category,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    read: !!r.is_read,
    commentCount: r.comment_count,
    reactions: reactions.get(r.id) ?? [],
  };
}

function getNews(c: Ctx, id: string) {
  const me = c.get("user");
  const row = c.get("deps").db.prepare(`${select} WHERE n.id = @id`).get({ me: me.id, id }) as NewsRow | undefined;
  if (!row) throw notFound(tr("This post does not exist (anymore).", "Diesen Beitrag gibt es nicht (mehr)."));
  return row;
}

function canEdit(me: UserRow, row: { author_id: string }) {
  return me.role === "admin" || row.author_id === me.id;
}

newsRoutes.get("/", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const q = query(
    c,
    z.object({
      category: z.enum(NEWS_CATEGORIES).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      before: z.coerce.number().int().optional(),
      unread: z.enum(["1"]).optional(),
    }),
  );
  const where: string[] = [];
  if (q.category) where.push("n.category = @category");
  if (q.before) where.push("n.created_at < @before");
  if (q.unread) where.push("NOT EXISTS(SELECT 1 FROM news_reads r WHERE r.news_id = n.id AND r.user_id = @me)");
  const rows = db
    .prepare(
      `${select} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${q.before ? "" : "n.pinned DESC,"} n.created_at DESC LIMIT @limit`,
    )
    .all({ me: me.id, category: q.category, before: q.before, limit: q.limit ?? 30 }) as NewsRow[];
  const reactions = reactionsFor(c, rows.map((r) => r.id), me.id);
  const unread = (
    db.prepare("SELECT COUNT(*) AS n FROM news n WHERE NOT EXISTS(SELECT 1 FROM news_reads r WHERE r.news_id = n.id AND r.user_id = ?)").get(me.id) as {
      n: number;
    }
  ).n;
  return c.json({ items: rows.map((r) => mapNews(r, reactions)), unread });
});

/** Create the nalpia starter posts (preview with ?probe=1). No notifications, no duplicates. */
newsRoutes.post("/template", (c) => {
  const me = c.get("user");
  if (me.role !== "admin") throw forbidden(tr("Only admins can create the starter posts.", "Nur Admins können die Startbeiträge anlegen."));
  return c.json(applyNewsTemplate(c.get("deps").db, { actorId: me.id, dryRun: c.req.query("probe") === "1", ip: c.get("ip") }));
});

const input = z.object({
  title: zText(160).min(3, zMsg("Please enter a headline (at least 3 characters).", "Bitte gib eine Überschrift ein (mind. 3 Zeichen).")),
  body: zText(20000).min(1, zMsg("Please write some text.", "Bitte schreibe einen Text.")),
  category: z.enum(NEWS_CATEGORIES).optional(),
  pinned: z.boolean().optional(),
  notifyAll: z.boolean().optional(),
});

newsRoutes.post("/", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const p = await body(c, input);
  if (p.pinned && me.role !== "admin") throw forbidden(tr("Only admins can pin posts.", "Nur Admins können Beiträge anheften."));
  const id = newId();
  const now = Date.now();
  db.transaction(() => {
    db.prepare("INSERT INTO news (id, author_id, title, body, category, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      me.id,
      p.title,
      p.body,
      p.category ?? "allgemein",
      p.pinned ? 1 : 0,
      now,
      now,
    );
    db.prepare("INSERT INTO news_reads (news_id, user_id, read_at) VALUES (?, ?, ?)").run(id, me.id, now);
    if (p.notifyAll !== false) {
      const users = db.prepare("SELECT id FROM users WHERE status = 'active' AND id != ?").all(me.id) as { id: string }[];
      for (const u of users) notify(db, { userId: u.id, actorId: me.id, kind: "news.new", title: () => tr(`New post by ${me.name}: ${p.title}`, `Neuer Beitrag von ${me.name}: ${p.title}`), link: `/news/${id}` });
    }
  })();
  return c.json(mapNews(getNews(c, id), new Map()), 201);
});

newsRoutes.get("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = getNews(c, c.req.param("id"));
  db.prepare("INSERT OR IGNORE INTO news_reads (news_id, user_id, read_at) VALUES (?, ?, ?)").run(row.id, me.id, Date.now());
  const comments = db
    .prepare("SELECT id, user_id AS userId, body, created_at AS createdAt FROM news_comments WHERE news_id = ? ORDER BY created_at")
    .all(row.id);
  return c.json({ ...mapNews({ ...row, is_read: 1 }, reactionsFor(c, [row.id], me.id)), comments });
});

newsRoutes.patch("/:id", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = getNews(c, c.req.param("id"));
  if (!canEdit(me, row)) throw forbidden(tr("Only the author or admins can edit this post.", "Nur die Autorin/der Autor oder Admins können diesen Beitrag bearbeiten."));
  const p = await body(c, input.partial().omit({ notifyAll: true }));
  if (p.pinned !== undefined && me.role !== "admin") throw forbidden(tr("Only admins can pin posts.", "Nur Admins können Beiträge anheften."));
  db.prepare("UPDATE news SET title = ?, body = ?, category = ?, pinned = ?, updated_at = ? WHERE id = ?").run(
    p.title ?? row.title,
    p.body ?? row.body,
    p.category ?? row.category,
    p.pinned === undefined ? row.pinned : p.pinned ? 1 : 0,
    Date.now(),
    row.id,
  );
  return c.json(mapNews(getNews(c, row.id), reactionsFor(c, [row.id], me.id)));
});

newsRoutes.delete("/:id", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = getNews(c, c.req.param("id"));
  if (!canEdit(me, row)) throw forbidden();
  db.prepare("DELETE FROM news WHERE id = ?").run(row.id);
  audit(db, { userId: me.id, action: "news.deleted", target: row.id, ip: c.get("ip"), meta: { title: row.title } });
  return c.json({ ok: true });
});

newsRoutes.post("/read-all", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  db.prepare("INSERT OR IGNORE INTO news_reads (news_id, user_id, read_at) SELECT id, ?, ? FROM news").run(me.id, Date.now());
  return c.json({ ok: true });
});

newsRoutes.post("/:id/reactions", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = getNews(c, c.req.param("id"));
  const p = await body(c, z.object({ emoji: z.enum(REACTIONS) }));
  const exists = db.prepare("SELECT 1 FROM news_reactions WHERE news_id = ? AND user_id = ? AND emoji = ?").get(row.id, me.id, p.emoji);
  if (exists) db.prepare("DELETE FROM news_reactions WHERE news_id = ? AND user_id = ? AND emoji = ?").run(row.id, me.id, p.emoji);
  else db.prepare("INSERT INTO news_reactions (news_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)").run(row.id, me.id, p.emoji, Date.now());
  return c.json({ reactions: reactionsFor(c, [row.id], me.id).get(row.id) ?? [] });
});

newsRoutes.post("/:id/comments", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const row = getNews(c, c.req.param("id"));
  const p = await body(c, z.object({ body: zText(4000).min(1, zMsg("Please write a comment.", "Bitte schreibe einen Kommentar.")) }));
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO news_comments (id, news_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)").run(id, row.id, me.id, p.body, now);
  notify(db, { userId: row.author_id, actorId: me.id, kind: "news.comment", title: () => tr(`${me.name} commented on “${row.title}”`, `${me.name} hat „${row.title}“ kommentiert`), link: `/news/${row.id}` });
  return c.json({ id, userId: me.id, body: p.body, createdAt: now }, 201);
});

newsRoutes.delete("/:id/comments/:cid", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  const r = db.prepare("SELECT user_id FROM news_comments WHERE id = ? AND news_id = ?").get(c.req.param("cid"), c.req.param("id")) as
    | { user_id: string }
    | undefined;
  if (!r) throw notFound();
  if (r.user_id !== me.id && me.role !== "admin") throw forbidden();
  db.prepare("DELETE FROM news_comments WHERE id = ?").run(c.req.param("cid"));
  return c.json({ ok: true });
});
