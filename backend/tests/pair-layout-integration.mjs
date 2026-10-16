import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
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
  assert.equal(response.status, method === 'POST' && ['/api/lab/articles', '/assets'].some((value) => path.endsWith(value)) ? 201 : method === 'DELETE' ? 204 : 200, JSON.stringify(result));
  return result;
}

const created = await request('/api/lab/articles', 'POST', {});
const articleId = created.article.id;
const articlePath = `/api/lab/articles/${articleId}`;
try {
  const archive = await JSZip.loadAsync(await readFile(new URL('../templates/plantilla.docx', import.meta.url)));
  const jpeg = await archive.file('word/media/image1.jpeg').async('nodebuffer');
  const upload = async (number) => request(`${articlePath}/assets`, 'POST', {
    fileName: `grafica-${number}.jpg`,
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
  });
  const first = await upload(1);
  const second = await upload(2);
  const third = await upload(3);
  const content = {
    title: 'Prueba de dos figuras en una fila',
    mesa: 'AG',
    authors: created.article.authors,
    keywords: [],
    introduction: 'Resumen de prueba.',
    blocks: [
      { id: randomUUID(), type: 'text', heading: 'Objetivos', text: 'Comparar las figuras del ensayo.' },
      { id: randomUUID(), type: 'text', heading: 'Materiales y métodos', text: 'Se comparan los resultados de tres figuras.' },
      { id: randomUUID(), type: 'figure', assetId: first.id, caption: 'Primera figura.', pairWithNext: true },
      { id: randomUUID(), type: 'figure', assetId: second.id, caption: 'Segunda figura.', scale: 50 },
      { id: randomUUID(), type: 'text', heading: 'Resultados y discusión', text: 'La tercera figura confirma la tendencia observada.' },
      { id: randomUUID(), type: 'figure', heading: 'Resultados y discusión', assetId: third.id, caption: 'Tercera figura.' },
      { id: randomUUID(), type: 'text', heading: 'Conclusiones', text: 'Los tratamientos fueron comparables.' },
      { id: randomUUID(), type: 'text', heading: 'Referencias bibliográficas', text: 'Pérez, A. (2020). Ensayo de referencia.' },
    ],
  };
  const saved = await request(articlePath, 'PATCH', content);
  assert.equal(saved.blocks[2].pairWithNext, true);
  assert.equal(saved.blocks[3].pairWithNext, false);
  const reloaded = await request(articlePath);
  assert.equal(reloaded.blocks[2].pairWithNext, true);
  const generated = await request(`${articlePath}/generate`, 'POST', {});
  assert.equal(generated.figureCount, 3);
  assert(generated.pageCount >= 1 && generated.pageCount <= 5);
  const preview = await request(`${articlePath}/preview.pdf`);
  assert.equal((await PDFDocument.load(preview)).getPageCount(), generated.pageCount);
  if (process.env.LAB_PAIR_PDF_OUTPUT) await writeFile(process.env.LAB_PAIR_PDF_OUTPUT, preview);
  console.log(JSON.stringify({ ok: true, pageCount: generated.pageCount, figureCount: generated.figureCount, pairPersisted: true }));
} finally {
  await request(articlePath, 'DELETE');
}
