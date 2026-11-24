/**
 * Admin commands for the server (run directly against the database):
 *   node dist/server/cli.js create-admin --email denis@nalpia.com --name "Denis Keller" [--title CEO]
 *   node dist/server/cli.js reset-link --email name@nalpia.com
 *   node dist/server/cli.js unlock --email name@nalpia.com
 *   node dist/server/cli.js list-users
 *   node dist/server/cli.js backup [--out /data/backups/intranet-YYYY-MM-DD.db]
 *   node dist/server/cli.js verify-audit
 *   node dist/server/cli.js seed-team [--update] [--dry-run]   (--update: take roles and reporting lines from the template)
 *   node dist/server/cli.js import-crm --file data/seed/investors-bundle.json [--owner denis@nalpia.com] [--tasks] [--update] [--dry-run]
 *   node dist/server/cli.js rescore-investors [--fill-focus]   (recalculate fit and priority of all investors)
 *   node dist/server/cli.js agent-run [--kind drafts|inbox|followups|send|all]   (run the fundraising agent once)
 */
import { loadConfig } from "./config.js";
import { createDeps } from "./deps.js";
import { getUserByEmail, issueAuthToken, revokeSessions } from "./auth/service.js";
import { audit, verifyAuditChain } from "./lib/audit.js";
import { applyNewsTemplate } from "./lib/news-template.js";
import { describeImport, importCrmBundle, parseCrmBundle } from "./lib/crm-import.js";
import { rescoreInvestors } from "./lib/nalpia-fit.js";
import { AgentService } from "./agent/service.js";
import { applyTeamTemplate } from "./lib/team-template.js";
import { newId } from "./lib/util.js";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
const config = loadConfig();
const deps = createDeps(config);

function need(v: string | undefined, what: string): string {
  if (!v) {
    console.error(`Missing parameter --${what}`);
    process.exit(1);
  }
  return v;
}

switch (cmd) {
  case "create-admin": {
    const email = need(arg("email"), "email").trim().toLowerCase();
    const name = need(arg("name"), "name");
    const existing = getUserByEmail(deps, email);
    if (existing) {
      deps.db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?").run(Date.now(), existing.id);
      const kind = existing.status === "invited" ? "invite" : "reset";
      const { url } = issueAuthToken(deps, existing.id, kind, null);
      console.log(`${email} is now an admin. ${kind === "invite" ? "Invite link" : "Link to set the password"}:\n${url}`);
      audit(deps.db, { action: "cli.admin_promoted", target: existing.id });
      break;
    }
    const id = newId();
    const now = Date.now();
    deps.db
      .prepare("INSERT INTO users (id, email, name, title, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 'invited', ?, ?)")
      .run(id, email, name, arg("title") ?? "", now, now);
    const { url } = issueAuthToken(deps, id, "invite", null);
    audit(deps.db, { action: "cli.admin_created", target: id, meta: { email } });
    console.log(`Admin created: ${name} <${email}>\nSet password (valid for 7 days):\n${url}`);
    break;
  }
  case "reset-link": {
    const email = need(arg("email"), "email");
    const u = getUserByEmail(deps, email);
    if (!u) {
      console.error("No account with this address.");
      process.exit(1);
    }
    const { url } = issueAuthToken(deps, u.id, u.status === "invited" ? "invite" : "reset", null);
    revokeSessions(deps, u.id);
    audit(deps.db, { action: "cli.reset_link", target: u.id });
    console.log(url);
    break;
  }
  case "unlock": {
    const u = getUserByEmail(deps, need(arg("email"), "email"));
    if (!u) process.exit(1);
    deps.db.prepare("UPDATE users SET locked_until = 0, failed_logins = 0 WHERE id = ?").run(u.id);
    console.log("Unlocked.");
    break;
  }
  case "list-users": {
    const rows = deps.db.prepare("SELECT email, name, role, status, totp_enabled FROM users ORDER BY name").all();
    console.table(rows);
    break;
  }
  case "backup": {
    const out = arg("out") ?? `${config.DATA_DIR}/backups/intranet-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.db`;
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await deps.db.backup(out);
    console.log(`Backup written: ${out}`);
    break;
  }
  case "verify-audit": {
    const r = verifyAuditChain(deps.db);
    console.log(r.ok ? `Audit log intact (${r.entries} entr${r.entries === 1 ? "y" : "ies"}).` : `WARNING: audit log changed or deleted from entry #${r.brokenAtId} on.`);
    if (!r.ok) process.exitCode = 2;
    break;
  }
  case "import-crm": {
    const fs = await import("node:fs");
    const file = need(arg("file"), "file");
    let bundle;
    try {
      bundle = parseCrmBundle(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const ownerEmail = arg("owner");
    if (ownerEmail) bundle.ownerEmail = ownerEmail;
    const fallback = bundle.ownerEmail ? getUserByEmail(deps, bundle.ownerEmail) : undefined;
    const r = importCrmBundle(deps.db, bundle, {
      actorId: fallback?.id ?? null,
      fallbackOwnerId: fallback?.id ?? null,
      update: process.argv.includes("--update"),
      tasks: process.argv.includes("--tasks"),
      dryRun: process.argv.includes("--dry-run"),
      ip: "cli",
    });
    console.log(describeImport(r));
    break;
  }
  case "rescore-investors": {
    const r = rescoreInvestors(deps.db, { fillFocus: process.argv.includes("--fill-focus") });
    console.log(`Fit recalculated for ${r.orgs} investors: ${r.hoch} high, ${r.mittel} medium, ${r.niedrig} low priority.`);
    break;
  }
  case "agent-run": {
    const kind = (arg("kind") ?? "all") as "drafts" | "inbox" | "followups" | "send" | "all";
    const agent = new AgentService(deps);
    const r = await agent.run(kind, { triggeredBy: null, force: true });
    for (const run of r) console.log(`${run.kind}: ${run.status} – ${run.summary}`);
    break;
  }
  case "seed-team": {
    const r = applyTeamTemplate(deps.db, {
      actorId: null,
      dryRun: process.argv.includes("--dry-run"),
      overwriteStructure: process.argv.includes("--update"),
      ip: "cli",
    });
    console.log(
      [
        r.dryRun ? "Dry run – nothing saved." : "nalpia team applied.",
        `New (invited, no link sent yet): ${r.created.join(", ") || "–"}`,
        `Updated: ${r.updated.join(", ") || "–"}`,
        `Unchanged: ${r.unchanged.join(", ") || "–"}`,
        ...r.unconfirmedEmails.map((x) => `Please check: ${x.name} has no known mailbox yet (${x.email}).`),
      ].join("\n"),
    );
    break;
  }
  case "seed-news": {
    const r = applyNewsTemplate(deps.db, { actorId: null, dryRun: process.argv.includes("--dry-run"), ip: "cli" });
    console.log(
      [
        r.dryRun ? "Dry run – nothing saved." : "nalpia news created.",
        `New (author: ${r.author}): ${r.created.length}`,
        ...r.created.map((t) => `  + ${t}`),
        `Already present: ${r.existing.length}`,
      ].join("\n"),
    );
    break;
  }
  default:
    console.log("Commands: create-admin | reset-link | unlock | list-users | backup | verify-audit | import-crm | rescore-investors | agent-run | seed-team | seed-news");
}
deps.db.close();
