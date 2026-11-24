import { serve } from "@hono/node-server";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { createApp } from "./app.js";
import { bootstrapAdmin, seedDemo } from "./seed.js";

const config = loadConfig();
const deps = createDeps(config);

if (config.DEMO_MODE) await seedDemo(deps);
await bootstrapAdmin(deps);

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/server → dist/web (production); server/ → dist/web (development with tsx)
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, here.split(path.sep).includes("dist") ? "../web" : "../dist/web");
const app = createApp(deps, { staticDir });

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`[intranet] running on http://${info.address}:${info.port} (APP_URL ${config.APP_URL})`);
  console.log(
    `[intranet] Mail: ${deps.mail.mode}, AI: ${deps.ai.mode}, SMTP: ${deps.mailer.enabled ? "on" : "off"}${config.DEMO_MODE ? ", DEMO MODE" : ""}`,
  );
  if (!config.isProd) console.log("[intranet] Development mode – do not use in production.");
  if (config.AGENT_SCHEDULER) {
    deps.agent.startScheduler();
    console.log(`[intranet] Fundraising agent: scheduler on (${config.AGENT_MODEL}, mode ${deps.agent.settings().mode})`);
  }
});

// Regular cleanup
const sweep = setInterval(() => {
  const now = Date.now();
  deps.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  deps.db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(now - 3600_000);
  deps.db.prepare("DELETE FROM auth_tokens WHERE expires_at < ? AND used_at IS NULL").run(now - 7 * 86400_000);
}, 3600_000);
sweep.unref();

function shutdown() {
  console.log("[intranet] shutting down …");
  deps.agent.stopScheduler();
  server.close(() => {
    deps.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
