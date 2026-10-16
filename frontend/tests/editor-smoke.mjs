import process from "node:process";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

let articleId = process.env.LAB_ARTICLE_ID || "";
const recoveryCode = process.env.LAB_RECOVERY_CODE || "";
const executablePath = process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const frontendUrl = process.env.LAB_FRONTEND_URL || "http://localhost:3200";
const screenshotPath = process.env.LAB_SCREENSHOT_PATH || "onlyoffice-smoke.png";
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"] });

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  const requests = [];
  const failedRequests = [];
  const previewResponses = [];
  let blockEditorOnce = process.env.LAB_TEST_EDITOR_RETRY === "true";
  if (blockEditorOnce) {
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (blockEditorOnce && new URL(request.url()).pathname.endsWith('/web-apps/apps/api/documents/api.js')) {
        blockEditorOnce = false;
        request.abort('failed');
      } else request.continue();
    });
  }
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.url().includes('/preview.pdf')) previewResponses.push({ status: response.status(), contentType: response.headers()['content-type'] });
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  let sophosWarningBypassed = false;
  const navigate = async (url) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if ((await page.title()).startsWith("Aviso:")) {
      sophosWarningBypassed = await page.evaluate(() => {
        const controls = [...document.querySelectorAll("button, input, a")];
        const proceed = controls.find((element) => (element.textContent || element.value || "").trim() === "Continuar");
        if (!proceed) return false;
        proceed.click(); return true;
      });
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      consoleErrors.length = 0; requests.length = 0; failedRequests.length = 0;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
  };

  await navigate(frontendUrl);
  await page.waitForSelector("#root main", { timeout: 30_000 });
  const publicAdminLinks = await page.$$eval('a[href*="admin"], button', (elements) => elements.filter((element) => /administra/i.test(`${element.textContent} ${element.getAttribute("href") || ""}`)).length);

  let generatedReference = null;
  let projectKeyFormatValid = null;
  let qrAbsent = null;
  let copiedKeyValid = null;
  if (!articleId) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Crear trabajo"))?.click());
    await page.waitForSelector(".recovery-card", { timeout: 60_000 });
    generatedReference = await page.$eval(".credential-code", (element) => `RCT-${[...element.querySelectorAll("strong")].map((part) => part.textContent.trim()).join("-")}`);
    projectKeyFormatValid = /^RCT-[CDFHJKMNRUVWXY3479]{4}-[CDFHJKMNRUVWXY3479]{2}$/.test(generatedReference || "");
    qrAbsent = await page.$('.qr-wrap') === null;
    const copiedKey = await page.evaluate(async () => {
      let copied = null;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => { copied = value; } } });
      [...document.querySelectorAll(".recovery-card button")].find((button) => button.textContent?.includes("Copiar"))?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return copied;
    });
    copiedKeyValid = copiedKey === generatedReference.slice(4, 8) + generatedReference.slice(9);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Continuar mi trabajo"))?.click());
    await page.waitForFunction(() => new URLSearchParams(location.search).has("article"), { timeout: 30_000 });
    articleId = new URL(page.url()).searchParams.get("article");
  } else if (recoveryCode) {
    const key = /^RCT-([A-Z0-9]{4})-([A-Z0-9]{2})$/i.exec(recoveryCode);
    if (!key) throw new Error("LAB_RECOVERY_CODE debe ser una Clave Proyecto RCT-XXXX-XX.");
    await page.type("#recovery-code", key[1].toLowerCase());
    await page.type('.project-key-input input:last-child', key[2].toLowerCase());
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Abrir trabajo"))?.click());
    await page.waitForFunction((expected) => new URLSearchParams(location.search).get("article") === expected, { timeout: 30_000 }, articleId);
  } else {
    await navigate(`${frontendUrl}/?article=${encodeURIComponent(articleId)}`);
  }

  await page.waitForSelector("#article-introduction", { timeout: 30_000 });
  await page.click('input[name="article-mesa"][value="AG"]');
  assert.equal(await page.$$eval('.author-card[draggable]', elements => elements.length), 0);
  assert.equal(await page.$$eval('.author-grid label span', elements => elements.map(element => element.textContent).join(',')), 'Nombre,Apellidos,Correo,Institución');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Agregar autor'))?.click());
  await page.waitForSelector('.author-card:nth-child(2)');
  assert.deepEqual(await page.$$eval('.author-card:nth-child(2) .author-grid label span', elements => elements.map(element => element.textContent)), ['Nombre', 'Apellidos', 'Institución']);
  await page.type('.author-card:nth-child(2) .author-grid label:nth-child(1) input', 'Luis');
  await page.type('.author-card:nth-child(2) .author-grid label:nth-child(2) input', 'Ruiz');
  await page.type('.author-card:nth-child(2) .author-grid label:nth-child(3) input', 'Instituto de prueba');
  await page.type('.keyword-entry input', 'algas verdes, Tetraselmis chuii');
  await page.keyboard.press('Enter');
  await page.type("#article-introduction", "Esta introducción resume el propósito, el método y los resultados principales del trabajo.");
  await page.type('[id="section-Objetivos"] .required-section-text textarea', "Evaluar la respuesta del tratamiento en el ensayo.");
  await page.type('[id^="section-Materiales"] .required-section-text textarea', "El cuerpo del resumen se construye mediante bloques ordenados y se convierte en un documento con formato fijo.");
  await page.type('[id^="section-Resultados"] .required-section-text textarea', "Los resultados muestran una respuesta favorable en el tratamiento evaluado.");
  await page.type('[id^="section-Conclusiones"] .required-section-text textarea', "El tratamiento evaluado mejoró la respuesta observada.");
  await page.type('[id^="section-Referencias"] .required-section-text textarea', "Pérez, A. (2020). Estudio experimental.");
  await page.click('[id^="section-Resultados"] .section-add-button');
  await page.evaluate(() => [...document.querySelectorAll('[id^="section-Resultados"] .section-add-menu button')].find((button) => button.textContent?.trim() === "Figura")?.click());
  await page.evaluate(() => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "figura-smoke.png", { type: "image/png" }));
    const input = document.querySelector('.blocks-card input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector(".content-block.figure", { timeout: 30_000 });
  await page.type(".content-block.figure .fixed-caption input", "Figura incluida desde la galería del investigador.");
  await page.click('[id^="section-Resultados"] .section-add-button');
  await page.evaluate(() => [...document.querySelectorAll('[id^="section-Resultados"] .section-add-menu button')].find((button) => button.textContent?.trim() === "Cuadro")?.click());
  await page.waitForSelector(".content-block.table", { timeout: 10_000 });
  await page.type(".content-block.table .fixed-caption input", "Datos utilizados para validar la generación.");
  const cells = await page.$$(".content-block.table .editable-grid input");
  if (cells[0]) await cells[0].type("Variable");
  if (cells[1]) await cells[1].type("Resultado");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Generar trabajo")?.click());

  let iframeLoaded = true;
  try {
    if (process.env.LAB_TEST_EDITOR_RETRY === "true") {
      await page.waitForSelector('.editor-error button', { timeout: 70_000 });
      consoleErrors.length = 0;
      failedRequests.length = 0;
      await page.click('.editor-error button');
    }
    await page.waitForSelector('.editor-frame iframe[src*="/preview.pdf"]', { timeout: 70_000 });
    await page.waitForFunction(() => document.querySelector('.editor-footer')?.textContent.includes('Vista previa: Lista'), { timeout: 70_000 });
  } catch { iframeLoaded = false; }

  let lowercaseAccessValid = null;
  if (generatedReference) {
    const freshContext = await browser.createBrowserContext();
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto(frontendUrl, { waitUntil: "domcontentloaded" });
      await freshPage.type("#recovery-code", generatedReference.slice(4, 8).toLowerCase());
      await freshPage.type('.project-key-input input:last-child', generatedReference.slice(9).toLowerCase());
      lowercaseAccessValid = await freshPage.$eval(".project-key-input", (entry, key) => entry.querySelector(".project-key-prefix")?.textContent === "RCT" && entry.querySelector(".project-key-hyphen")?.textContent === "-" && entry.querySelector("#recovery-code")?.value === key.slice(4, 8) && entry.querySelector("input:last-child")?.value === key.slice(9), generatedReference);
      await freshPage.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Abrir trabajo"))?.click());
      await freshPage.waitForFunction((id) => new URLSearchParams(location.search).get("article") === id, { timeout: 30_000 }, articleId);
      await freshPage.waitForSelector("#article-introduction", { timeout: 30_000 });
    } finally { await freshContext.close(); }
  }

  if (process.env.LAB_TEST_PREVIEW_DELAY === "true") {
    assert(iframeLoaded);
    const oldFrame = await page.$('iframe');
    await page.$eval('#article-title', element => { element.focus(); element.select(); });
    await page.type('#article-title', 'Vista con espera', {delay: 150});
    assert(await oldFrame.evaluate(element => element.isConnected), 'La vista anterior debe seguir visible');
    await page.waitForFunction(() => document.body.textContent.includes('Estado: Guardado ✓'));
    await page.waitForFunction(element => !element.isConnected, {timeout: 70000}, oldFrame);
    await page.waitForFunction(() => document.querySelector('.editor-footer')?.textContent.includes('Vista previa: Lista'), {timeout: 70000});
    await page.waitForFunction(() => document.querySelector('.document-summary')?.textContent.includes('Extensión requerida'), {timeout: 70000});
  }
  const frameUrls = page.frames().map((frame) => frame.url()).filter((url) => url !== "about:blank");
  const result = {
    title: await page.title(), pageUrl: page.url(), articleId, generatedReference, projectKeyFormatValid, qrAbsent, copiedKeyValid, lowercaseAccessValid,
    publicAdminLinks, editorFrameUrls: frameUrls, documentCard: await page.$$eval(".document-card", (elements) => elements.length),
    documentSummary: await page.$$eval(".document-summary", (elements) => elements.length),
    textBlocks: await page.$$eval(".content-block.text", (elements) => elements.length),
    figureBlocks: await page.$$eval(".content-block.figure", (elements) => elements.length),
    tableBlocks: await page.$$eval(".content-block.table", (elements) => elements.length),
    pageSummary: await page.$eval(".document-summary", (element) => element.textContent.includes("Extensión requerida")), iframeLoaded,
    javascriptEnabled: page.isJavaScriptEnabled(), sophosWarningBypassed, requestCount: requests.length,
    relevantRequests: requests.filter((url) => url.startsWith(frontendUrl) || url.includes("documenteditor")).slice(0, 35),
    failedRequests, consoleErrors,
  };
  await page.$eval('.editor-frame', element => element.scrollIntoView());
  await new Promise(resolve => setTimeout(resolve, 1500));
  await page.screenshot({ path: screenshotPath, fullPage: true });
  if (process.env.LAB_DOCUMENT_SCREENSHOT_PATH) await (await page.$('.document-card')).screenshot({path:process.env.LAB_DOCUMENT_SCREENSHOT_PATH});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (publicAdminLinks !== 0 || projectKeyFormatValid === false || qrAbsent === false || copiedKeyValid === false || lowercaseAccessValid === false || !iframeLoaded || !previewResponses.some(response => response.status === 200 && response.contentType?.includes('application/pdf')) || !result.documentSummary || !result.textBlocks || !result.figureBlocks || !result.tableBlocks || !result.pageSummary || consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
