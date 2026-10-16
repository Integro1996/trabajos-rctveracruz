import assert from "node:assert/strict";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const url = process.env.LAB_FRONTEND_URL || "http://127.0.0.1:3200";
const imagePath = join(tmpdir(), "rct-inline-flow-smoke.png");
await writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
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
      const response = await fetch(request.url(), {
        method: request.method(), headers,
        body: ["GET", "HEAD"].includes(request.method()) ? undefined : request.postData(),
      });
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
  await page.waitForSelector(".fixed-section:first-child .content-block.table");
  assert.equal(await page.$eval("#article-introduction", (field) => field.value), "Antes. ");
  assert.equal(await page.$eval(".fixed-section:first-child .content-block.text textarea", (field) => field.value), "Después.");
  await page.type(".fixed-section:first-child .content-block.table .fixed-caption input", "Datos intermedios");

  await page.$eval(".fixed-section:first-child .content-block.text textarea", (field) => { field.focus(); field.setSelectionRange(0, 0); field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowLeft" })); });
  await page.click(".fixed-section:first-child .section-add-button");
  await page.evaluate(() => [...document.querySelectorAll(".fixed-section:first-child .section-add-menu button")].find((button) => button.textContent.startsWith("Figura"))?.click());
  await page.waitForSelector(".fixed-section:first-child .figure-drop-zone");
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .section-elements > *", (elements) => elements.map((element) => element.classList.contains("figure-upload-panel") ? "upload" : element.classList[1])), ["table", "upload", "text"]);
  assert.equal(await page.$eval(".fixed-section:first-child .fixed-section-header", (header) => getComputedStyle(header).position), "sticky");
  const chooserPromise = page.waitForFileChooser();
  await page.click(".fixed-section:first-child .figure-drop-zone");
  await (await chooserPromise).accept([imagePath]);
  await page.waitForSelector(".fixed-section:first-child .content-block.figure");
  await page.type(".fixed-section:first-child .content-block.figure .fixed-caption input", "Imagen intermedia");
  assert.equal(await page.$eval(".fixed-section:first-child .add-second-figure", (button) => button.textContent.trim()), "+ Agregar segunda figura");
  await page.click(".fixed-section:first-child .add-second-figure");
  await page.waitForSelector(".fixed-section:first-child .figure-drop-zone");
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "figura-arrastrada.png", { type: "image/png" }));
    document.querySelector(".fixed-section:first-child .figure-drop-zone").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForSelector(".fixed-section:first-child .second-figure .fixed-caption input");
  await page.type(".fixed-section:first-child .second-figure .fixed-caption input", "Segunda imagen intermedia");
  assert.equal(await page.$$eval(".fixed-section:first-child .content-block.figure", (elements) => elements.length), 1);
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .content-block.figure .fixed-caption strong", (elements) => elements.map((element) => element.textContent)), ["Figura 1.", "Figura 2."]);
  const order = await page.$$eval(".fixed-section:first-child .section-elements > article", (elements) => elements.map((element) => element.classList.contains("table") ? "table" : element.classList.contains("figure") ? "figure" : "text"));
  assert.deepEqual(order, ["table", "figure", "text"]);
  await page.$eval(".fixed-section:first-child .content-block.text textarea", (field) => { field.focus(); field.setSelectionRange(field.value.length, field.value.length); field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" })); });
  await page.click(".fixed-section:first-child .section-add-button");
  await page.evaluate(() => [...document.querySelectorAll(".fixed-section:first-child .section-add-menu button")].find((button) => button.textContent.startsWith("Figura"))?.click());
  await page.waitForSelector(".fixed-section:first-child .figure-drop-zone");
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .section-elements > *", (elements) => elements.map((element) => element.classList.contains("figure-upload-panel") ? "upload" : element.classList[1])), ["table", "figure", "text", "upload"]);
  await page.click(".fixed-section:first-child .figure-upload-cancel");
  await page.waitForSelector(".fixed-section:first-child .figure-upload-panel", { hidden: true });
  if (process.env.LAB_INLINE_SCREENSHOT) await (await page.$(".fixed-section:first-child")).screenshot({ path: process.env.LAB_INLINE_SCREENSHOT });

  await page.evaluate(() => {
    const figure = document.querySelector(".fixed-section:first-child .content-block.figure");
    const handle = figure.querySelector(".drag-handle");
    const target = document.querySelector(".fixed-section:first-child .content-block.text");
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    setTimeout(() => {
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientY: target.getBoundingClientRect().bottom }));
      handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    }, 0);
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".fixed-section:first-child .section-elements > article")].map((element) => element.classList[1]).join(",") === "table,text,figure");
  await page.waitForFunction(() => document.body.textContent.includes("Estado: Guardado ✓"), { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".fixed-section:first-child .content-block.figure");
  assert.equal(await page.$eval("#article-introduction", (field) => field.value), "Antes. ");
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .section-elements > article", (elements) => elements.map((element) => element.classList[1])), ["table", "text", "figure"]);
  assert.equal(await page.$eval(".fixed-section:first-child .second-figure .fixed-caption input", (field) => field.value), "Segunda imagen intermedia");
  assert.equal(await page.$eval(".fixed-section:first-child .content-block.text textarea", (field) => field.value), "Después.");

  await page.evaluate(() => {
    const table = document.querySelector(".fixed-section:first-child .content-block.table");
    const handle = table.querySelector(".drag-handle");
    const target = document.querySelector(".fixed-section:first-child .content-block.figure");
    const dataTransfer = new DataTransfer();
    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    setTimeout(() => {
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientY: target.getBoundingClientRect().bottom }));
      handle.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    }, 0);
  });
  await page.waitForFunction(() => document.querySelector("#article-introduction")?.value === "Antes. Después." && !document.querySelector(".fixed-section:first-child .content-block.text"));
  await page.waitForFunction(() => document.body.textContent.includes("Guardando…"));
  await page.waitForFunction(() => document.body.textContent.includes("Estado: Guardado ✓"), { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".fixed-section:first-child .content-block.figure");
  assert.equal(await page.$eval("#article-introduction", (field) => field.value), "Antes. Después.");
  assert.equal(await page.$$eval(".fixed-section:first-child .content-block.text", (elements) => elements.length), 0);

  await page.evaluate(async (id) => {
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("trabajos_csrf="))?.split("=")[1] || "";
    const article = await (await fetch("/api/lab/articles/" + id)).json();
    const blocks = article.blocks.map(({ asset, ...block }) => block);
    blocks.unshift({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", type: "text", heading: "Introducción", text: "Tercero." });
    const response = await fetch("/api/lab/articles/" + id, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-trabajos-csrf": csrf },
      body: JSON.stringify({ title: article.title, authors: article.authors, keywords: article.keywords, introduction: article.introduction, blocks }),
    });
    if (!response.ok) throw new Error("No se pudo preparar el trabajo con textos consecutivos.");
  }, articleId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#article-introduction")?.value === "Antes. Después. Tercero.");
  assert.equal(await page.$$eval(".fixed-section:first-child .content-block.text", (elements) => elements.length), 0);
  await page.waitForFunction(() => document.body.textContent.includes("Estado: Guardado ✓"), { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#article-introduction");
  assert.equal(await page.$eval("#article-introduction", (field) => field.value), "Antes. Después. Tercero.");
  await page.click(".fixed-section:first-child .section-add-button");
  assert.equal(await page.$eval(".fixed-section:first-child .section-add-menu button:nth-of-type(2)", (button) => button.disabled), false);
  await page.evaluate(() => [...document.querySelectorAll(".fixed-section:first-child .section-add-menu button")].find((button) => button.textContent.startsWith("Figura"))?.click());
  await page.waitForSelector(".fixed-section:first-child .figure-drop-zone");
  const thirdChooserPromise = page.waitForFileChooser();
  await page.click(".fixed-section:first-child .figure-drop-zone");
  await (await thirdChooserPromise).accept([imagePath]);
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .content-block.figure").length === 2);
  const thirdFigure = (await page.$$(".fixed-section:first-child .content-block.figure")).at(-1);
  await (await thirdFigure.$(".fixed-caption input")).type("Tercera imagen");
  await (await thirdFigure.$(".add-second-figure")).click();
  await page.waitForSelector(".fixed-section:first-child .figure-drop-zone");
  const fourthChooserPromise = page.waitForFileChooser();
  await page.click(".fixed-section:first-child .figure-drop-zone");
  await (await fourthChooserPromise).accept([imagePath]);
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .content-block.figure").length === 2 && document.querySelectorAll(".fixed-section:first-child .second-figure").length === 2);
  const fourthFigure = (await page.$$(".fixed-section:first-child .second-figure")).at(-1);
  await (await fourthFigure.$(".fixed-caption input")).type("Cuarta imagen");
  await page.waitForFunction(() => document.body.textContent.includes("Guardando…"));
  await page.waitForFunction(() => document.body.textContent.includes("Estado: Guardado ✓"), { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".fixed-section:first-child .second-figure").length === 2);
  assert.deepEqual(await page.$$eval(".fixed-section:first-child .content-block.figure .fixed-caption strong", (elements) => elements.map((element) => element.textContent)), ["Figura 1.", "Figura 2.", "Figura 3.", "Figura 4."]);
  assert.deepEqual(errors, []);
  process.stdout.write("Cuatro imágenes en dos parejas, arrastre, unión automática de texto y persistencia: correctos.\n");
} finally {
  if (articleId) {
    const page = (await browser.pages())[0];
    await page.evaluate(async (id) => {
      const csrf = document.cookie.split("; ").find((part) => part.startsWith("trabajos_csrf="))?.split("=")[1] || "";
      await fetch("/api/lab/articles/" + id, { method: "DELETE", headers: { "x-trabajos-csrf": csrf } });
    }, articleId).catch(() => {});
  }
  await browser.close();
  await unlink(imagePath).catch(() => {});
}
