import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "bcryptjs";
import {
  FRIENDLY_ALPHABET,
  PROJECT_KEY_ALPHABET,
  SlidingWindowRateLimiter,
  credentialUsable,
  generatePublicReference,
  generateQrToken,
  generateRecoveryCode,
  generateSessionToken,
  generateTemporaryCode,
  hashSecret,
  lookupHash,
  normalizeHumanCode,
  normalizeProjectKey,
  verifySecret,
} from "../src/security.js";

test("la Clave Proyecto tiene el formato RCT y evita caracteres confusos", () => {
  const values = new Set(Array.from({ length: 100 }, generatePublicReference));
  assert.equal(values.size, 100);
  for (const value of values) assert.match(value, /^RCT-[CDFHJKMNRUVWXY3479]{4}-[CDFHJKMNRUVWXY3479]{2}$/);
  for (const char of "0O1IL2Z5S6G8BAETP") assert(!PROJECT_KEY_ALPHABET.includes(char));
  assert.equal(normalizeProjectKey(values.values().next().value.toLowerCase()), values.values().next().value);
  assert.equal(normalizeProjectKey("rct cdfh jk"), "RCT-CDFH-JK");
  assert.equal(normalizeProjectKey("ART-ABCDEFG"), null);
});

test("los códigos usan únicamente el alfabeto sin caracteres confusos", () => {
  const code = generateRecoveryCode();
  const temporary = generateTemporaryCode();
  assert.match(code, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{2}$/);
  assert.match(temporary, /^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  assert(!FRIENDLY_ALPHABET.includes("0") && !FRIENDLY_ALPHABET.includes("O") && !FRIENDLY_ALPHABET.includes("1") && !FRIENDLY_ALPHABET.includes("I") && !FRIENDLY_ALPHABET.includes("L"));
});

test("normaliza código escrito sin guiones", () => {
  assert.equal(normalizeHumanCode("m8qpr7kdx4"), "M8QP-R7KD-X4");
  assert.equal(normalizeHumanCode("w7kp4d8q"), "W7KP-4D8Q");
});

test("scrypt acepta el secreto correcto y rechaza otro", async () => {
  const encoded = await hashSecret("secreto-correcto");
  assert.equal(await verifySecret("secreto-correcto", encoded), true);
  assert.equal(await verifySecret("incorrecto", encoded), false);
  assert(!encoded.includes("secreto-correcto"));
});

test("lookup HMAC separa namespaces", () => {
  assert.equal(lookupHash("valor", "pepper", "A"), lookupHash("valor", "pepper", "A"));
  assert.notEqual(lookupHash("valor", "pepper", "A"), lookupHash("valor", "pepper", "B"));
});

test("conserva hashes PHP y rechaza parámetros scrypt arbitrarios", async () => {
  const encoded = (await hash('secreto-legacy', 10)).replace(/^\$2b\$/, () => '$2y$');
  assert.equal(await verifySecret('secreto-legacy', encoded), true);
  assert.equal(await verifySecret('incorrecto', encoded), false);
  assert.equal(await verifySecret('x', 'scrypt$999999999$8$1$YWJj$YWJj'), false);
});

test("QR y sesión tienen alta entropía aparente", () => {
  assert.match(generateQrToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.match(generateSessionToken(), /^[A-Za-z0-9_-]{43}$/);
});

test("credenciales revocadas, expiradas o agotadas no son utilizables", () => {
  const now = new Date("2026-09-02T12:00:00Z");
  assert.equal(credentialUsable({ revoked_at: null, expires_at: null, max_uses: null, use_count: 0 }, now), true);
  assert.equal(credentialUsable({ revoked_at: now, expires_at: null, max_uses: null, use_count: 0 }, now), false);
  assert.equal(credentialUsable({ revoked_at: null, expires_at: "2026-09-02T11:59:59Z", max_uses: null, use_count: 0 }, now), false);
  assert.equal(credentialUsable({ revoked_at: null, expires_at: null, max_uses: 1, use_count: 1 }, now), false);
});

test("rate limiter bloquea al superar la ventana y luego se recupera", () => {
  const limiter = new SlidingWindowRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limiter.check("ip", 1000).allowed, true);
  assert.equal(limiter.check("ip", 1100).allowed, true);
  assert.equal(limiter.check("ip", 1200).allowed, false);
  assert.equal(limiter.check("ip", 2101).allowed, true);
});
