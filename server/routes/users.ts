import { Hono } from "hono";
import { z } from "zod";
import { toPublicUser, toSelfUser, userPrefs, type AppEnv, type UserRow } from "../context.js";
import { deleteAvatar, readAvatarUpload, saveAvatar } from "../lib/avatar.js";
import { safeUrl } from "../lib/crm-import.js";
import { body, notFound, zMsg, zText } from "../lib/http.js";
import { taskSelect, mapTask, type TaskRow } from "./tasks.js";
import { milestoneSelect, mapMilestone, type MilestoneRow } from "./milestones.js";
import { tr } from "../lib/i18n.js";

export const userRoutes = new Hono<AppEnv>();

export const AVATAR_COLORS = ["navy", "gold", "teal", "plum", "rust", "slate", "moss", "sky"] as const;

userRoutes.get("/users", (c) => {
  const { db } = c.get("deps");
  const rows = db
    // Invited users already belong to the team (org chart, ownership), even before their first sign-in
    .prepare("SELECT * FROM users WHERE status IN ('active', 'invited') ORDER BY sort_order, name COLLATE NOCASE")
    .all() as UserRow[];
  const counts = new Map(
    (
      db
        .prepare("SELECT assignee_id AS id, COUNT(*) AS n FROM tasks WHERE status != 'erledigt' AND assignee_id IS NOT NULL GROUP BY assignee_id")
        .all() as { id: string; n: number }[]
    ).map((r) => [r.id, r.n]),
  );
  return c.json(rows.map((u) => ({ ...toPublicUser(u), openTasks: counts.get(u.id) ?? 0 })));
});

userRoutes.get("/users/:id", (c) => {
  const { db } = c.get("deps");
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND status != 'disabled'").get(c.req.param("id")) as UserRow | undefined;
  if (!u) throw notFound(tr("This person does not exist (anymore).", "Diese Person gibt es nicht (mehr)."));
  const tasks = (db.prepare(`${taskSelect} WHERE t.assignee_id = ? AND t.status != 'erledigt' ORDER BY t.due_date IS NULL, t.due_date, t.created_at`).all(u.id) as TaskRow[]).map(mapTask);
  const milestones = (db.prepare(`${milestoneSelect} WHERE m.owner_id = ? AND m.status != 'erreicht' GROUP BY m.id ORDER BY m.due_date IS NULL, m.due_date`).all(u.id) as MilestoneRow[]).map(mapMilestone);
  const contacts = (db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE owner_id = ?").get(u.id) as { n: number }).n;
  return c.json({ user: toPublicUser(u), tasks, milestones, contacts });
});

/** Serve the profile photo. The URL contains the version (?v=…), so the browser may cache it for long. */
userRoutes.get("/users/:id/avatar", (c) => {
  const { db } = c.get("deps");
  const row = db.prepare("SELECT mime, data FROM user_avatars WHERE user_id = ?").get(c.req.param("id")) as { mime: string; data: Buffer } | undefined;
  if (!row) throw notFound();
  c.header("content-type", row.mime);
  c.header("cache-control", "private, max-age=31536000, immutable");
  c.header("x-content-type-options", "nosniff");
  c.header("content-security-policy", "default-src 'none'; sandbox");
  return c.body(new Uint8Array(row.data));
});

userRoutes.put("/me/avatar", async (c) => {
  const { db } = c.get("deps");
  const user = c.get("user");
  const img = await readAvatarUpload(c);
  saveAvatar(db, user.id, img);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow;
  return c.json(toSelfUser(fresh));
});

userRoutes.delete("/me/avatar", (c) => {
  const { db } = c.get("deps");
  const user = c.get("user");
  deleteAvatar(db, user.id);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow;
  return c.json(toSelfUser(fresh));
});

const profileSchema = z.object({
  name: zText(80).min(2, zMsg("Please enter your name.", "Bitte gib deinen Namen an.")).optional(),
  title: zText(80).optional(),
  phone: zText(40).optional(),
  location: zText(60).optional(),
  responsibilities: z.array(zText(60).min(1)).max(12).optional(),
  avatarColor: z.enum(AVATAR_COLORS).optional(),
  bio: zText(1500).optional(),
  linkedin: z.string().max(300).optional(),
});

userRoutes.patch("/me", async (c) => {
  const { db } = c.get("deps");
  const user = c.get("user");
  const p = await body(c, profileSchema);
  const next = {
    name: p.name ?? user.name,
    title: p.title ?? user.title,
    phone: p.phone ?? user.phone,
    location: p.location ?? user.location,
    responsibilities: p.responsibilities ? JSON.stringify(p.responsibilities) : user.responsibilities,
    avatar_color: p.avatarColor ?? user.avatar_color,
    bio: p.bio ?? user.bio,
    linkedin: p.linkedin === undefined ? user.linkedin : safeUrl(p.linkedin),
  };
  db.prepare(
    "UPDATE users SET name = ?, title = ?, phone = ?, location = ?, responsibilities = ?, avatar_color = ?, bio = ?, linkedin = ?, updated_at = ? WHERE id = ?",
  ).run(next.name, next.title, next.phone, next.location, next.responsibilities, next.avatar_color, next.bio, next.linkedin, Date.now(), user.id);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow;
  return c.json(toSelfUser(fresh));
});

const prefsSchema = z.object({
  signature: zText(2000).optional(),
  aiStyle: zText(1500).optional(),
  salutation: z.enum(["du", "sie", "auto"]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  fromAddress: z.string().trim().toLowerCase().max(254).optional(),
  autoSuggest: z.boolean().optional(),
  assistant: z.boolean().optional(),
  lang: z.enum(["en", "de"]).optional(),
});

userRoutes.patch("/me/prefs", async (c) => {
  const { db } = c.get("deps");
  const user = c.get("user");
  const p = await body(c, prefsSchema);
  const merged = { ...userPrefs(user), ...p };
  db.prepare("UPDATE users SET prefs = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(merged), Date.now(), user.id);
  return c.json(merged);
});
