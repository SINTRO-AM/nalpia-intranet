import type { Context } from "hono";
import { z } from "zod";
import { currentLang, tr } from "./i18n.js";

// zod's built-in messages follow the request language too (evaluated when an issue is reported)
const zodEn = z.locales.en().localeError;
const zodDe = z.locales.de().localeError;
z.config({ localeError: (iss) => (currentLang() === "de" ? zodDe : zodEn)(iss) });

/** Lazily translated zod message: `.min(1, zMsg("Required", "Pflichtfeld"))` */
export const zMsg = (en: string, de: string) => ({ error: () => tr(en, de) });

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    message: string,
    public code = "error",
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = "bad_request") => new HttpError(400, msg, code);
export const forbidden = (msg = tr("You do not have permission to do this.", "Dafür fehlt dir die Berechtigung.")) => new HttpError(403, msg, "forbidden");
export const notFound = (msg = tr("Not found.", "Nicht gefunden.")) => new HttpError(404, msg, "not_found");

/** Reads and validates a JSON body. Errors are returned as 422 with field hints. */
export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, tr("Invalid JSON in the request.", "Ungültiges JSON im Request."), "invalid_json");
  }
  return validate(schema, raw);
}

export function validate<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join(".") || "_"] = i.message;
    throw new HttpError(422, tr("Please check your input.", "Bitte prüfe die Eingaben."), "validation", { fields });
  }
  return r.data;
}

export function query<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return validate(schema, c.req.query());
}

/* Reusable field types */
export const zId = z.string().min(1).max(64);
export const zDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, zMsg("Date in the format YYYY-MM-DD", "Datum im Format JJJJ-MM-TT"))
  .refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), zMsg("Invalid date", "Ungültiges Datum"));
export const zText = (max: number) => z.string().trim().max(max);
export const zEmail = z.string().trim().toLowerCase().pipe(z.email(zMsg("Invalid email address", "Ungültige E-Mail-Adresse"))).pipe(z.string().max(254));
