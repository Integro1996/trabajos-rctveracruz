import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const base = process.env.PHP_API_URL || "http://127.0.0.1:4300";
const onlyoffice = process.env.ONLYOFFICE_INTERNAL_URL;
const onlyofficeSecret = process.env.ONLYOFFICE_JWT_SECRET;

class Client {
  constructor() { this.cookies = new Map(); }
  async request(path, { method = "GET", body, redirect = "follow" } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    if (this.cookies.has("trabajos_csrf")) headers["x-trabajos-csrf"] = this.cookies.get("trabajos_csrf");
    if (this.cookies.has("trabajos_admin_csrf")) headers["x-admin-csrf"] = this.cookies.get("trabajos_admin_csrf");
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect });
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const [pair] = cookie.split(";"); const index = pair.indexOf("=");
      const key = pair.slice(0, index); const value = decodeURIComponent(pair.slice(index + 1));
      if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(cookie)) this.cookies.delete(key); else this.cookies.set(key, value);
    }
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { response, payload };
  }
}

async function ok(promise, status = 200) {
  const result = await promise;
  assert.equal(result.response.status, status, JSON.stringify(result.payload));
  return result.payload;
}

function jwt(payload, secret) {
  const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  const head = encode({ alg: "HS256", typ: "JWT" });
  const data = `${head}.${encode({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}

const owner = new Client();
const created = await ok(owner.request("/api/lab/articles", { method: "POST", body: {} }), 201);
assert.match(created.article.publicReference, /^ART-[A-HJ-KM-NP-Z2-9]{6}$/);
assert(created.recovery.qrDataUrl.startsWith("data:image/svg+xml;base64,"));
assert((await ok(owner.request("/api/lab/articles"))).some((article) => article.id === created.article.id));

const content = {
  title: "Migración PHP funcional",
  authors: created.article.authors.map(({ position, id, ...author }) => author),
  keywords: ["frutales", "Algas verdes"],
  introduction: "Este cuerpo demuestra la migración completa a PHP.",
  blocks: [{ id: crypto.randomUUID(), type: "text", text: "El contenido permanece editable mediante ONLYOFFICE Cloud." }],
};
await ok(owner.request(`/api/lab/articles/${created.article.id}`, { method: "PATCH", body: content }));
const generated = await ok(owner.request(`/api/lab/articles/${created.article.id}/generate`, { method: "POST", body: {} }));
assert(generated.pageCount >= 1 && generated.pageCount <= 3);
await ok(owner.request(`/api/lab/articles/${created.article.id}/finalize`, { method: "POST", body: {} }));

const recovered = new Client();
const recoveredPayload = await ok(recovered.request("/api/lab/recover/code", { method: "POST", body: { code: created.recovery.code } }));
assert.equal(recoveredPayload.article.id, created.article.id);
const qrClient = new Client();
const qrResult = await qrClient.request(new URL(created.recovery.recoveryUrl).pathname, { redirect: "manual" });
assert.equal(qrResult.response.status, 303);

const editor = await ok(owner.request(`/api/lab/articles/${created.article.id}/editor-config`));
assert.equal(editor.config.document.permissions.edit, true);
assert(onlyoffice && onlyofficeSecret, "Falta ONLYOFFICE local para probar callback.");
const conversion = { async: false, filetype: "docx", key: `php-callback-${Date.now()}`, outputtype: "docx", title: "php-callback.docx", url: editor.config.document.url };
const conversionResponse = await fetch(`${onlyoffice}/converter?shardkey=${encodeURIComponent(conversion.key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: jwt(conversion, onlyofficeSecret) }) }).then((response) => response.json());
assert(conversionResponse.fileUrl, JSON.stringify(conversionResponse));
const callbackBody = { key: generated.documentKey, status: 2, url: conversionResponse.fileUrl };
const callback = await fetch(`${base}/api/onlyoffice/callback/${created.article.id}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${jwt(callbackBody, onlyofficeSecret)}` }, body: JSON.stringify(callbackBody) }).then((response) => response.json());
assert.equal(callback.error, 0, JSON.stringify(callback));

const admin = new Client();
await ok(admin.request("/api/lab/admin/login", { method: "POST", body: { email: "admin.php@integration.test", password: "PHP-integration-password-2026" } }));
const search = await ok(admin.request(`/api/lab/admin/articles?q=${created.article.publicReference}`));
assert.equal(search.length, 1);
let detail = await ok(admin.request(`/api/lab/admin/articles/${created.article.id}`));
assert(detail.versions.length >= 3);
assert.equal((await admin.request(`/api/lab/admin/articles/${created.article.id}/download`)).response.status, 200);
const emergency = await ok(admin.request(`/api/lab/admin/articles/${created.article.id}/emergency-access`, { method: "POST", body: { reason: "Prueba integral de emergencia PHP" } }));
assert.equal(emergency.config.document.permissions.edit, true);
await ok(admin.request(`/api/lab/admin/articles/${created.article.id}/temporary-access`, { method: "POST", body: { reason: "Prueba temporal PHP", hours: 1, maxUses: 1 } }));
const restorable = detail.versions.find((version) => version.pageCount);
await ok(admin.request(`/api/lab/admin/articles/${created.article.id}/versions/${restorable.version}/restore`, { method: "POST", body: { reason: "Restauración integral desde PHP" } }));
await ok(admin.request(`/api/lab/admin/articles/${created.article.id}/recovery`, { method: "POST", body: { reason: "Regeneración integral PHP" } }));
await ok(admin.request(`/api/lab/admin/articles/${created.article.id}/revoke-sessions`, { method: "POST", body: { reason: "Revocación integral PHP" } }));
const audit = await ok(admin.request("/api/lab/admin/audit"));
for (const action of ["ADMIN_LOGIN", "VIEW_ARTICLE", "DOWNLOAD_DOCUMENT", "EMERGENCY_ACCESS", "GENERATE_TEMP_ACCESS", "RESTORE_VERSION", "GENERATE_RECOVERY", "REVOKE_SESSIONS"]) assert(audit.some((row) => row.action === action), action);

process.stdout.write(JSON.stringify({ ok: true, articleId: created.article.id, versions: detail.versions.length, pages: generated.pageCount, auditRows: audit.length }) + "\n");
