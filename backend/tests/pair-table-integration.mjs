import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const base = process.env.LAB_API_URL || 'http://127.0.0.1:3200';
const cookies = new Map();

async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      'x-trabajos-csrf': cookies.get('trabajos_csrf') || '',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const result = response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, result };
}

const created = await request('/api/lab/articles', 'POST', {});
assert.equal(created.status, 201);
const articleId = created.result.article.id;
const articlePath = `/api/lab/articles/${articleId}`;
try {
  const content = {
    title: 'Prueba de dos tablas en una fila',
    mesa: 'AG',
    authors: created.result.article.authors,
    keywords: [],
    introduction: 'Resumen de prueba.',
    blocks: [
      { id: randomUUID(), type: 'text', heading: 'Objetivos', text: 'Comparar los cuadros del ensayo.' },
      { id: randomUUID(), type: 'text', heading: 'Materiales y métodos', text: 'Los datos se presentan en tres tablas.' },
      { id: randomUUID(), type: 'table', caption: 'Primer ensayo.', pairWithNext: true, cells: [['Medio', 'Día', 'Valor', 'Grupo'], ['F2', '1', '4.2', 'A'], ['BF', '2', '5.1', 'B']] },
      { id: randomUUID(), type: 'table', caption: 'Segundo ensayo con una descripción algo más extensa para comprobar la alineación.', cells: [['Especie', 'Valor'], ['T. chuii', '8.3']] },
      { id: randomUUID(), type: 'text', heading: 'Resultados y discusión', text: 'La tercera tabla reúne los datos adicionales.' },
      { id: randomUUID(), type: 'table', heading: 'Resultados y discusión', caption: 'Datos adicionales.', cells: [['Dato'], ['9.2']] },
      { id: randomUUID(), type: 'text', heading: 'Conclusiones', text: 'Los datos son consistentes.' },
      { id: randomUUID(), type: 'text', heading: 'Referencias bibliográficas', text: 'Pérez, A. (2020). Ensayo de referencia.' },
    ],
  };
  const saved = await request(articlePath, 'PATCH', content);
  assert.equal(saved.status, 200, JSON.stringify(saved.result));
  assert.equal(saved.result.blocks[2].pairWithNext, true);
  const reloaded = await request(articlePath);
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.result.blocks[2].pairWithNext, true);
  const generated = await request(`${articlePath}/generate`, 'POST', {});
  assert.equal(generated.status, 200, JSON.stringify(generated.result));
  assert.equal(generated.result.tableCount, 3);
  assert(generated.result.pageCount >= 1 && generated.result.pageCount <= 5);
  const preview = await request(`${articlePath}/preview.pdf`);
  assert.equal(preview.status, 200);
  assert.equal((await PDFDocument.load(preview.result)).getPageCount(), generated.result.pageCount);
  if (process.env.LAB_TABLE_PDF_OUTPUT) await writeFile(process.env.LAB_TABLE_PDF_OUTPUT, preview.result);

  const wide = { ...content, blocks: content.blocks.map((block, index) => index === 3 ? { ...block, cells: [['A', 'B', 'C', 'D', 'E']] } : block) };
  const rejected = await request(articlePath, 'PATCH', wide);
  assert.equal(rejected.status, 422);
  assert(JSON.stringify(rejected.result).includes('anchura'));
  const solo = await request(articlePath, 'PATCH', { ...wide, blocks: wide.blocks.map((block, index) => index === 2 ? { ...block, pairWithNext: false } : block) });
  assert.equal(solo.status, 200, JSON.stringify(solo.result));
  console.log(JSON.stringify({ ok: true, pageCount: generated.result.pageCount, tableCount: generated.result.tableCount, widthLimitEnforced: true }));
} finally {
  const deleted = await request(articlePath, 'DELETE');
  assert.equal(deleted.status, 204);
}
