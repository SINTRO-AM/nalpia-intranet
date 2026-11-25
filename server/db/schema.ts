/**
 * Database schema as ordered migrations. Always append new changes as a new entry,
 * never modify existing ones. Timestamps are milliseconds (Unix), due dates 'YYYY-MM-DD'.
 *
 * nalpia Intranet starts from a clean slate (migration 1 = the whole base model incl. the
 * investor CRM, migration 2 = the fundraising agent). The structure follows the SINTRO
 * intranet it was forked from, so CRM bundles stay compatible.
 */
export const migrations: { id: number; name: string; sql: string; /** Table rebuilds: run with foreign keys off (checked afterwards) */ foreignKeysOff?: boolean }[] = [
  {
    id: 1,
    name: "init",
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '[]',
  avatar_color TEXT NOT NULL DEFAULT 'navy',
  avatar_updated_at INTEGER,
  department TEXT NOT NULL DEFAULT '',
  manager_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  bio TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  password_hash TEXT,
  password_changed_at INTEGER,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT NOT NULL DEFAULT '[]',
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  prefs TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE user_avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  elevated_until INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE news (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'allgemein',
  pinned INTEGER NOT NULL DEFAULT 0,
  external_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX news_created ON news(created_at DESC);
CREATE UNIQUE INDEX news_ext ON news(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE news_reads (
  news_id TEXT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (news_id, user_id)
);

CREATE TABLE news_reactions (
  news_id TEXT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (news_id, user_id, emoji)
);

CREATE TABLE news_comments (
  id TEXT PRIMARY KEY,
  news_id TEXT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX news_comments_news ON news_comments(news_id, created_at);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('geplant','aktiv','erreicht','verschoben')),
  area TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Organizations: investors (VCs, angels, …) and partners (brokers, exchanges, data providers, accelerators …)
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('investor','partner')),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'sonstige',
  stage TEXT NOT NULL DEFAULT 'identifiziert',
  priority TEXT NOT NULL DEFAULT 'mittel' CHECK (priority IN ('hoch','mittel','niedrig')),
  priority_manual INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  website TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  aum_mio REAL,
  potential_mio REAL,
  ticket_min_mio REAL,
  ticket_max_mio REAL,
  committed_mio REAL,
  probability INTEGER,
  focus TEXT NOT NULL DEFAULT '',
  -- Investor profile (filterable): thematic focus ids, stage focus ids, regional focus text
  focus_tags TEXT NOT NULL DEFAULT '[]',
  stage_focus TEXT NOT NULL DEFAULT '[]',
  region_focus TEXT NOT NULL DEFAULT '',
  -- Fit for nalpia (0–100) with reason codes, see lib/nalpia-fit.ts
  fit_score INTEGER,
  fit_reasons TEXT NOT NULL DEFAULT '[]',
  -- What happened before nalpia (e.g. in the SINTRO fundraising): outcome id and a short history line
  prior_outcome TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '',
  -- Fundraising agent: current outreach state for this organization (see agent/)
  outreach_status TEXT NOT NULL DEFAULT '',
  outreach_at INTEGER,
  source TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  next_date TEXT,
  last_contact_at INTEGER,
  external_ref TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX organizations_kind ON organizations(kind, stage);
CREATE INDEX organizations_owner ON organizations(owner_id);
CREATE INDEX organizations_fit ON organizations(kind, fit_score DESC);
CREATE INDEX organizations_outreach ON organizations(kind, outreach_status);
CREATE UNIQUE INDEX organizations_ext ON organizations(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE org_activities (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'notiz' CHECK (kind IN ('notiz','mail','anruf','meeting','status','dokument')),
  body TEXT NOT NULL,
  external_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX org_activities_org ON org_activities(org_id, created_at DESC);
CREATE UNIQUE INDEX org_activities_ext ON org_activities(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  company TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'sonstige',
  stage TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  next_date TEXT,
  last_contact_at INTEGER,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  fit_score INTEGER,
  external_ref TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX contacts_email ON contacts(email);
CREATE INDEX contacts_category ON contacts(category);
CREATE INDEX contacts_org ON contacts(organization_id);
CREATE UNIQUE INDEX contacts_ext ON contacts(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE contact_activities (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'notiz' CHECK (kind IN ('notiz','mail','anruf','meeting','status')),
  body TEXT NOT NULL,
  mail_ref TEXT,
  external_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX contact_activities_contact ON contact_activities(contact_id, created_at DESC);
CREATE UNIQUE INDEX contact_activities_ext ON contact_activities(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'mittel' CHECK (priority IN ('hoch','mittel','niedrig')),
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','erledigt')),
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  source_mail TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  external_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX tasks_milestone ON tasks(milestone_id);
CREATE INDEX tasks_contact ON tasks(contact_id);
CREATE INDEX tasks_org ON tasks(organization_id);
CREATE UNIQUE INDEX tasks_ext ON tasks(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX task_comments_task ON task_comments(task_id, created_at);

-- Notifications are written in both languages; title holds the English text, title_de the German one.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  title_de TEXT,
  link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE mail_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'zoho',
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  addresses TEXT NOT NULL DEFAULT '[]',
  accounts_server TEXT NOT NULL,
  mail_api TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at INTEGER NOT NULL DEFAULT 0,
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_ts ON audit_log(ts DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Content shown in the other interface language (see lib/translate.ts): one row per text (hash) and language.
CREATE TABLE content_translations (
  src_hash TEXT NOT NULL,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (src_hash, lang)
);
`,
  },
  {
    id: 2,
    name: "fundraising-agent",
    sql: `
-- One row per investor the agent works on: the first mail, its follow-ups and the reply.
CREATE TABLE agent_outreach (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','needs_note','approved','sent','followup','replied','declined','bounced','paused','discarded','done')),
  lang TEXT NOT NULL DEFAULT 'en',
  to_email TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  personal TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  research TEXT NOT NULL DEFAULT '',
  quality INTEGER,
  sequence_step INTEGER NOT NULL DEFAULT 0,
  next_action_at INTEGER,
  sent_at INTEGER,
  replied_at INTEGER,
  reply_kind TEXT NOT NULL DEFAULT '',
  reply_summary TEXT NOT NULL DEFAULT '',
  thread_ref TEXT,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX agent_outreach_org ON agent_outreach(org_id);
CREATE INDEX agent_outreach_status ON agent_outreach(status, next_action_at);
CREATE INDEX agent_outreach_email ON agent_outreach(to_email);

-- Every message in an outreach thread: what went out and what came in.
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  outreach_id TEXT NOT NULL REFERENCES agent_outreach(id) ON DELETE CASCADE,
  dir TEXT NOT NULL CHECK (dir IN ('out','in')),
  kind TEXT NOT NULL CHECK (kind IN ('first','followup','reply','auto_reply','manual')),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','received','discarded')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  mail_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_messages_outreach ON agent_messages(outreach_id, created_at);

-- Runs of the agent (scheduled or started by hand) with a readable log.
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  triggered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '[]',
  counts TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX agent_runs_started ON agent_runs(started_at DESC);
`,
  },
  {
    id: 3,
    name: "themen-und-kanban",
    foreignKeysOff: true,
    sql: `
-- Topics: internal and external matters (funding applications, partner talks, architecture …) in a pipeline.
-- Tasks can belong to a topic; the topic shows progress, who it is waiting on and when to follow up.
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'intern' CHECK (kind IN ('intern','extern')),
  stage TEXT NOT NULL DEFAULT 'geplant' CHECK (stage IN ('idee','geplant','in_arbeit','wartet','erledigt','verworfen')),
  area TEXT NOT NULL DEFAULT '',
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  counterpart TEXT NOT NULL DEFAULT '',
  waiting_on TEXT NOT NULL DEFAULT '',
  waiting_since INTEGER,
  next_step TEXT NOT NULL DEFAULT '',
  follow_up TEXT,
  due_date TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  external_ref TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX topics_stage ON topics(stage, sort_order);
CREATE INDEX topics_owner ON topics(owner_id);
CREATE INDEX topics_org ON topics(organization_id);
CREATE UNIQUE INDEX topics_ext ON topics(external_ref) WHERE external_ref IS NOT NULL;

-- Updates on a topic: comments by people and events (phase changes, new owner …) as JSON.
CREATE TABLE topic_updates (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','event')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX topic_updates_topic ON topic_updates(topic_id, created_at);

-- Tasks get the status 'wartet' (waiting on someone), a topic and a note on who they are waiting on.
-- SQLite cannot change a CHECK constraint, so the table is rebuilt (comments stay: foreign keys are off).
CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'mittel' CHECK (priority IN ('hoch','mittel','niedrig')),
  status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_arbeit','wartet','erledigt')),
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  waiting_on TEXT NOT NULL DEFAULT '',
  source_mail TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  external_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
INSERT INTO tasks_new (id, title, description, assignee_id, created_by, due_date, priority, status, milestone_id, contact_id, organization_id, source_mail, sort_order, external_ref, created_at, updated_at, completed_at)
  SELECT id, title, description, assignee_id, created_by, due_date, priority, status, milestone_id, contact_id, organization_id, source_mail, sort_order, external_ref, created_at, updated_at, completed_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX tasks_milestone ON tasks(milestone_id);
CREATE INDEX tasks_topic ON tasks(topic_id);
CREATE INDEX tasks_contact ON tasks(contact_id);
CREATE INDEX tasks_org ON tasks(organization_id);
CREATE UNIQUE INDEX tasks_ext ON tasks(external_ref) WHERE external_ref IS NOT NULL;

-- History in the task: besides comments, events (status, owner, due date, topic) as JSON.
ALTER TABLE task_comments ADD COLUMN kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','event'));
`,
  },
];
