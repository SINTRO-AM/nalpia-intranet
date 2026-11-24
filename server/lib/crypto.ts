import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt (OWASP parameters N=2^15, r=8, p=3).
 * Format: scrypt$N$r$p$salt$hash (base64url), so parameters can be raised later.
 */
const SCRYPT = { N: 2 ** 15, r: 8, p: 3, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Same computation time as for existing users, to make user enumeration harder.
    await hashPassword(password);
    return false;
  }
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function needsRehash(stored: string): boolean {
  const [alg, n, r, p] = stored.split("$");
  return alg !== "scrypt" || Number(n) < SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) < SCRYPT.p;
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Symmetric encryption (AES-256-GCM) for OAuth tokens and TOTP secrets. */
export class Vault {
  private key: Buffer;
  private macKey: Buffer;
  constructor(secret: string) {
    this.key = Buffer.from(crypto.hkdfSync("sha256", secret, "nalpia-intranet", "vault-v1", 32));
    this.macKey = Buffer.from(crypto.hkdfSync("sha256", secret, "nalpia-intranet", "mac-v1", 32));
  }
  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
  }
  /** Keyed hash (HMAC-SHA256) – e.g. for recovery codes. */
  mac(input: string): string {
    return crypto.createHmac("sha256", this.macKey).update(input).digest("hex");
  }
  decrypt(payload: string): string {
    const [v, ivB64, tagB64, encB64] = payload.split(".");
    if (v !== "v1" || !ivB64 || !tagB64 || encB64 === undefined) throw new Error("Invalid ciphertext");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encB64, "base64url")), decipher.final()]).toString("utf8");
  }
}

/* ---------------- TOTP (RFC 6238) ---------------- */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpCode(secretB32: string, at = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 30_000));
}

/** Checks a 6-digit code (±1 time window) and returns the matching time window or null. */
export function totpStep(secretB32: string, code: string, at = Date.now()): number | null {
  const c = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const step = Math.floor(at / 30_000);
  for (const d of [-1, 0, 1]) {
    if (safeEqual(hotp(secret, step + d), c)) return step + d;
  }
  return null;
}

export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  return totpStep(secretB32, code, at) !== null;
}

export function recoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}
