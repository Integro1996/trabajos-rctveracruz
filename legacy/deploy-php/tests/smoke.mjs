import assert from 'node:assert/strict';

const base = process.env.VPS_TEST_URL;
const email = process.env.VPS_TEST_ADMIN_EMAIL;
const password = process.env.VPS_TEST_ADMIN_PASSWORD;
assert(base && email && password, 'Set VPS_TEST_URL, VPS_TEST_ADMIN_EMAIL and VPS_TEST_ADMIN_PASSWORD for an isolated test environment.');

class Client {
  cookies = new Map();
  async request(path, { method = 'GET', body, csrf = true, redirect = 'follow' } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf) {
      for (const [cookie, header] of [['trabajos_csrf', 'x-trabajos-csrf'], ['trabajos_admin_csrf', 'x-admin-csrf']]) {
        if (this.cookies.has(cookie)) headers[header] = decodeURIComponent(this.cookies.get(cookie));
      }
    }
    const response = await fetch(`${base}${path}`, { method, headers, redirect, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const payload = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
    return { response, payload };
  }
}
async function ok(result, status = 200) {
  const { response, payload } = await result;
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
}

const guest = new Client();
for (const path of ['/', '/admin']) {
  const { response, payload } = await guest.request(path);
  assert.equal(response.status, 200);
  assert.match(payload, /<div id="root">/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
}
for (const path of ['/.env', '/api/composer.json', '/api/config/Config.php', '/api/database/schema.sql', '/api/vendor/autoload.php']) {
  assert.equal((await guest.request(path)).response.status, 404, path);
}
assert((await ok(guest.request('/api/lab/config'))).limits);
assert.equal((await guest.request('/api/lab/admin/articles')).response.status, 401);

const owner = new Client();
const created = await ok(owner.request('/api/lab/articles', { method: 'POST', body: {} }), 201);
assert.match(created.article.publicReference, /^ART-/);
assert.match(created.recovery.qrDataUrl, /^data:image\/svg\+xml;base64,/);
const path = `/api/lab/articles/${created.article.id}`;
const content = {
  title: 'Prueba del despliegue VPS',
  authors: created.article.authors.map(({ position, id, ...author }) => author),
  keywords: ['prueba'],
  introduction: 'Contenido guardado desde el gateway.',
  blocks: [],
};
assert.equal((await owner.request(path, { method: 'PATCH', body: content, csrf: false })).response.status, 403);
await ok(owner.request(path, { method: 'PATCH', body: content }));
assert((await ok(owner.request('/api/lab/articles'))).some(row => row.id === created.article.id));

const recovered = new Client();
const recovery = await ok(recovered.request('/api/lab/recover/code', { method: 'POST', body: { code: created.recovery.code } }));
assert.equal(recovery.article.id, created.article.id);
const qr = await new Client().request(new URL(created.recovery.recoveryUrl).pathname, { redirect: 'manual' });
assert.equal(qr.response.status, 303);

const admin = new Client();
await ok(admin.request('/api/lab/admin/login', { method: 'POST', body: { email, password } }));
assert((await ok(admin.request('/api/lab/admin/session'))).authenticated);
assert((await ok(admin.request('/api/lab/admin/articles'))).some(row => row.id === created.article.id));
await ok(admin.request('/api/lab/admin/logout', { method: 'POST', body: {} }), 204);
assert.equal((await admin.request('/api/lab/admin/articles')).response.status, 401);
console.log(JSON.stringify({ ok: true, articleId: created.article.id, checks: 'SPA, private paths, API, CSRF, create, save, recovery, QR, admin, logout' }));
