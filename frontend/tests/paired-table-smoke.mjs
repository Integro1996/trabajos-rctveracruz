import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const url = process.env.LAB_FRONTEND_URL || "http://127.0.0.1:3200";
const browser = await puppeteer.launch({ executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--no-proxy-server", "--proxy-bypass-list=*"] });
let articleId = null;

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (!request.url().startsWith(url)) { await request.continue(); return; }
    try {
      const headers = { ...request.headers() };
      delete headers.host;
      delete headers["content-length"];
      delete headers["accept-encoding"];
      const response = await fetch(request.url(), { method: request.method(), headers, body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postData() });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0];
        const equals = pair.indexOf("=");
        await page.setCookie({ name: pair.slice(0, equals), value: pair.slice(equals + 1), url });
      }
      const responseHeaders = Object.fromEntries([...response.headers].filter(([name]) => !["content-length", "content-encoding", "transfer-encoding", "set-cookie"].includes(name)));
      await request.respond({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) });
    } catch (error) { errors.push(error.message); await request.abort(); }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForSelector(".list-shell .hero .button.primary");
  await page.click(".list-shell .hero .button.primary");
  await page.waitForSelector(".recovery-card");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Continuar mi trabajo"))?.click());
  await page.waitForSelector("#article-introduction");
  articleId = new URL(page.url()).searchParams.get("article");
  assert(articleId);

  await page.type("#article-introduction", "Antes. Después.");
  await page.$eval("#article-introduction", (field) => { field.focus(); field.setSelectionRange(7, 7); field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowLeft" })); });
  await page.click(".fixed-section:first-child .section-add-button");
  await page.evaluate(() => [...document.querySelectorAll(".fixed-section:first-child .section-add-menu button")].find((button) => button.textContent.startsWith("Cuadro"))?.click());
  await page.waitForSelector(".fixed-section:first-child .add-second-table");
  await page.type(".fixed-section:first-child .content-block.table .fixed-caption input", "Primera tabla");
  await page.click(".fixed-section:first-child .add-second-table");
  await page.waitForSelector(".fixed-section:first-child .second-table .fixed-caption input");
  await page.type(".fixed-section:first-child .second-table .fixed-caption input", "Segunda tabla");
  assert.equal(await page.$$eval(".fixed-section:first-child .content-block.table", (elements) => elements.length), 1);
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .content-block.table .fixed-caption strong", (elements) => elements.map((element) => element.textContent)), ["Cuadro 1.", "Cuadro 2."]);
  assert.equal(await page.$eval(".fixed-section:first-child .second-table .table-size-controls label:nth-child(2) input", (field) => field.max), "4");

  const columns = await page.$(".fixed-section:first-child .second-table .table-size-controls label:nth-child(2) input");
  await columns.click({ clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type("4");
  assert.equal(await page.$eval(".fixed-section:first-child .second-table .table-size-controls label:nth-child(2) input", (field) => field.value), "4");
  await columns.click({ clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type("5");
  await page.waitForFunction(() => document.querySelector(".second-table .field-error")?.textContent.includes("anchura"));
  assert.equal(await page.$eval(".fixed-section:first-child .second-table .table-size-controls label:nth-child(2) input", (field) => field.value), "4");
  await page.$eval(".fixed-section:first-child .second-table .editable-grid input", (field) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "A\tB\tC\tD\tE");
    field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.waitForFunction(() => document.querySelector(".second-table .field-error")?.textContent.includes("No se puede pegar"));
  assert.equal(await page.$$eval(".fixed-section:first-child .second-table .editable-grid tr:first-child input", (fields) => fields.length), 4);

  if (process.env.LAB_TABLE_SCREENSHOT) await (await page.$(".fixed-section:first-child")).screenshot({ path: process.env.LAB_TABLE_SCREENSHOT });
  await page.waitForFunction(() => document.body.textContent.includes("Estado: Guardado ✓"), { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".fixed-section:first-child .second-table .fixed-caption input");
  assert.equal(await page.$eval(".fixed-section:first-child .second-table .fixed-caption input", (field) => field.value), "Segunda tabla");
  assert.equal(await page.$eval(".fixed-section:first-child .second-table .table-size-controls label:nth-child(2) input", (field) => field.value), "4");

  await page.evaluate(() => {
    const table = document.querySelector(".fixed-section:first-child .content-block.table");
    const handle = table.querySelector(".drag-handle");
    const target = document.querySelector(".fixed-section:first-child .content-block.text");
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    setTimeout(() => {
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientY: target.getBoundingClientRect().bottom }));
      handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    }, 0);
  });
  await page.waitForFunction(() => document.querySelector("#article-introduction")?.value === "Antes. Después." && document.querySelector(".fixed-section:first-child .second-table") && !document.querySelector(".fixed-section:first-child .content-block.text"));

  await page.click(".fixed-section:first-child .section-add-button");
  assert.equal(await page.$eval(".fixed-section:first-child .section-add-menu button:nth-of-type(3)", (button) => button.disabled), false);
  await page.evaluate(() => [...document.querySelectorAll(".fixed-section:first-child .section-add-menu button")].find((button) => button.textContent.startsWith("Cuadro"))?.click());
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .content-block.table").length === 2);
  const thirdTable = (await page.$$(".fixed-section:first-child .content-block.table")).at(-1);
  await (await thirdTable.$(".fixed-caption input")).type("Tercera tabla");
  await (await thirdTable.$(".add-second-table")).click();
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .second-table").length === 2);
  const fourthTable = (await page.$$(".fixed-section:first-child .second-table")).at(-1);
  await (await fourthTable.$(".fixed-caption input")).type("Cuarta tabla");
  await page.waitForFunction(() => document.body.textContent.includes("Guardando…"));
  await page.waitForFunction(() => document.body.textContent.includes("Estado: Guardado ✓"), { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .second-table").length === 2);
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .content-block.table .fixed-caption strong", (elements) => elements.map((element) => element.textContent)), ["Cuadro 1.", "Cuadro 2.", "Cuadro 3.", "Cuadro 4."]);

  await page.click(".fixed-section:first-child .table-pair-option input");
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .content-block.table").length === 3);
  const firstColumns = await page.$(".fixed-section:first-child .content-block.table:first-of-type .table-size-controls label:nth-child(2) input");
  await firstColumns.click({ clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type("5");
  await page.waitForFunction(() => document.querySelector(".fixed-section:first-child .content-block.table .field-error")?.textContent.includes("anchura"));
  assert.equal(await page.$eval(".fixed-section:first-child .content-block.table .table-size-controls label:nth-child(2) input", (field) => field.value), "5");
  assert.equal(await page.$$eval(".fixed-section:first-child .content-block.table:first-of-type .table-pair-option", (elements) => elements.length), 0);
  assert.deepEqual(errors, []);
  process.stdout.write("Cuatro tablas en dos parejas, títulos independientes, límite de cuatro columnas y persistencia: correctos.\n");
} finally {
  if (articleId) {
    const page = (await browser.pages())[0];
    await page.evaluate(async (id) => {
      const csrf = document.cookie.split("; ").find((part) => part.startsWith("trabajos_csrf="))?.split("=")[1] || "";
      await fetch("/api/lab/articles/" + id, { method: "DELETE", headers: { "x-trabajos-csrf": csrf } });
    }, articleId).catch(() => {});
  }
  await browser.close();
}
