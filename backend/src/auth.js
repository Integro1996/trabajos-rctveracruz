import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { pool } from "./db.js";
import { generateSessionToken, lookupHash, safeEqual } from "./security.js";

export const ARTICLE_COOKIE = "trabajos_session";
export const ARTICLE_CSRF_COOKIE = "trabajos_csrf";
export const ADMIN_COOKIE = "trabajos_admin_session";
export const ADMIN_CSRF_COOKIE = "trabajos_admin_csrf";

export function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [decodeURIComponent(index < 0 ? item : item.slice(0, index)), decodeURIComponent(index < 0 ? "" : item.slice(index + 1))];
  }));
}

function cookie(name, value, { httpOnly = true, maxAge, sameSite = "Lax" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `SameSite=${sameSite}`];
  if (httpOnly) parts.push("HttpOnly");
  if (config.cookieSecure) parts.push("Secure");
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join("; ");
}

function appendCookies(res, values) {
  res.append("Set-Cookie", values);
}

export function clientIp(req) {
  return String(req.ip || req.socket.remoteAddress || "").slice(0, 64);
}

export function userAgent(req) {
  return String(req.get("user-agent") || "").slice(0, 500);
}

function sessionHash(token, kind) {
  return lookupHash(token, config.recoveryPepper, kind);
}

export async function currentArticleSession(req) {
  const token = parseCookies(req)[ARTICLE_COOKIE];
  if (!token) return null;
  const hash = sessionHash(token, "article-session");
  const result = await pool.query(
    `SELECT session_hash, json_agg(article_id) AS article_ids
     FROM trabajos_article_sessions
     WHERE session_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
     GROUP BY session_hash`,
    [hash],
  );
  if (!result.rowCount) return null;
  const ids = result.rows[0].article_ids;
  return { token, hash, articleIds: typeof ids === "string" ? JSON.parse(ids) : ids };
}

export async function issueArticleSession(req, res, articleId, { forceNew = false } = {}) {
  const existing = forceNew ? null : await currentArticleSession(req);
  const token = existing?.token || generateSessionToken();
  const hash = sessionHash(token, "article-session");
  const expires = new Date(Date.now() + config.articleSessionDays * 86400_000);
  if (forceNew) {
    const previous = await currentArticleSession(req);
    if (previous?.articleIds?.length) {
      for (const previousArticleId of previous.articleIds) {
        await pool.query(
          `INSERT INTO trabajos_article_sessions (id, article_id, session_hash, expires_at, user_agent, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (article_id, session_hash) DO NOTHING`,
          [randomUUID(), previousArticleId, hash, expires, userAgent(req), clientIp(req)],
        );
      }
    }
  }
  await pool.query(
    `INSERT INTO trabajos_article_sessions (id, article_id, session_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (article_id, session_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked_at = NULL, last_used_at = NOW()`,
    [randomUUID(), articleId, hash, expires, userAgent(req), clientIp(req)],
  );
  const csrf = generateSessionToken();
  appendCookies(res, [
    cookie(ARTICLE_COOKIE, token, { maxAge: config.articleSessionDays * 86400, sameSite: "Lax" }),
    cookie(ARTICLE_CSRF_COOKIE, csrf, { httpOnly: false, maxAge: config.articleSessionDays * 86400, sameSite: "Lax" }),
  ]);
  return hash;
}

export async function requireArticleAccess(req, _res, next) {
  const articleId = req.params.articleId;
  const session = await currentArticleSession(req);
  if (!session || !session.articleIds.includes(articleId)) {
    const error = new Error("No tiene acceso a este trabajo.");
    error.status = 403;
    throw error;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const csrf = parseCookies(req)[ARTICLE_CSRF_COOKIE];
    if (!csrf || !safeEqual(csrf, req.get("x-trabajos-csrf"))) {
      const error = new Error("La protección CSRF rechazó la solicitud.");
      error.status = 403;
      throw error;
    }
  }
  await pool.query("UPDATE trabajos_article_sessions SET last_used_at = NOW() WHERE article_id = $1 AND session_hash = $2", [articleId, session.hash]);
  req.articleSession = session;
  next();
}

export async function issueAdminSession(req, res, adminId) {
  const token = generateSessionToken();
  const csrf = generateSessionToken();
  const hash = sessionHash(token, "admin-session");
  const expires = new Date(Date.now() + config.adminSessionHours * 3600_000);
  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO trabajos_admin_sessions (id, admin_id, session_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, adminId, hash, expires, userAgent(req), clientIp(req)],
  );
  appendCookies(res, [
    cookie(ADMIN_COOKIE, token, { maxAge: config.adminSessionHours * 3600, sameSite: "Strict" }),
    cookie(ADMIN_CSRF_COOKIE, csrf, { httpOnly: false, maxAge: config.adminSessionHours * 3600, sameSite: "Strict" }),
  ]);
  return sessionId;
}

export async function currentAdmin(req) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (!token) return null;
  const result = await pool.query(
    `SELECT s.id AS session_id, s.session_hash, u.id, u.name, u.email
     FROM trabajos_admin_sessions s JOIN trabajos_admin_users u ON u.id = s.admin_id
     WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.active = TRUE`,
    [sessionHash(token, "admin-session")],
  );
  return result.rowCount ? result.rows[0] : null;
}

export async function requireAdmin(req, _res, next) {
  const admin = await currentAdmin(req);
  if (!admin) {
    const error = new Error("Autenticación administrativa requerida.");
    error.status = 401;
    throw error;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const csrf = parseCookies(req)[ADMIN_CSRF_COOKIE];
    if (!csrf || !safeEqual(csrf, req.get("x-admin-csrf"))) {
      const error = new Error("La protección CSRF administrativa rechazó la solicitud.");
      error.status = 403;
      throw error;
    }
  }
  await pool.query("UPDATE trabajos_admin_sessions SET last_used_at = NOW() WHERE id = $1", [admin.session_id]);
  req.admin = admin;
  next();
}

export async function revokeCurrentAdmin(req, res) {
  const admin = await currentAdmin(req);
  if (admin) await pool.query("UPDATE trabajos_admin_sessions SET revoked_at = NOW() WHERE id = $1", [admin.session_id]);
  appendCookies(res, [cookie(ADMIN_COOKIE, "", { maxAge: 0, sameSite: "Strict" }), cookie(ADMIN_CSRF_COOKIE, "", { httpOnly: false, maxAge: 0, sameSite: "Strict" })]);
}
