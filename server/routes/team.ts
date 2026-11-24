import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { audit } from "../lib/audit.js";
import { body, forbidden, zMsg, zText } from "../lib/http.js";
import { applyTeamTemplate, type External } from "../lib/team-template.js";
import { newId } from "../lib/util.js";
import { tr } from "../lib/i18n.js";

/** Org chart additions: external people (advisory board, advisors) and the nalpia team template. */
export const teamRoutes = new Hono<AppEnv>();

teamRoutes.get("/team/externals", (c) => c.json(getSetting<External[]>(c.get("deps").db, "team_externals", [])));

teamRoutes.put("/team/externals", async (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  if (me.role !== "admin") throw forbidden(tr("Only admins can manage external people in the org chart.", "Nur Admins pflegen externe Personen im Organigramm."));
  const p = await body(
    c,
    z.object({
      items: z
        .array(
          z.object({
            id: z.string().max(64).optional(),
            name: zText(80).min(2, zMsg("Please enter a name.", "Bitte einen Namen angeben.")),
            role: zText(80).optional().default(""),
            note: zText(300).optional().default(""),
            group: zText(40).optional().default(tr("External", "Extern")),
          }),
        )
        .max(40),
    }),
  );
  const items: External[] = p.items.map((x) => ({ id: x.id || newId(), name: x.name, role: x.role, note: x.note, group: x.group || tr("External", "Extern") }));
  setSetting(db, "team_externals", items);
  audit(db, { userId: me.id, action: "team.externals", ip: c.get("ip"), meta: { count: items.length } });
  return c.json(items);
});

/** Create the nalpia team (preview with ?probe=1). Creates invited accounts but sends no links. */
teamRoutes.post("/team/template", (c) => {
  const { db } = c.get("deps");
  const me = c.get("user");
  if (me.role !== "admin") throw forbidden(tr("Only admins can create the team.", "Nur Admins können das Team anlegen."));
  return c.json(
    applyTeamTemplate(db, { actorId: me.id, dryRun: c.req.query("probe") === "1", overwriteStructure: c.req.query("struktur") === "1", ip: c.get("ip") }),
  );
});
