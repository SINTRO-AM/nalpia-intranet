import type { Config } from "./config.js";
import type { Deps } from "./context.js";
import { openDb } from "./db/index.js";
import { Vault } from "./lib/crypto.js";
import { SystemMailer } from "./lib/mailer.js";
import { RateLimiter } from "./lib/ratelimit.js";
import { MailService } from "./mail/service.js";
import { AiService } from "./ai/service.js";
import { AgentService } from "./agent/service.js";

export function createDeps(config: Config, opts: { dbFile?: string; fetch?: typeof fetch } = {}): Deps {
  const db = openDb(opts.dbFile ?? config.dbFile);
  const vault = new Vault(config.APP_SECRET!);
  const deps = {
    db,
    config,
    vault,
    limiter: new RateLimiter(),
    mail: new MailService(db, config, vault, opts.fetch ?? fetch),
    ai: new AiService(config),
    mailer: new SystemMailer(config),
  } as Deps;
  deps.agent = new AgentService(deps);
  return deps;
}
