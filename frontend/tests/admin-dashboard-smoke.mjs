import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});
const page = await browser.newPage();
const errors = [];
let created = null;
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", async (response) => {
  if (response.url().endsWith("/api/lab/admin/articles") && response.request().method() === "POST" && response.status() === 201) {
    created = await response.json();
  }
});

try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://localhost:3200", { waitUntil: "domcontentloaded" });
  if ((await page.title()).startsWith("Aviso:")) {
    await page.evaluate(() => [...document.querySelectorAll("button, input, a")].find((element) => (element.textContent || element.value || "").trim() === "Continuar")?.click());
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await page.goto("http://localhost:3200/admin/vista", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#dashboard-email, .admin-preview", { timeout: 30_000 });
  if (await page.$("#dashboard-email")) {
    await page.type("#dashboard-email", process.env.ADMIN_EMAIL || process.env.TRABAJOS_ADMIN_EMAIL);
    await page.type("#dashboard-password", process.env.ADMIN_PASSWORD || process.env.TRABAJOS_ADMIN_PASSWORD);
    await page.click(".admin-login button[type=submit]");
    await page.waitForSelector(".admin-preview-work", { timeout: 30_000 });
  }
  assert.equal(await page.evaluate(() => document.body.textContent.includes("Maqueta para revisión")), false);
  if (await page.$(".admin-preview-pagination")) {
    const firstPage = await page.$eval(".admin-preview-work tbody tr:first-child .admin-preview-reference", (element) => element.textContent);
    await page.click(".admin-preview-pagination button[aria-label='Página 2']");
    await page.waitForFunction((reference) => document.querySelector(".admin-preview-work tbody tr:first-child .admin-preview-reference")?.textContent !== reference, {}, firstPage);
    assert.equal(await page.$eval(".admin-preview-pagination [aria-current=page]", (element) => element.textContent), "2");
    await page.click(".admin-preview-pagination button[aria-label='Página 1']");
    await page.waitForFunction((reference) => document.querySelector(".admin-preview-work tbody tr:first-child .admin-preview-reference")?.textContent === reference, {}, firstPage);
  }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Crear trabajo"))?.click());
  await page.waitForSelector(".admin-preview-form");
  await page.type('.admin-preview-form input[maxlength="130"]', "Prueba visual CRUD");
  await page.type(".admin-preview-author .admin-preview-form-grid label:first-child input", "Autora");
  await page.type(".admin-preview-author .admin-preview-form-grid label:last-child input", "Visual");
  await page.type(".admin-preview-author > label:nth-of-type(1) input", "Institución de prueba");
  await page.type(".admin-preview-author input[type=email]", "autora@example.test");
  await page.type(".admin-preview-form > label:last-of-type input", "Prueba");
  await page.click(".admin-preview-form button[type=submit]");
  await page.waitForSelector("#admin-project-key-title", { timeout: 30_000 });
  assert(created?.article?.id);
  const reference = created.article.publicReference;
  await page.evaluate(() => [...document.querySelectorAll(".admin-preview-confirm button")].find((button) => button.textContent === "Continuar")?.click());
  await page.waitForFunction((ref) => document.querySelector(".admin-preview-detail h2")?.textContent === ref, {}, reference);
  await page.evaluate(() => [...document.querySelectorAll(".admin-preview-detail button")].find((button) => button.textContent === "Editar datos")?.click());
  await page.waitForSelector(".admin-preview-form");
  await page.click('.admin-preview-form input[maxlength="130"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.type('.admin-preview-form input[maxlength="130"]', "Prueba visual CRUD editada");
  await page.click(".admin-preview-form button[type=submit]");
  await page.waitForFunction(() => document.querySelector(".admin-preview-detail-title")?.textContent === "Prueba visual CRUD editada", { timeout: 30_000 });
  await page.evaluate(() => [...document.querySelectorAll(".admin-preview-detail button")].find((button) => button.textContent === "Eliminar")?.click());
  await page.waitForSelector("#admin-delete-title");
  await page.type(".admin-preview-confirm-label input", reference);
  await page.click(".admin-preview-confirm button.danger");
  await page.waitForFunction((ref) => document.querySelector(".admin-preview-detail h2")?.textContent !== ref, { timeout: 30_000 }, reference);
  created = null;
  assert.deepEqual(errors, []);
  process.stdout.write("Panel administrativo: inicio de sesión y CRUD visual correctos.\n");
} finally {
  if (created?.article?.id) {
    await page.evaluate(async ({ id, reference }) => {
      const csrf = document.cookie.split("; ").find((part) => part.startsWith("trabajos_admin_csrf="))?.split("=")[1];
      await fetch(`/api/lab/admin/articles/${id}`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json", "x-admin-csrf": csrf },
        body: JSON.stringify({ confirmReference: reference }),
      });
    }, { id: created.article.id, reference: created.article.publicReference }).catch(() => undefined);
  }
  await browser.close();
}
