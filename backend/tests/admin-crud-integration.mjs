import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.LAB_API_URL || "http://localhost:3200";
const email = process.env.ADMIN_EMAIL || process.env.TRABAJOS_ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD || process.env.TRABAJOS_ADMIN_PASSWORD;
assert(email && password, "Faltan credenciales administrativas para la prueba de integración.");

class Client {
  constructor() { this.cookies = new Map(); }
  async request(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (this.cookies.get("trabajos_admin_csrf")) headers["x-admin-csrf"] = this.cookies.get("trabajos_admin_csrf");
    if (this.cookies.get("trabajos_csrf")) headers["x-trabajos-csrf"] = this.cookies.get("trabajos_csrf");
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const value of response.headers.getSetCookie?.() || []) {
      const [pair] = value.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      if (value.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, decodeURIComponent(pair.slice(index + 1)));
    }
    const payload = response.status === 204 ? null : await response.json();
    return { status: response.status, payload };
  }
}

const admin = new Client();
const guest = new Client();
assert.equal((await guest.request("/api/lab/admin/summary")).status, 401);
assert.equal((await guest.request("/api/lab/admin/articles", { method: "POST", body: {} })).status, 401);
assert.equal((await admin.request("/api/lab/admin/login", { method: "POST", body: { email, password } })).status, 200);

const initial = await admin.request("/api/lab/admin/summary");
assert.equal(initial.status, 200);
assert.equal((await admin.request("/api/lab/admin/articles", { method: "POST", body: { title: "Sin autores", authors: [], keywords: [] } })).status, 422);

let created;
try {
  const response = await admin.request("/api/lab/admin/articles", { method: "POST", body: {
    title: "Prueba CRUD administrativa", mesa: "PE", authors: [{ firstName: "Autora", lastName: "Prueba", email: "autora@example.test", institution: "Institución de prueba", orcid: "", isCorresponding: true }], keywords: ["Prueba"],
  } });
  assert.equal(response.status, 201, JSON.stringify(response.payload));
  created = response.payload.article;
  assert.match(created.publicReference, /^RCT-[CDFHJKMNRUVWXY3479]{4}-[CDFHJKMNRUVWXY3479]{2}$/);
  assert.equal(response.payload.recovery, undefined);
  assert.equal((await guest.request(`/api/lab/admin/articles/${created.id}`)).status, 401);
  const listed = await admin.request(`/api/lab/admin/articles?q=${created.publicReference}`);
  assert.equal(listed.status, 200);
  assert(listed.payload.some((item) => item.id === created.id));
  const paginated = await admin.request(`/api/lab/admin/articles?status=draft&page=1&pageSize=2`);
  assert.equal(paginated.status, 200);
  assert.equal(paginated.payload.page, 1);
  assert.equal(paginated.payload.items.length, Math.min(2, paginated.payload.total));
  assert(paginated.payload.items.every((item) => item.status === "draft"));
  if (paginated.payload.total > 2) {
    const secondPage = await admin.request(`/api/lab/admin/articles?status=draft&page=2&pageSize=2`);
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.payload.page, 2);
    assert(!secondPage.payload.items.some((item) => paginated.payload.items.some((first) => first.id === item.id)));
  }
  const oneMatch = await admin.request(`/api/lab/admin/articles?q=${created.publicReference}&page=1&pageSize=10`);
  assert.equal(oneMatch.payload.total, 1);
  assert.equal(oneMatch.payload.items[0].id, created.id);
  const detail = await admin.request(`/api/lab/admin/articles/${created.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.article.title, created.title);
  assert.equal((await admin.request("/api/lab/admin/summary")).payload.total, initial.payload.total + 1);

  const owner = new Client();
  assert.equal((await owner.request("/api/lab/recover/code", { method: "POST", body: { code: created.publicReference.toLowerCase() } })).status, 200);
  const bodyBlocks = [{ id: randomUUID(), type: "text", heading: "Materiales y métodos", text: "Contenido que debe conservarse al editar los datos desde administración." }];
  const savedBody = await owner.request(`/api/lab/articles/${created.id}`, { method: "PATCH", body: {
    title: created.title, mesa: created.mesa, authors: created.authors, keywords: created.keywords, introduction: "Introducción conservada", blocks: bodyBlocks,
  } });
  assert.equal(savedBody.status, 200, JSON.stringify(savedBody.payload));
  const currentDetail = await admin.request(`/api/lab/admin/articles/${created.id}`);
  assert.equal(currentDetail.status, 200);

  const update = await admin.request(`/api/lab/admin/articles/${created.id}`, { method: "PATCH", body: {
    title: "Prueba CRUD actualizada", mesa: "FO", authors: [{ firstName: "Autora", lastName: "Actualizada", email: "autora@example.test", institution: "Institución de prueba", orcid: "", isCorresponding: true }], keywords: ["Administración", "Prueba"], updatedAt: currentDetail.payload.article.updatedAt,
  } });
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.equal(update.payload.title, "Prueba CRUD actualizada");
  assert.equal(update.payload.mesa, "FO");
  assert.equal(update.payload.authors[0].lastName, "Actualizada");
  assert.deepEqual(update.payload.blocks, currentDetail.payload.article.blocks);
  assert.equal(update.payload.introduction, "Introducción conservada");
  assert.equal((await admin.request(`/api/lab/admin/articles/${created.id}`, { method: "PATCH", body: { title: "Prueba", authors: update.payload.authors, keywords: [], updatedAt: "bad-date" } })).status, 422);
  assert.equal((await admin.request(`/api/lab/admin/articles/${created.id}`, { method: "DELETE", body: { confirmReference: "incorrecta" } })).status, 422);
  assert.equal((await guest.request(`/api/lab/admin/articles/${created.id}`, { method: "DELETE", body: { confirmReference: created.publicReference } })).status, 401);

  const removed = await admin.request(`/api/lab/admin/articles/${created.id}`, { method: "DELETE", body: { confirmReference: created.publicReference } });
  assert.equal(removed.status, 204, JSON.stringify(removed.payload));
  created = null;
  assert.equal((await admin.request(`/api/lab/admin/articles/${detail.payload.article.id}`)).status, 404);
  assert.equal((await admin.request("/api/lab/admin/summary")).payload.total, initial.payload.total);
  const audit = await admin.request("/api/lab/admin/audit");
  const actions = audit.payload.filter((item) => item.publicReference === detail.payload.article.publicReference).map((item) => item.action);
  for (const action of ["CREATE_ARTICLE", "UPDATE_ARTICLE", "DELETE_ARTICLE"]) assert(actions.includes(action), action);
  process.stdout.write("CRUD administrativo: creación, consulta, edición, eliminación, permisos y auditoría correctos.\n");
} finally {
  if (created) await admin.request(`/api/lab/admin/articles/${created.id}`, { method: "DELETE", body: { confirmReference: created.publicReference } });
}
