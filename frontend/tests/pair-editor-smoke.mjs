import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--proxy-bypass-list=*'],
});

let page;
let articleId;
try {
  page = await browser.newPage();
  await page.goto(process.env.LAB_FRONTEND_URL || 'http://127.0.0.1:3200', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root main');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Crear trabajo'))?.click());
  await page.waitForSelector('.recovery-card');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Continuar mi trabajo'))?.click());
  await page.waitForSelector('.blocks-card input[type="file"]');
  articleId = new URL(page.url()).searchParams.get('article');
  assert(articleId);

  const upload = async (number) => {
    await page.evaluate((index) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], `figura-${index}.png`, { type: 'image/png' }));
      const input = document.querySelector('.blocks-card input[type="file"]');
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, number);
    await page.waitForFunction(expected => document.querySelectorAll('.content-block.figure').length === expected, {}, number);
  };

  await upload(1);
  await page.evaluate(() => [...document.querySelectorAll('.block-add-toggle')].at(-1)?.click());
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '+ Imagen o figura')?.click());
  await upload(2);
  assert.equal(await page.$$('.figure-pair-option input').then(inputs => inputs.length), 1);
  await page.click('.figure-pair-option input');
  await page.waitForFunction(async id => {
    const response = await fetch(`/api/lab/articles/${id}`);
    const article = await response.json();
    const figures = article.blocks?.filter(block => block.type === 'figure');
    return figures?.length === 2 && figures[0].pairWithNext === true;
  }, { timeout: 15_000 }, articleId);

  await page.type('.content-block.figure .fixed-caption input', 'Descripción conservada');
  const scale = await page.$('.content-block.figure .figure-scale input[type="range"]');
  await scale.focus();
  await page.keyboard.press('Home');
  for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowRight');
  const oldAssetId = await page.evaluate(async id => {
    const article = await (await fetch(`/api/lab/articles/${id}`)).json();
    return article.blocks.find(block => block.type === 'figure').assetId;
  }, articleId);
  await page.waitForFunction(async id => {
    const article = await (await fetch(`/api/lab/articles/${id}`)).json();
    const figure = article.blocks.find(block => block.type === 'figure');
    return figure.caption === 'Descripción conservada' && figure.scale === 50 && figure.pairWithNext === true;
  }, { timeout: 15_000 }, articleId);

  const replaceButton = '.content-block.figure .figure-file-actions button';
  const replacementInput = '.blocks-card input[aria-label="Seleccionar figura de reemplazo"]';
  await page.evaluate(selector => document.querySelector(selector).click(), replaceButton);
  await page.evaluate(selector => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['archivo inválido'], 'invalido.txt', { type: 'text/plain' }));
    const input = document.querySelector(selector);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, replacementInput);
  await page.waitForFunction(() => [...document.querySelectorAll('.content-block.figure .field-error')].some(element => element.textContent.includes('PNG o JPEG')));
  assert.equal(await page.evaluate(async id => {
    const article = await (await fetch(`/api/lab/articles/${id}`)).json();
    return article.blocks.find(block => block.type === 'figure').assetId;
  }, articleId), oldAssetId);

  await page.evaluate(selector => document.querySelector(selector).click(), replaceButton);
  await page.evaluate(selector => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    canvas.getContext('2d').fillStyle = '#e53935';
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'reemplazo-rojo.png', { type: 'image/png' }));
    const input = document.querySelector(selector);
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, replacementInput);
  await page.waitForFunction(async (id, previousAssetId) => {
    const article = await (await fetch(`/api/lab/articles/${id}`)).json();
    const figures = article.blocks.filter(block => block.type === 'figure');
    return figures.length === 2 && figures[0].assetId !== previousAssetId && figures[0].asset.originalName === 'reemplazo-rojo.png'
      && figures[0].caption === 'Descripción conservada' && figures[0].scale === 50 && figures[0].pairWithNext === true;
  }, { timeout: 15_000 }, articleId, oldAssetId);
  assert.equal(await page.$$('.content-block.figure').then(figures => figures.length), 2);
  assert.equal(await page.$$('.content-block.figure .field-error').then(errors => errors.length), 0);

  const deleteButtons = await page.$$('.content-block.figure .danger-link');
  await deleteButtons[1].click();
  await page.waitForFunction(async id => {
    const response = await fetch(`/api/lab/articles/${id}`);
    const article = await response.json();
    const figures = article.blocks?.filter(block => block.type === 'figure');
    return figures?.length === 1 && figures[0].pairWithNext === false;
  }, { timeout: 15_000 }, articleId);

  const addTable = async (expectedCount) => {
    await page.evaluate(() => [...document.querySelectorAll('.block-add-toggle')].at(-1)?.click());
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '+ Cuadro')?.click());
    await page.waitForFunction(expected => document.querySelectorAll('.content-block.table').length === expected, {}, expectedCount);
  };
  await addTable(1);
  await addTable(2);
  assert.equal(await page.$$('.table-pair-option input').then(inputs => inputs.length), 1);
  await page.click('.table-pair-option input');
  await page.waitForFunction(async id => {
    const response = await fetch(`/api/lab/articles/${id}`);
    const article = await response.json();
    const tables = article.blocks?.filter(block => block.type === 'table');
    return tables?.length === 2 && tables[0].pairWithNext === true;
  }, { timeout: 15_000 }, articleId);

  const sizeInputs = await page.$$('.content-block.table .table-size-controls input');
  await sizeInputs[1].click({ clickCount: 3 });
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type('5');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => [...document.querySelectorAll('.content-block.table .field-error')].some(element => element.textContent.includes('anchura')));
  assert.equal(await page.$$('.table-pair-option input').then(inputs => inputs.length), 0);
  await page.waitForFunction(async id => {
    const response = await fetch(`/api/lab/articles/${id}`);
    const article = await response.json();
    const tables = article.blocks?.filter(block => block.type === 'table');
    return tables?.length === 2 && tables[0].cells[0].length === 5 && tables[0].pairWithNext === false;
  }, { timeout: 15_000 }, articleId);
  console.log(JSON.stringify({ ok: true, imageReplaced: true, pairedFiguresAndTables: true, wideTableWarning: true }));
} finally {
  if (articleId && page) {
    await page.evaluate(async id => {
      const csrf = document.cookie.split('; ').find(value => value.startsWith('trabajos_csrf='))?.split('=')[1] || '';
      await fetch(`/api/lab/articles/${id}`, { method: 'DELETE', headers: { 'x-trabajos-csrf': csrf } });
    }, articleId).catch(() => undefined);
  }
  await browser.close();
}
