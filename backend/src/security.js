import { createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { compare } from "bcryptjs";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const FRIENDLY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PROJECT_KEY_ALPHABET = "CDFHJKMNRUVWXY3479";

function randomFriendly(length) {
  return Array.from({ length }, () => FRIENDLY_ALPHABET[randomInt(FRIENDLY_ALPHABET.length)]).join("");
}

export function generatePublicReference() {
  const raw = Array.from({ length: 6 }, () => PROJECT_KEY_ALPHABET[randomInt(PROJECT_KEY_ALPHABET.length)]).join("");
  return `RCT-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeProjectKey(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/[\s-]/gu, "");
  if (!/^RCT[A-Z0-9]{6}$/u.test(compact)) return null;
  const raw = compact.slice(3);
  if (![...raw].every((char) => PROJECT_KEY_ALPHABET.includes(char))) return null;
  return `RCT-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function generateRecoveryCode() {
  const raw = randomFriendly(10);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function generateTemporaryCode() {
  const raw = randomFriendly(8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function generateQrToken() {
  return randomBytes(32).toString("base64url");
}

export function generateSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function normalizeHumanCode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length === 10) return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  return String(value || "").trim().toUpperCase();
}

export function lookupHash(secret, pepper, namespace = "credential") {
  return createHmac("sha256", pepper).update(`${namespace}:${secret}`).digest("hex");
}

export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const derived = await scrypt(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifySecret(secret, encoded) {
  if (/^\$2[aby]\$/.test(String(encoded))) return compare(secret, encoded.replace(/^\$2y\$/, () => '$2b$'));
  const [algorithm, n, r, p, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || n !== "16384" || r !== "8" || p !== "1" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  if (expected.length !== 32 || Buffer.from(saltText, "base64url").length !== 16) return false;
  const actual = Buffer.from(await scrypt(secret, Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  }));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function credentialUsable(credential, now = new Date()) {
  return !credential.revoked_at
    && (!credential.expires_at || new Date(credential.expires_at) > now)
    && (credential.max_uses === null || credential.max_uses === undefined || credential.use_count < credential.max_uses);
}

export class SlidingWindowRateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  check(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const recent = (this.entries.get(key) || []).filter((time) => time > cutoff);
    const allowed = recent.length < this.max;
    if (allowed) recent.push(now);
    this.entries.set(key, recent);
    return { allowed, remaining: Math.max(0, this.max - recent.length), retryAfterMs: recent[0] ? Math.max(0, recent[0] + this.windowMs - now) : 0 };
  }

  reset(key) {
    this.entries.delete(key);
  }
}
