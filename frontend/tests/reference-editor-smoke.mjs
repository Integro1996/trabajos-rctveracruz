import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const url = process.env.LAB_FRONTEND_URL || "http://localhost:3200";
const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});
const page = await browser.newPage();
const section = ".fixed-section:last-child";
let articleId;
try {
  await page.goto(url, { waitUntil: "networkidle0" });
  if ((await page.title()).startsWith("Aviso:")) {
    const continued = await page.evaluate(() => {
      const control = [...document.querySelectorAll("button, input, a")]
        .find(element => (element.textContent || element.value || "").trim() === "Continuar");
      control?.click();
      return Boolean(control);
    });
    if (!continued) throw new Error("No se pudo abrir la aplicación desde el aviso del navegador.");
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.goto(url, { waitUntil: "networkidle0" });
  }
  await page.waitForSelector("#root main");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Crear trabajo"))?.click());
  await page.waitForSelector(".recovery-card");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Continuar mi trabajo"))?.click());
  await page.waitForSelector(`${section} .required-section-text textarea`);
  articleId = new URL(page.url()).searchParams.get("article");
  assert.equal(await page.$(`${section} .section-add-button`), null);
  await page.type(`${section} .required-section-text textarea`, "Primera referencia completa.");
  await page.waitForSelector(`${section} .reference-next textarea`);
  await page.type(`${section} .reference-next textarea`, "Segunda referencia completa.");
  await page.waitForFunction(selector => document.querySelectorAll(`${selector} .content-block.text`).length === 1, {}, section);
  await page.waitForSelector(`${section} .reference-next textarea`);
  await page.waitForFunction(() => document.querySelector(".summary-save-row .save-indicator")?.classList.contains("saved"));
  await page.reload({ waitUntil: "networkidle0" });
  const references = await page.$$eval(`${section} .reference-fields textarea`, fields => fields.map(field => field.value));
  assert.deepEqual(references, ["Primera referencia completa.", "Segunda referencia completa.", ""]);

  const methods = '[id="section-Materiales y métodos"]';
  await page.click(`${methods} .section-add-button`);
  await page.$$eval(`${methods} .section-add-menu button`, buttons => buttons.find(button => button.textContent.trim() === "Cuadro")?.click());
  await page.waitForSelector(`${methods} .content-block.table`);
  const footnoteToggle = `${methods} .table-footnote-toggle input`;
  assert.equal(await page.$eval(footnoteToggle, input => input.checked), false);
  assert.equal(await page.$(`${methods} .table-footnote-field`), null);
  await page.$eval(footnoteToggle, input => input.click());
  await page.waitForSelector(`${methods} .table-footnote-field textarea`);
  await page.type(`${methods} .table-footnote-field textarea`, "a = diferencia significativa.");
  await page.waitForFunction(async () => {
    const articleId = new URLSearchParams(location.search).get("article");
    const response = await fetch(`/api/lab/articles/${articleId}`);
    const article = await response.json();
    return article.blocks?.some(block => block.type === "table" && block.footnote === "a = diferencia significativa.");
  });
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(await page.$eval(footnoteToggle, input => input.checked), true);
  assert.equal(await page.$eval(`${methods} .table-footnote-field textarea`, field => field.value), "a = diferencia significativa.");
  await page.$eval(footnoteToggle, input => input.click());
  assert.equal(await page.$(`${methods} .table-footnote-field`), null);

  const generate = ".document-summary .summary-actions button.generate-work";
  assert.equal(await page.$eval(generate, button => button.disabled), false);
  await page.click(generate);
  await page.waitForFunction(() => document.querySelector(".summary-check-row.incomplete.attention") !== null);
  assert.equal(await page.$(".summary-issues"), null);
  assert.equal(await page.$eval("#section-Introducción", element => element.classList.contains("has-issues")), true);
  assert.equal(await page.$eval(`${methods}`, element => element.classList.contains("has-issues")), true);
  assert.equal(await page.$eval(`${methods} .table-editor .fixed-caption input`, element => element.getAttribute("aria-invalid")), "true");
  assert(await page.$eval(`${methods} .section-issues`, element => element.textContent.includes("Cuadro 1")));
  await page.type(`${methods} .table-editor .fixed-caption input`, "Datos del ensayo");
  await page.waitForFunction(selector => document.querySelector(`${selector} .table-editor .fixed-caption input`)?.getAttribute("aria-invalid") === "false", {}, methods);
  await page.type("#article-introduction", "Contenido de prueba.");
  await page.waitForFunction(() => !document.getElementById("section-Introducción")?.classList.contains("has-issues"));
  assert.equal(await page.$eval(generate, button => button.disabled), false);
  console.log("Referencias independientes y correcciones visibles en sección y resumen: correctas.");
} finally {
  if (articleId) {
    await page.evaluate(async id => {
      const csrf = decodeURIComponent(document.cookie.split("; ").find(cookie => cookie.startsWith("trabajos_csrf="))?.split("=")[1] || "");
      await fetch(`/api/lab/articles/${id}`, { method: "DELETE", headers: { "x-trabajos-csrf": csrf } });
    }, articleId);
  }
  await browser.close();
}
