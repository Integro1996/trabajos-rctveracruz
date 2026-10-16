import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const url = process.env.LAB_FRONTEND_URL || "http://localhost:3200";
const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let articleId;
const temp = await mkdtemp(join(tmpdir(), "rct-block-editor-"));
const block = id => `[data-block-id="${id}"]`;
const ids = () => page.$$eval(".content-block", elements => elements.map(element => element.dataset.blockId));
const options = id => page.$$eval(`${block(id)} select option`, elements => elements.map(element => element.value));
const clickType = label => page.$$eval(".block-toolbar button", (buttons, text) => buttons.find(button => button.textContent === text).click(), label);
const openAfter = id => page.click(`${block(id)} + .block-inserter .block-add-toggle`);
const waitCount = count => page.waitForFunction(expected => document.querySelectorAll(".content-block").length === expected, {}, count);
const waitSaved = () => page.waitForFunction(() => document.querySelector(".document-summary")?.textContent.includes("Trabajo guardado"));

try {
  await page.goto(url, { waitUntil: "networkidle0" });
  articleId = await page.evaluate(async () => {
    const response = await fetch("/api/lab/articles", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error("No se pudo crear el borrador de prueba");
    return (await response.json()).article.id;
  });
  await page.goto(`${url}/?article=${articleId}`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".blocks-empty");
  await clickType("+ Texto");
  await waitCount(1);
  const [first] = await ids();
  await page.select(`${block(first)} select`, "Materiales y métodos");
  await page.type(`${block(first)} textarea`, "Métodos de prueba.");
  await openAfter(first);
  await clickType("+ Texto");
  await waitCount(2);
  const second = (await ids())[1];
  assert(!(await options(second)).includes("Materiales y métodos"));
  assert((await options(first)).includes("Materiales y métodos"));
  await page.type(`${block(second)} textarea`, "Texto final.");
  assert.equal(await page.$$eval(".block-add-toggle", elements => elements.length), 1);
  assert.equal(await page.$(`${block(first)} + .block-inserter`), null);
  await openAfter(second);
  await clickType("+ Texto");
  await waitCount(3);
  const middle = (await ids())[2];
  assert.deepEqual(await ids(), [first, second, middle]);
  assert.equal(await page.evaluate(() => document.activeElement.closest(".content-block")?.dataset.blockId), middle);
  await page.select(`${block(first)} select`, "Conclusiones");
  assert((await options(middle)).includes("Materiales y métodos"));
  assert(!(await options(middle)).includes("Conclusiones"));
  await page.select(`${block(middle)} select`, "Materiales y métodos");
  await page.click(`${block(middle)} .danger-link`);
  await waitCount(2);
  assert((await options(second)).includes("Materiales y métodos"));
  await openAfter(second);
  await clickType("+ Cuadro");
  await waitCount(3);
  const table = (await ids())[2];
  assert.deepEqual(await ids(), [first, second, table]);
  assert(await page.$(`${block(table)}.table`));
  await page.type(`${block(table)} .fixed-caption input`, "Tabla de prueba");

  const png = join(temp, "figure.png");
  await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  await openAfter(table);
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickType("+ Imagen o figura")]);
  await chooser.accept([png]);
  await waitCount(4);
  const figure = (await ids())[3];
  assert.deepEqual(await ids(), [first, second, table, figure]);
  assert(await page.$(`${block(figure)}.figure`));
  await page.type(`${block(figure)} .fixed-caption input`, "Figura de prueba");
  await waitSaved();
  await page.reload({ waitUntil: "networkidle0" });
  await waitCount(4);
  assert.deepEqual(await ids(), [first, second, table, figure]);
  assert(!(await options(second)).includes("Conclusiones"));

  await page.setViewport({ width: 390, height: 844 });
  await openAfter(figure);
  assert.equal(await page.$eval(`${block(figure)} + .block-inserter .block-add-toggle`, element => element.getAttribute("aria-expanded")), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval(`${block(figure)} + .block-inserter .block-add-toggle`, element => element.getAttribute("aria-expanded")), "false");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "El editor no debe desbordarse en móvil");
  assert.deepEqual(errors, []);
  console.log("OK: un único botón al final, texto/tabla/imagen al final, secciones únicas, foco, guardado, recarga y móvil.");
} finally {
  try {
    if (articleId) {
      const status = await page.evaluate(async id => {
        const csrf = decodeURIComponent(document.cookie.split("; ").find(cookie => cookie.startsWith("trabajos_csrf="))?.split("=")[1] || "");
        return (await fetch(`/api/lab/articles/${id}`, { method: "DELETE", headers: { "x-trabajos-csrf": csrf } })).status;
      }, articleId);
      assert.equal(status, 204, "El borrador de prueba debe eliminarse");
    }
  } finally {
    await browser.close();
    await rm(join(temp, "figure.png"), { force: true });
    await rmdir(temp);
  }
}
