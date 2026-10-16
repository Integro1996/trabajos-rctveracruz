import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.LAB_API_URL || "http://127.0.0.1:3200";
const cookies = new Map();

async function request(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      "x-trabajos-csrf": cookies.get("trabajos_csrf") || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0];
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

const { data: config } = await request("/api/lab/config");
assert.equal(config.limits.minPages, 3);
assert.equal(config.limits.maxPages, 5);
const created = await request("/api/lab/articles", "POST", {});
assert.equal(created.status, 201, JSON.stringify(created.data));
const path = `/api/lab/articles/${created.data.article.id}`;
const block = (heading, text) => ({ id: randomUUID(), type: "text", heading, text });
const content = {
  title: "Prueba de extensión del trabajo",
  mesa: "AG",
  authors: created.data.article.authors,
  keywords: [],
  introduction: "Contexto del estudio.\n\n",
  blocks: [
    block("Objetivos", "Evaluar los resultados.\n\n"),
    block("Materiales y métodos", "Se revisaron los datos."),
    block("Resultados y discusión", "Se analizaron los resultados."),
    block("Conclusiones", "El trabajo ofrece conclusiones."),
    block("Referencias bibliográficas", "Referencia de prueba."),
  ],
};

try {
  const saved = await request(path, "PATCH", content);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const short = await request(`${path}/generate`, "POST", {});
  assert.equal(short.status, 200, JSON.stringify(short.data));
  assert(short.data.pageCount < config.limits.minPages, `Se esperaban menos de tres páginas, hay ${short.data.pageCount}`);
  assert.equal(short.data.status, "requires_changes");
  const early = await request(`${path}/finalize`, "POST", {});
  assert.equal(early.status, 422, JSON.stringify(early.data));
  assert(early.data.details.some(message => message.includes("mínimo requerido es 3")));

  const paragraph = "Se analizaron muestras agrícolas y se compararon los resultados mediante observaciones repetidas. ".repeat(8);
  let valid;
  for (const count of [12, 16, 20]) {
    const expanded = { ...content, introduction: Array.from({ length: count }, (_, index) => `Párrafo ${index + 1}. ${paragraph}`).join("\n") + "\n\n" };
    assert.equal((await request(path, "PATCH", expanded)).status, 200);
    const generated = await request(`${path}/generate`, "POST", {});
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    if (generated.data.pageCount >= config.limits.minPages && generated.data.pageCount <= config.limits.maxPages) {
      valid = generated.data;
      break;
    }
  }
  assert(valid, "No se produjo un documento de entre tres y cinco páginas.");
  const finalized = await request(`${path}/finalize`, "POST", {});
  assert.equal(finalized.status, 200, JSON.stringify(finalized.data));
  assert.equal(finalized.data.status, "finalized");

  const oversized = { ...content, introduction: Array.from({ length: 120 }, (_, index) => `Párrafo ${index + 1}. ${paragraph}`).join("\n") };
  assert.equal((await request(path, "PATCH", oversized)).status, 200);
  const long = await request(`${path}/generate`, "POST", {});
  assert.equal(long.status, 200, JSON.stringify(long.data));
  assert(long.data.pageCount > config.limits.maxPages, `Se esperaban más de cinco páginas, hay ${long.data.pageCount}`);
  assert.equal(long.data.status, "requires_changes");
  const late = await request(`${path}/finalize`, "POST", {});
  assert.equal(late.status, 422, JSON.stringify(late.data));
  assert(late.data.details.some(message => message.includes("máximo permitido es 5")));
  console.log(JSON.stringify({ short: short.data.pageCount, valid: valid.pageCount, long: long.data.pageCount }));
} finally {
  const removed = await request(path, "DELETE");
  assert.equal(removed.status, 204);
}
