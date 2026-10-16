import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--proxy-bypass-list=*'],
});

let page;
let createdArticleId;
try {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const frontendUrl = process.env.LAB_FRONTEND_URL || 'http://localhost:3200';
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  if ((await page.title()).startsWith('Aviso:')) {
    await page.evaluate(() => [...document.querySelectorAll('button, input, a')].find(element => (element.textContent || element.value || '').trim() === 'Continuar')?.click());
    await new Promise(resolve => setTimeout(resolve, 5000));
    await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('#root main', { timeout: 30000 }).catch(async error => {
    process.stderr.write(JSON.stringify({ title: await page.title(), url: page.url(), body: (await page.$eval('body', element => element.textContent)).slice(0, 500), errors }) + '\n');
    throw error;
  });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Crear trabajo'))?.click());
  await page.waitForSelector('.recovery-card');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Continuar mi trabajo'))?.click());
  await page.waitForSelector('#article-introduction');
  await page.click('input[name="article-mesa"][value="AG"]');
  const articleId = new URL(page.url()).searchParams.get('article');
  createdArticleId = articleId;

  for (const [selector, value] of [
    ['#article-title', 'Ensayo de ecuaciones'],
    ['.author-card:first-child .author-grid label:nth-child(1) input', 'Ana'],
    ['.author-card:first-child .author-grid label:nth-child(2) input', 'Pérez'],
    ['.author-card:first-child .author-grid label:nth-child(3) input', 'ana@example.test'],
    ['.author-card:first-child .author-grid label:nth-child(4) input', 'Instituto de prueba'],
  ]) {
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.type(value);
  }
  await page.type('#article-introduction', 'Introducción breve para comprobar el uso de ecuaciones.');
  for (const section of ['Materiales y métodos', 'Resultados y discusión', 'Conclusiones', 'Referencias bibliográficas']) {
    await page.type(`[id="section-${section}"] .required-section-text textarea`, `Contenido de prueba para ${section}.`);
  }
  await page.click('[id="section-Introducción"] .section-add-button');
  await page.evaluate(() => [...document.querySelectorAll('[id="section-Introducción"] .section-add-menu button')].find(button => button.textContent === 'Fórmula')?.click());
  await page.waitForSelector('[id="section-Introducción"] .content-block.formula math-field');
  await page.evaluate(() => customElements.whenDefined('math-field'));
  assert(await page.$eval('.content-block.formula math-field', field => !field.menuItems.some(item =>
    ['color', 'foreground-color', 'background-color'].includes(item.id)
    || item.submenu?.some(option => option.id === 'decoration-red-box'))));
  await page.evaluate(() => {
    const field = document.querySelector('.content-block.formula math-field');
    field.value = String.raw`\frac{\placeholder{}}{2}`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Generar trabajo')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('.content-block.formula .field-error')].some(element => element.textContent.includes('Completa los recuadros vacíos')));
  assert(!await page.$eval('.content-block.formula', element => element.textContent.includes('todavía no es compatible')));
  await page.evaluate(() => {
    const field = document.querySelector('.content-block.formula math-field');
    field.value = String.raw`\textcolor{red}{x}+\colorbox{yellow}{y}`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const value = document.querySelector('.content-block.formula math-field').value;
    return value.includes('x') && value.includes('y') && !/\\(?:color|textcolor|colorbox)/u.test(value);
  });
  await page.evaluate(() => [...document.querySelectorAll('.content-block.formula button')].find(button => button.textContent?.includes('tasa de crecimiento'))?.click());
  await page.waitForFunction(() => document.querySelector('.content-block.formula math-field')?.value?.includes('\\frac'));
  await page.evaluate(() => {
    const field = document.querySelector('.content-block.formula math-field');
    field.value += '+1';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('.content-block.formula math-field')?.value?.endsWith('+1'));
  await page.type('.content-block.formula .formula-description-field textarea', 'μ = tasa de crecimiento específico; Δt = intervalo de tiempo.');
  await page.click('.content-block.formula .add-second-formula');
  await page.waitForSelector('.content-block.formula .second-formula math-field');
  await page.evaluate(() => [...document.querySelectorAll('.second-formula .formula-examples button')].find(button => button.textContent?.includes('tiempo de duplicación'))?.click());
  await page.type('.second-formula .formula-description-field textarea', 'Td = tiempo de duplicación; μ = tasa de crecimiento específico.');
  await page.evaluate(() => {
    const field = document.querySelector('.second-formula math-field');
    field.value = String.raw`T_d=\frac{\placeholder[numerador]{\log 2}}{\mu}`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('.second-formula math-field')?.value?.includes('\\frac'));
  await page.waitForSelector('.save-state.saved', { timeout: 30000 }).catch(async error => {
    console.error(JSON.stringify(await page.evaluate(() => ({
      save: document.querySelector('.save-state')?.textContent,
      summary: document.querySelector('.document-summary')?.textContent.slice(0, 300),
      errors: [...document.querySelectorAll('.field-error, .alert.error')].map(node => node.textContent).slice(0, 10),
      author: [...document.querySelectorAll('.author-card:first-child .author-grid input')].map(input => input.value),
      formula: document.querySelector('.second-formula math-field')?.value,
    }))));
    throw error;
  });

  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Generar trabajo')?.click());
  await page.waitForSelector('.editor-frame iframe[src*="/preview.pdf"]', { timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('.editor-footer')?.textContent.includes('Vista previa: Lista'), { timeout: 90000 });
  const response = await page.evaluate(async () => {
    const result = await fetch(`/api/lab/articles/${new URLSearchParams(location.search).get('article')}/preview.pdf`);
    return { status: result.status, type: result.headers.get('content-type'), bytes: (await result.arrayBuffer()).byteLength };
  });
  assert.equal(response.status, 200);
  assert(response.type.includes('application/pdf'));
  assert(response.bytes > 1000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.content-block.formula math-field', { timeout: 30000 });
  await page.evaluate(() => customElements.whenDefined('math-field'));
  assert(await page.$eval('.content-block.formula math-field', element => element.value.includes('\\frac') && element.value.endsWith('+1')));
  assert(await page.$eval('.second-formula math-field', element => element.value.includes('\\frac')));
  assert(await page.$eval('.formula-pair-option input', element => element.checked));
  assert.equal(await page.$$eval('.formula-description-field textarea', elements => elements.filter(element => element.value.length > 10).length), 2);
  const screenshotPath = process.env.LAB_FORMULA_SCREENSHOT_PATH || join(tmpdir(), 'formula-smoke.png');
  await (await page.$('.content-block.formula')).screenshot({ path: screenshotPath });
  assert.deepEqual(errors, []);
  const deleted = await page.evaluate(async () => {
    const csrf = document.cookie.split('; ').find(item => item.startsWith('trabajos_csrf='))?.split('=')[1];
    return (await fetch(`/api/lab/articles/${new URLSearchParams(location.search).get('article')}`, { method: 'DELETE', headers: { 'x-trabajos-csrf': decodeURIComponent(csrf || '') } })).status;
  });
  assert.equal(deleted, 204);
  createdArticleId = null;
  process.stdout.write(JSON.stringify({ preview: response, formulas: 2, paired: true, persisted: true, cleaned: true, screenshotPath }) + '\n');
} finally {
  if (createdArticleId && page && !page.isClosed()) {
    await page.evaluate(async id => {
      const csrf = document.cookie.split('; ').find(item => item.startsWith('trabajos_csrf='))?.split('=')[1];
      await fetch(`/api/lab/articles/${id}`, { method: 'DELETE', headers: { 'x-trabajos-csrf': decodeURIComponent(csrf || '') } });
    }, createdArticleId).catch(() => {});
  }
  await browser.close();
}
