import { z } from "zod";
import path from "node:path";

/**
 * Central configuration. All values come from environment variables (see .env.example).
 * In production (NODE_ENV=production), missing required values are rejected at startup.
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  APP_URL: z.string().default("http://localhost:5173"),
  APP_NAME: z.string().default("nalpia Intranet"),
  APP_SECRET: z.string().optional(),
  DATA_DIR: z.string().default("./data"),
  TRUST_PROXY: bool(false),
  DEMO_MODE: bool(false),
  ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),

  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_ACCOUNTS_URL: z.string().default("https://accounts.zoho.eu"),
  ZOHO_MAIL_API_URL: z.string().optional(),
  ZOHO_ENFORCE_EMAIL_MATCH: bool(true),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  AI_HOURLY_LIMIT: z.coerce.number().int().min(1).default(40),
  /** Model for the personal AI assistant (chat window) – the strongest available */
  ASSISTANT_MODEL: z.string().default("claude-opus-5-5"),
  /** Messages to the assistant per person and hour */
  ASSISTANT_HOURLY_LIMIT: z.coerce.number().int().min(1).default(60),
  /** Model for translating content (news, tasks, notes …) into the interface language – fast and inexpensive */
  TRANSLATE_MODEL: z.string().default("claude-haiku-5-5"),
  /** Translation requests (batches) per person and hour */
  TRANSLATE_HOURLY_LIMIT: z.coerce.number().int().min(1).default(300),
  /** Fundraising agent: model for research, drafts and reply classification – the strongest available */
  AGENT_MODEL: z.string().default("claude-opus-5-5"),
  /** Run the agent's scheduler inside the server process (off for tests and one-off CLI runs) */
  AGENT_SCHEDULER: bool(true),
  /** Time zone for the agent's sending window and daily batches */
  AGENT_TZ: z.string().default("Europe/Berlin"),
});

export type Config = z.infer<typeof schema> & {
  isProd: boolean;
  appOrigin: string;
  secureCookies: boolean;
  allowedDomains: string[];
  dbFile: string;
  zohoEnabled: boolean;
  aiEnabled: boolean;
  smtpEnabled: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === "production";
  let appOrigin: string;
  try {
    appOrigin = new URL(c.APP_URL).origin;
  } catch {
    throw new Error("APP_URL must be a complete URL, e.g. https://intranet.nalpia.com");
  }
  if (isProd && c.DEMO_MODE) {
    throw new Error("DEMO_MODE is not allowed in production (NODE_ENV=production) – demo accounts have a publicly known password.");
  }
  if (isProd) {
    if (!c.APP_SECRET || c.APP_SECRET.length < 32) {
      throw new Error("APP_SECRET is missing or too short (at least 32 characters). Generate one with: openssl rand -base64 48");
    }
    if (!appOrigin.startsWith("https://")) {
      throw new Error("APP_URL must start with https:// in production.");
    }
  }
  const secret = c.APP_SECRET ?? "dev-only-secret-change-me-dev-only-secret-change-me";
  return {
    ...c,
    APP_SECRET: secret,
    isProd,
    appOrigin,
    secureCookies: appOrigin.startsWith("https://"),
    allowedDomains: (c.ALLOWED_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    dbFile: path.resolve(c.DATA_DIR, "intranet.db"),
    zohoEnabled: Boolean(c.ZOHO_CLIENT_ID && c.ZOHO_CLIENT_SECRET),
    aiEnabled: Boolean(c.ANTHROPIC_API_KEY),
    smtpEnabled: Boolean(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASS),
  };
}
