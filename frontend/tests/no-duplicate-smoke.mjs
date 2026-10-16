import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});
const page = await browser.newPage();
let articleId;
try {
  const url = process.env.LAB_FRONTEND_URL || "http://localhost:3200";
  await page.goto(url, { waitUntil: "networkidle0" });
  if ((await page.title()).startsWith("Aviso:")) {
    await page.evaluate(() => [...document.querySelectorAll("button, input, a")]
      .find(element => (element.textContent || element.value || "").trim() === "Continuar")?.click());
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.goto(url, { waitUntil: "networkidle0" });
  }
  await page.waitForSelector("#root main");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Crear trabajo"))?.click());
  await page.waitForSelector(".recovery-card");
  await page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent.includes("Continuar mi trabajo"))?.click());
  await page.waitForSelector("#article-introduction");
  articleId = new URL(page.url()).searchParams.get("article");

  const duplicateStatus = await page.evaluate(async id => {
    const csrf = decodeURIComponent(document.cookie.split("; ").find(cookie => cookie.startsWith("trabajos_csrf="))?.split("=")[1] || "");
    return (await fetch(`/api/lab/articles/${id}/duplicate`, { method: "POST", headers: { "x-trabajos-csrf": csrf, "Content-Type": "application/json" }, body: "{}" })).status;
  }, articleId);
  assert.equal(duplicateStatus, 404);

  await page.click(".editor-hero .editor-return");
  await page.waitForSelector(".recent-item");
  const buttons = await page.$$eval(".recent-item .row-actions button", nodes => nodes.map(node => node.textContent.trim()));
  assert.deepEqual(buttons, ["Continuar", "Eliminar"]);
  await page.click(".recent-item .recent-action.delete");
  await page.waitForSelector(".delete-work-dialog[open]");
  assert(await page.$eval(".delete-work-dialog", dialog => dialog.textContent.includes("No podrás recuperarlos después.")));
  await page.click(".delete-work-cancel");
  await page.waitForFunction(() => !document.querySelector(".delete-work-dialog")?.open);
  assert(await page.$(".recent-item"));
  await page.click(".recent-item .recent-action.delete");
  await page.click(".delete-work-confirm");
  await page.waitForFunction(() => !document.querySelector(".recent-item"));
  articleId = null;
  console.log("Duplicación deshabilitada y confirmación de eliminación funcional.");
} finally {
  if (articleId) {
    await page.evaluate(async id => {
      const csrf = decodeURIComponent(document.cookie.split("; ").find(cookie => cookie.startsWith("trabajos_csrf="))?.split("=")[1] || "");
      await fetch(`/api/lab/articles/${id}`, { method: "DELETE", headers: { "x-trabajos-csrf": csrf } });
    }, articleId);
  }
  await browser.close();
}
