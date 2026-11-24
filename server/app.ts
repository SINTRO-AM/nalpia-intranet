import { Hono, type MiddlewareHandler } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import { clientIp, type AppEnv, type Deps } from "./context.js";
import { csrfGuard, loadSession, requireAdmin, requireUser } from "./auth/middleware.js";
import { authRoutes } from "./auth/routes.js";
import { getSetting } from "./db/index.js";
import { HttpError } from "./lib/http.js";
import { MailError } from "./mail/types.js";
import { mailRoutes } from "./mail/routes.js";
import { parseLang, runWithLang, tr } from "./lib/i18n.js";
import { aiRoutes } from "./ai/routes.js";
import { assistantRoutes } from "./ai/assistant.js";
import { calendarRoutes } from "./calendar/routes.js";
import { adminRoutes } from "./routes/admin.js";
import { agentRoutes } from "./agent/routes.js";
import { contactRoutes } from "./routes/contacts.js";
import { orgRoutes } from "./routes/orgs.js";
import { milestoneRoutes } from "./routes/milestones.js";
import { miscRoutes } from "./routes/misc.js";
import { newsRoutes } from "./routes/news.js";
import { taskRoutes } from "./routes/tasks.js";
import { userRoutes } from "./routes/users.js";
import { teamRoutes } from "./routes/team.js";

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("x-content-type-options", "nosniff");
    h.set("referrer-policy", "no-referrer");
    h.set("x-frame-options", "DENY");
    h.set("cross-origin-opener-policy", "same-origin");
    h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    if (c.get("deps").config.secureCookies) h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (!h.has("content-security-policy")) {
      h.set(
        "content-security-policy",
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "frame-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "object-src 'none'",
        ].join("; "),
      );
    }
  };
}

export function createApp(deps: Deps, opts: { staticDir?: string } = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    c.set("ip", clientIp(c, deps.config.TRUST_PROXY));
    await runWithLang(parseLang(c.req.header("x-lang")), next);
  });
  app.use("*", securityHeaders());

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      if (err.status === 429) c.header("retry-after", "60");
      return c.json({ error: err.message, code: err.code, ...err.extra }, err.status);
    }
    if (err instanceof MailError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400 | 403 | 404 | 409 | 502 | 503);
    }
    if (err && typeof err === "object" && "name" in err && (err as Error).name === "ZodError") {
      return c.json({ error: tr("Invalid input.", "Ungültige Eingabe."), code: "validation" }, 400);
    }
    console.error("[error]", c.req.method, c.req.path, err);
    return c.json({ error: tr("Internal error. Please try again.", "Interner Fehler. Bitte versuche es erneut."), code: "internal" }, 500);
  });

  app.get("/healthz", (c) => {
    deps.db.prepare("SELECT 1").get();
    return c.json({ ok: true });
  });

  /* ---------------- API ---------------- */
  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    await next();
    // Default: cache nothing. Exception: routes that deliberately set their own cache headers (e.g. versioned profile photos).
    if (!c.res.headers.get("cache-control")) c.header("cache-control", "no-store");
  });
  const tooLarge = (c: Context) => c.json({ error: tr("Request too large.", "Anfrage zu groß."), code: "too_large" }, 413);
  const smallBody = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
  // CRM bundles are larger; the route is only reachable for admins.
  const importBody = bodyLimit({ maxSize: 40 * 1024 * 1024, onError: tooLarge });
  const bigBody = new Set(["/api/admin/import-crm"]);
  api.use("*", (c, next) => (bigBody.has(c.req.path) ? importBody(c, next) : smallBody(c, next)));
  api.use("*", loadSession);
  api.use("*", csrfGuard);

  api.route("/auth", authRoutes);

  // OAuth callback from Zoho (top-level navigation, hence redirects instead of JSON)
  api.get("/mail/oauth/callback", async (c) => {
    const user = c.get("user");
    if (!user) return c.redirect("/login?weiter=/postfach");
    if (getSetting(deps.db, "require_2fa", false) && !user.totp_enabled) return c.redirect("/einstellungen?tab=sicherheit");
    try {
      await deps.mail.completeOAuth(user, c.req.query(), c.get("ip"));
      return c.redirect("/postfach?verbunden=1");
    } catch (e) {
      // Only pass on a fixed error code – the text is mapped in the frontend (no reflected text in the URL).
      const code = e instanceof MailError ? e.code : "failed";
      if (!(e instanceof MailError)) console.error("[mail] OAuth:", e);
      return c.redirect(`/postfach?fehler=${encodeURIComponent(code)}`);
    }
  });

  const authed = new Hono<AppEnv>();
  authed.use("*", requireUser);
  authed.route("/", userRoutes);
  authed.route("/", miscRoutes);
  authed.route("/", teamRoutes);
  authed.route("/news", newsRoutes);
  authed.route("/tasks", taskRoutes);
  authed.route("/milestones", milestoneRoutes);
  authed.route("/contacts", contactRoutes);
  authed.route("/orgs", orgRoutes);
  authed.route("/mail", mailRoutes);
  authed.route("/ai", aiRoutes);
  authed.route("/assistant", assistantRoutes);
  authed.route("/calendar", calendarRoutes);
  authed.route("/agent", agentRoutes);
  const admin = new Hono<AppEnv>();
  admin.use("*", requireAdmin);
  admin.route("/", adminRoutes);
  authed.route("/admin", admin);
  api.route("/", authed);

  api.all("*", (c) => c.json({ error: tr("Unknown endpoint.", "Unbekannter Endpunkt."), code: "not_found" }, 404));
  app.route("/api", api);

  /* ---------------- Frontend (production) ---------------- */
  const dir = opts.staticDir;
  if (dir && fs.existsSync(path.join(dir, "index.html"))) {
    const indexHtml = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    app.use(
      "/assets/*",
      async (c, next) => {
        await next();
        if (c.res.status === 200) c.header("cache-control", "public, max-age=31536000, immutable");
      },
      serveStatic({ root: path.relative(process.cwd(), dir) || "." }),
    );
    // Only explicitly present files in the root directory (icons, manifest …) – no directories
    const rootFiles = new Set(fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name !== "index.html").map((e) => "/" + e.name));
    const serveRoot = serveStatic({ root: path.relative(process.cwd(), dir) || "." });
    app.use("*", async (c, next) => (rootFiles.has(c.req.path) ? serveRoot(c, next) : next()));
    app.get("*", (c) => {
      c.header("cache-control", "no-cache");
      return c.html(indexHtml);
    });
  }

  return app;
}
