import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import pg from "pg";

const apiUrl = process.env.LAB_API_URL || "http://localhost:4200";
const callbackBaseUrl = process.env.ONLYOFFICE_CALLBACK_BASE_URL || apiUrl;
const onlyofficeUrl = process.env.ONLYOFFICE_INTERNAL_URL;
const onlyofficeSecret = process.env.ONLYOFFICE_JWT_SECRET;
const documentSecret = process.env.DOCUMENT_TOKEN_SECRET;
assert(onlyofficeUrl && onlyofficeSecret && documentSecret, "Falta configuración ONLYOFFICE para la prueba.");

const db = new pg.Client({
  host: process.env.DB_HOST ,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER ,
  password: process.env.DB_PASSWORD ,
  database: process.env.DB_NAME ,
});

await db.connect();
try {
  const {rows: articles} = await db.query(
    "SELECT id, document_key, document_storage_path FROM trabajos_articles WHERE generated_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1",
  );
  assert(articles.length, "No existe un documento generado para probar el callback.");
  const article = articles[0];
  const login = await fetch(`${apiUrl}/api/lab/admin/login`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}),
  });
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie().map(c=>c.split(';')[0]);
  const csrf = cookies.find(c=>c.startsWith('trabajos_admin_csrf=')).split('=')[1];
  const emergency = await fetch(`${apiUrl}/api/lab/admin/articles/${article.id}/emergency-access`, {
    method:'POST', headers:{'content-type':'application/json',cookie:cookies.join('; '),'x-admin-csrf':csrf},
    body:JSON.stringify({reason:'Validación automatizada del callback real'}),
  }).then(r=>r.json());
  const callbackUrl = emergency.config.editorConfig.callbackUrl;
  const sourceToken = jwt.sign({
    purpose: "generation-source",
    articleId: article.id,
    documentKey: article.document_key,
    storagePath: article.document_storage_path,
  }, documentSecret, { algorithm: "HS256", expiresIn: "10m" });
  const conversion = {
    async: false,
    filetype: "docx",
    key: `callback-test-${Date.now()}`,
    outputtype: "docx",
    title: "callback-test.docx",
    url: `${callbackBaseUrl}/api/documents/${article.id}/file?token=${encodeURIComponent(sourceToken)}`,
  };
  const conversionToken = jwt.sign(conversion, onlyofficeSecret, { algorithm: "HS256", expiresIn: "10m" });
  const converted = await fetch(`${onlyofficeUrl}/converter?shardkey=${encodeURIComponent(conversion.key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: conversionToken }),
  }).then((response) => response.json());
  assert(converted.fileUrl, `ONLYOFFICE no devolvió fileUrl: ${JSON.stringify(converted)}`);

  const callbackBody = { key: article.document_key, status: 2, url: converted.fileUrl };
  const callbackToken = jwt.sign(callbackBody, onlyofficeSecret, { algorithm: "HS256", expiresIn: "10m" });
  const tampered = await fetch(callbackUrl, {
    method: 'POST', headers:{'content-type':'application/json',authorization:`Bearer ${callbackToken}`},
    body:JSON.stringify({...callbackBody,url:'http://postgres:5432/'}),
  }).then(r=>r.json());
  assert.equal(tampered.error, 1, 'Debe rechazar una URL distinta a la firmada');
  const callback = await fetch(callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${callbackToken}` },
    body: JSON.stringify(callbackBody),
  }).then((response) => response.json());
  assert.equal(callback.error, 0, JSON.stringify(callback));

  const {rows: versions} = await db.query(
    "SELECT COUNT(*) AS count FROM trabajos_document_versions WHERE article_id = $1",
    [article.id],
  );
  assert(Number(versions[0].count) >= 2);
  process.stdout.write(`${JSON.stringify({ ok: true, articleId: article.id, versionCount: Number(versions[0].count) })}\n`);
} finally {
  await db.end();
}
