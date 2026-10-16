import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mammoth from "mammoth";

const base = process.env.LAB_API_URL || "http://localhost:4200";
const adminEmail = process.env.ADMIN_EMAIL || process.env.TRABAJOS_ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD || process.env.TRABAJOS_ADMIN_PASSWORD;

class Client {
  constructor() { this.cookies = new Map(); }
  async request(path, { method = "GET", body, redirect = "follow" } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (this.cookies.get("trabajos_csrf")) headers["x-trabajos-csrf"] = this.cookies.get("trabajos_csrf");
    if (this.cookies.get("trabajos_admin_csrf")) headers["x-admin-csrf"] = this.cookies.get("trabajos_admin_csrf");
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect });
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const value of setCookies) {
      const [pair] = value.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const cookieValue = decodeURIComponent(pair.slice(index + 1));
      if (value.includes("Max-Age=0")) this.cookies.delete(name); else this.cookies.set(name, cookieValue);
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { response, payload };
  }
}

async function expectStatus(promise, expected) {
  const result = await promise;
  assert.equal(result.response.status, expected, JSON.stringify(result.payload));
  return result.payload;
}

const owner = new Client();
const stranger = new Client();
const admin = new Client();

const created = await expectStatus(owner.request("/api/lab/articles", { method: "POST", body: {} }), 201);
const { article } = created;
assert.match(article.publicReference, /^RCT-[CDFHJKMNRUVWXY3479]{4}-[CDFHJKMNRUVWXY3479]{2}$/);
assert.equal(created.recovery, undefined);
const incomplete = await owner.request("/api/lab/articles/" + article.id + "/generate", { method: "POST", body: {} });
assert.equal(incomplete.response.status, 422);
assert(JSON.stringify(incomplete.payload).includes("Materiales y métodos"));

assert.equal((await expectStatus(owner.request("/api/lab/articles"), 200)).some((item) => item.id === article.id), true);
await expectStatus(owner.request(`/api/lab/articles/${article.id}`), 200);
await expectStatus(stranger.request(`/api/lab/articles/${article.id}`), 403);
await expectStatus(stranger.request("/api/lab/admin/articles"), 401);
await expectStatus(stranger.request("/api/lab/recover/code", { method: "POST", body: { code: "AAAA-BBBB-CC" } }), 401);

const recovered = new Client();
const recoveredArticle = await expectStatus(recovered.request("/api/lab/recover/code", { method: "POST", body: { code: article.publicReference.toLowerCase() } }), 200);
assert.equal(recoveredArticle.article.id, article.id);
await expectStatus(recovered.request(`/api/lab/articles/${article.id}`), 200);

const image = await expectStatus(owner.request(`/api/lab/articles/${article.id}/assets`, {
  method: "POST",
  body: {
    fileName: "figura-prueba.png",
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
}), 201);
const content = {
  title: "Resumen científico por bloques",
  mesa: "AG",
  authors: article.authors.map(({ position, ...author }) => author),
  keywords: ["frutales", "algas verdes"],
  introduction: "Este resumen presenta los resultados principales del ensayo y su interpretación.",
  blocks: [
    { id: randomUUID(), type: "text", heading: "Objetivos", text: "Evaluar los tratamientos del ensayo." },
    { id: randomUUID(), type: "text", heading: "Materiales y métodos", text: "Se evaluaron dos tratamientos durante el ensayo." },
    { id: randomUUID(), type: "text", heading: 'Resultados y discusión', text: "Los tratamientos mostraron diferencias consistentes durante el periodo de evaluación." },
    { id: randomUUID(), type: "figure", heading: "Resultados y discusión", assetId: image.id, caption: "Respuesta observada durante el ensayo.", scale: 50 },
    { id: randomUUID(), type: "table", heading: "Resultados y discusión", caption: "Resultados principales del experimento.", cells: [["Tratamiento", "Resultado"], ["Control", "8.3"], ["A", "12.1"]] },
    { id: randomUUID(), type: "text", heading: "Conclusiones", text: "El tratamiento A mostró la mejor respuesta." },
    { id: randomUUID(), type: "text", heading: "Referencias bibliográficas", text: "Pérez, A. (2020). Estudio experimental." },
  ],
};
const savedContent = await expectStatus(owner.request(`/api/lab/articles/${article.id}`, { method: "PATCH", body: content }), 200);
assert.equal(savedContent.blocks.length, 7);
assert.equal(savedContent.blocks.find(block => block.type === 'figure').scale, 50);
const reloadedContent = await expectStatus(owner.request(`/api/lab/articles/${article.id}`), 200);
assert.equal(reloadedContent.blocks.find(block => block.type === 'figure').scale, 50);
assert.equal(savedContent.generatedAt, null);
const generated = await expectStatus(owner.request(`/api/lab/articles/${article.id}/generate`, { method: "POST", body: {} }), 200);
assert.equal(generated.figureCount, 1);
assert.equal(generated.tableCount, 1);
assert(generated.pageCount >= 1 && generated.pageCount < 3, `Páginas inesperadas: ${generated.pageCount}`);
assert.equal(generated.status, "requires_changes");
const publicPreview = await expectStatus(owner.request(`/api/lab/articles/${article.id}/editor-config`), 200);
assert.equal(publicPreview.config.document.permissions.edit, false);
const metadataOnly = await expectStatus(owner.request(`/api/lab/articles/${article.id}`, { method: "PATCH", body: { ...content, title: "Metadata independiente" } }), 200);
assert.equal(metadataOnly.documentKey, generated.documentKey);
assert.equal(metadataOnly.generatedAt, generated.generatedAt);
assert.equal(metadataOnly.contentRevision, generated.contentRevision);
assert.notEqual(metadataOnly.previewKey, generated.previewKey);
const changedPreview = await expectStatus(owner.request(`/api/lab/articles/${article.id}/editor-config`), 200);
assert.notEqual(changedPreview.config.document.key, publicPreview.config.document.key);
const previewFile = new URL(changedPreview.config.document.url);
const previewDownload = await owner.request(previewFile.pathname + previewFile.search);
assert.equal(previewDownload.response.status, 200);
const metadataPreviewText = (await mammoth.extractRawText({buffer:previewDownload.payload})).value;
assert(metadataPreviewText.includes('METADATA INDEPENDIENTE'), metadataPreviewText.slice(0, 250));
await expectStatus(owner.request(`/api/lab/articles/${article.id}`, { method: "PATCH", body: content }), 200);
const shortFinalization = await expectStatus(owner.request(`/api/lab/articles/${article.id}/finalize`, { method: "POST", body: {} }), 422);
assert(shortFinalization.details.some(message => message.includes("mínimo requerido es 3")));
const paragraph = "Se analizaron muestras agrícolas y se compararon los resultados mediante observaciones repetidas. ".repeat(8);
const validContent = { ...content, introduction: Array.from({ length: 12 }, (_, index) => `Párrafo ${index + 1}. ${paragraph}`).join("\n") };
await expectStatus(owner.request(`/api/lab/articles/${article.id}`, { method: "PATCH", body: validContent }), 200);
const validGenerated = await expectStatus(owner.request(`/api/lab/articles/${article.id}/generate`, { method: "POST", body: {} }), 200);
assert(validGenerated.pageCount >= 3 && validGenerated.pageCount <= 5);
await expectStatus(owner.request(`/api/lab/articles/${article.id}/finalize`, { method: "POST", body: {} }), 200);

const oversized = { ...content, introduction: Array.from({ length: 320 }, (_, index) => `Párrafo ${index + 1}. ` + "contenido científico ".repeat(15)).join("\n") };
await expectStatus(owner.request(`/api/lab/articles/${article.id}`, { method: "PATCH", body: oversized }), 200);
const oversizedGenerated = await expectStatus(owner.request(`/api/lab/articles/${article.id}/generate`, { method: "POST", body: {} }), 200);
assert(oversizedGenerated.pageCount > 5);
assert.equal(oversizedGenerated.status, "requires_changes");
await expectStatus(owner.request(`/api/lab/articles/${article.id}/finalize`, { method: "POST", body: {} }), 422);
await expectStatus(owner.request(`/api/lab/articles/${article.id}`, { method: "PATCH", body: validContent }), 200);
const finalGenerated = await expectStatus(owner.request(`/api/lab/articles/${article.id}/generate`, { method: "POST", body: {} }), 200);
assert(finalGenerated.pageCount >= 3 && finalGenerated.pageCount <= 5);
await expectStatus(owner.request(`/api/lab/articles/${article.id}/duplicate`, { method: "POST", body: {} }), 404);

assert(adminEmail && adminPassword, "Faltan variables de administrador para la integración.");
await expectStatus(admin.request("/api/lab/admin/login", { method: "POST", body: { email: adminEmail, password: adminPassword } }), 200);
const results = await expectStatus(admin.request(`/api/lab/admin/articles?q=${article.publicReference}`), 200);
assert.equal(results.length, 1);
const detail = await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}`), 200);
assert.equal(detail.article.publicReference, article.publicReference);

const download = await admin.request(`/api/lab/admin/articles/${article.id}/download`);
assert.equal(download.response.status, 200);
assert.equal(download.payload[0], 0x50);
assert.equal(download.payload[1], 0x4b);
const generatedText = (await mammoth.extractRawText({ buffer: download.payload })).value;
for (const expected of ["Introducción", "Figura 1.", "Cuadro 1."]) {
  assert(generatedText.includes(expected), `El DOCX no contiene: ${expected}`);
}
for (const metadataValue of [content.title.toLocaleUpperCase('es-MX'), "Palabras clave:", "Autor Principal", "frutales, algas verdes", 'Resultados y discusión']) {
  assert(generatedText.includes(metadataValue), `Falta información en el documento final: ${metadataValue}`);
}

await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}/temporary-access`, { method: "POST", body: {} }), 404);

const emergency = await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}/emergency-access`, { method: "POST", body: { reason: "Intervención excepcional de prueba automatizada" } }), 200);
assert.equal(emergency.config.document.permissions.edit, true);
const bodyUrl = new URL(emergency.config.document.url);
const bodyDownload = await admin.request(bodyUrl.pathname + bodyUrl.search);
const bodyText = (await mammoth.extractRawText({buffer:bodyDownload.payload})).value;
for (const metadataValue of [content.title.toLocaleUpperCase('es-MX'),'Palabras clave:','Autor Principal']) assert(!bodyText.includes(metadataValue));
const viewConfig = await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}/editor-config`), 200);
assert.equal(viewConfig.config.document.permissions.edit, false);

const generatedVersion = detail.versions.find((item) => item.pageCount && item.restorable);
assert(generatedVersion, "No se encontró una versión generada restaurable.");
const restore = await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}/versions/${generatedVersion.version}/restore`, { method: "POST", body: { reason: "Restauración segura automatizada de la versión generada" } }), 200);
assert(restore.createdVersion > 1);
assert.equal(restore.article.blocks.find(block => block.type === 'figure').scale, 50);
const versionDownload = await admin.request(`/api/lab/admin/articles/${article.id}/versions/1/download`);
assert.equal(versionDownload.response.status, 200);
assert.equal(versionDownload.payload[0], 0x50);
const revoked = await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}/revoke-sessions`, { method: "POST", body: { reason: "Revocación completa durante prueba automatizada" } }), 200);
assert(revoked.revokedCount >= 2);
await expectStatus(recovered.request(`/api/lab/articles/${article.id}`), 403);

await expectStatus(admin.request(`/api/lab/admin/articles/${article.id}/recovery`, { method: "POST", body: {} }), 404);
await expectStatus(new Client().request("/api/lab/recover/code", { method: "POST", body: { code: article.publicReference } }), 200);

const audit = await expectStatus(admin.request("/api/lab/admin/audit"), 200);
for (const action of ["ADMIN_LOGIN", "VIEW_ARTICLE", "DOWNLOAD_DOCUMENT", "VIEW_VERSION", "EMERGENCY_ACCESS", "OPEN_DOCUMENT", "RESTORE_VERSION", "REVOKE_SESSIONS"]) {
  assert(audit.some((row) => row.action === action), `Falta auditoría ${action}`);
}

let limited = false;
for (let attempt = 0; attempt < 12; attempt += 1) {
  const result = await stranger.request("/api/lab/recover/code", { method: "POST", body: { code: `ZZZZ-ZZZZ-${String(attempt).padStart(2, "2")}` } });
  if (result.response.status === 429) { limited = true; break; }
}
assert.equal(limited, true, "El rate limiting no bloqueó intentos repetidos.");

process.stdout.write(JSON.stringify({ ok: true, articleId: article.id, publicReference: article.publicReference, pages: finalGenerated.pageCount, figures: finalGenerated.figureCount, tables: finalGenerated.tableCount, auditRows: audit.length, restoredVersion: restore.createdVersion }) + "\n");
