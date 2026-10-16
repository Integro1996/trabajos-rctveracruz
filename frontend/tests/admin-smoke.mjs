import process from "node:process";
import puppeteer from "puppeteer-core";

const email = process.env.ADMIN_EMAIL || process.env.TRABAJOS_ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD || process.env.TRABAJOS_ADMIN_PASSWORD;
if (!email || !password) throw new Error("Defina TRABAJOS_ADMIN_EMAIL y TRABAJOS_ADMIN_PASSWORD para el smoke administrativo.");
const executablePath = process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const frontendUrl = process.env.LAB_FRONTEND_URL || "http://localhost:3200";
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"] });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${frontendUrl}/admin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("#admin-email", { timeout: 30_000 });
  await page.type("#admin-email", email);
  await page.type("#admin-password", password);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".admin-shell", { timeout: 30_000 });
  await page.waitForSelector(".admin-result", { timeout: 30_000 });
  if (await page.$(".admin-pager")) {
    const firstReference = await page.$eval(".admin-result strong", (element) => element.textContent);
    await page.click(".admin-pager button[aria-label='Página 2']");
    await page.waitForFunction((reference) => document.querySelector(".admin-result strong")?.textContent !== reference, {}, firstReference);
    await page.click(".admin-pager button[aria-label='Página 1']");
    await page.waitForFunction((reference) => document.querySelector(".admin-result strong")?.textContent === reference, {}, firstReference);
  }
  const resultCount = await page.$$eval(".admin-result", (elements) => elements.length);
  if (resultCount) {
    await page.click(".admin-result");
    await page.waitForSelector(".admin-detail", { timeout: 30_000 });
  }
  const selectedReference = await page.$eval(".admin-detail h2", (element) => element.textContent.trim()).catch(() => null);
  const detailLoadedBefore = await page.$$eval(".admin-detail", (elements) => elements.length);
  const emergencyButtonsBefore = await page.$$eval("button", (elements) => elements.filter((button) => button.textContent?.trim() === "ACCESO DE EMERGENCIA").length);
  const auditRowsBefore = await page.$$eval(".audit-card tbody tr", (elements) => elements.length);
  let viewIframeLoaded = false;
  if (resultCount) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Abrir documento")?.click());
    await page.waitForSelector("iframe", { timeout: 50_000 });
    viewIframeLoaded = true;
  }
  const result = {
    title: await page.title(), pageUrl: page.url(), resultCount, selectedReference, viewIframeLoaded,
    adminShell: await page.$$eval(".admin-shell", (elements) => elements.length),
    detailLoaded: detailLoadedBefore,
    emergencyButtons: emergencyButtonsBefore,
    auditRows: auditRowsBefore, errors,
  };
  await page.screenshot({ path: process.env.LAB_ADMIN_SCREENSHOT_PATH || "admin-smoke.png", fullPage: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.adminShell || !result.detailLoaded || !viewIframeLoaded || result.emergencyButtons !== 1 || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
