import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});
const page = await browser.newPage();
const section = '[id="section-Objetivos"]';
let articleId;
try {
  const url = process.env.LAB_FRONTEND_URL || "http://localhost:3200";
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
  await page.waitForSelector(`${section} textarea`);
  articleId = new URL(page.url()).searchParams.get("article");
  assert.equal(await page.$eval("#article-title", field => field.value), "");
  assert.deepEqual(await page.$$eval(".author-card input:not([type=radio])", fields => fields.map(field => field.value)), ["", "", "", ""]);
  await page.type(".author-card input", "Ana");
  assert.equal(await page.$eval(".document-summary h2", node => node.textContent), "Estado General del Trabajo");
  assert.equal(await page.$eval(".document-summary", node => getComputedStyle(node).overflowY), "visible");
  assert.equal(await page.$$(".summary-check-row").then(nodes => nodes.length), 10);
  assert.equal(await page.$eval(".summary-check-row:nth-child(3) .summary-check-result > span:first-child", node => node.textContent), "1");
  assert.equal(await page.$eval(".summary-check-row:nth-child(4)", node => node.textContent.trim()), "Palabras clave0 de 5");
  assert.equal(await page.$eval(".summary-check-row:nth-child(10) .summary-check-result > span:first-child", node => node.textContent), "0");
  assert.equal(await page.$(".keyword-entry button"), null);
  await page.click(".document-summary .generate-work");
  await page.waitForSelector('.keyword-entry input[aria-invalid="true"]');
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".keyword-entry input")).borderColor === "rgb(191, 64, 85)");
  assert.equal(await page.$eval(".keyword-entry input", node => getComputedStyle(node).borderColor), "rgb(191, 64, 85)");
  await page.click(".summary-check-row:nth-child(4)");
  assert.equal(await page.evaluate(() => document.activeElement?.matches(".keyword-entry input")), true);
  assert.equal(await page.$eval(".keyword-entry input", node => node.classList.contains("jump-focus-highlight")), true);
  await page.click(".summary-check-row:nth-child(5)");
  await page.waitForFunction(() => document.activeElement?.id === "article-introduction");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "article-introduction");
  await page.click(".summary-check-row:nth-child(2)");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "article-title");
  await page.type(".keyword-entry input", "cultivo");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".summary-check-row:nth-child(4)")?.classList.contains("complete"));
  assert.equal(await page.$eval(".keyword-entry input", node => node.getAttribute("aria-invalid")), "false");
  assert.equal(await page.$eval(".summary-check-row:nth-child(4)", node => node.textContent.trim()), "Palabras clave1 de 5");
  await page.type('[id="section-Referencias bibliográficas"] .required-section-text textarea', "Pérez, A. (2024). Estudio de cultivo.");
  await page.waitForFunction(() => document.querySelector(".summary-check-row:nth-child(10) .summary-check-result > span:first-child")?.textContent === "1");
  assert.equal(await page.$eval(".summary-check-row:nth-child(1) .summary-check-icon svg", node => getComputedStyle(node.parentElement).alignItems), "center");
  assert.equal(await page.$eval(".page-meter", node => node.getAttribute("aria-label")), "Entre 3 y 5 páginas");
  assert.equal(await page.$$(".page-meter span").then(nodes => nodes.length), 5);

  const headings = await page.$$eval(".fixed-sections > .fixed-section h3", nodes => nodes.map(node => node.textContent));
  assert.deepEqual(headings.slice(0, 3), ["Introducción", "Objetivos (final de la introducción)", "Materiales y métodos"]);
  assert.equal(await page.$('[id="section-Conclusiones"] .section-add-button'), null);
  assert(await page.$('[id="section-Conclusiones"] .required-section-text textarea'));
  assert.equal(await page.$eval(`${section} .eyebrow`, node => node.textContent), "Sección obligatoria");
  await page.click(`${section} .section-add-button`);
  assert.deepEqual(await page.$$eval(`${section} .section-add-menu button`, nodes => nodes.map(node => node.textContent.trim())), ["Figura", "Cuadro", "Fórmula"]);
  await page.click(`${section} .section-add-menu button:nth-of-type(2)`);
  await page.waitForSelector(`${section} .content-block.table`);
  await page.type(`${section} .block-field > textarea`, "Evaluar el crecimiento del cultivo.");
  await page.type(`${section} .fixed-caption input`, "Resultados esperados");
  await page.waitForFunction(() => document.querySelector(".summary-save-row .save-indicator")?.classList.contains("saved"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(`${section} .content-block.table`);
  assert.equal(await page.$eval(".author-card input", field => field.value), "Ana");
  assert.equal(await page.$eval("#article-title", field => field.value), "");
  assert.equal(await page.$eval(`${section} .block-field > textarea`, field => field.value), "Evaluar el crecimiento del cultivo.");
  assert.equal(await page.$eval(`${section} .fixed-caption input`, field => field.value), "Resultados esperados");
  await page.click(".document-summary .generate-work");
  await page.waitForSelector(".summary-check-row.incomplete.attention");
  assert.equal(await page.$(".summary-issues"), null);
  assert.equal(await page.$eval(".summary-check-row.incomplete.attention", node => getComputedStyle(node).animationName), "summary-attention");
  assert.equal(await page.$eval(".summary-check-row.complete", node => node.classList.contains("attention")), false);
  assert.equal(await page.$eval("#section-Introducción", node => node.classList.contains("has-issues")), true);
  console.log("Objetivos: orden, menú, texto, cuadro y persistencia correctos.");
} finally {
  if (articleId) {
    await page.evaluate(async id => {
      const csrf = decodeURIComponent(document.cookie.split("; ").find(cookie => cookie.startsWith("trabajos_csrf="))?.split("=")[1] || "");
      await fetch(`/api/lab/articles/${id}`, { method: "DELETE", headers: { "x-trabajos-csrf": csrf } });
    }, articleId);
  }
  await browser.close();
}
