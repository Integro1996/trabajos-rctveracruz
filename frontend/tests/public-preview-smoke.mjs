import process from 'node:process';
import puppeteer from 'puppeteer-core';

const appUrl = process.env.LAB_FRONTEND_URL;
const docsUrl = process.env.LAB_DOCS_URL;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!appUrl || !docsUrl || !email || !password) throw new Error('Faltan LAB_FRONTEND_URL, LAB_DOCS_URL o credenciales administrativas.');

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--proxy-bypass-list=*'],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`${appUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#admin-email');
  await page.type('#admin-email', email);
  await page.type('#admin-password', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.admin-result', { timeout: 30_000 });
  await page.click('.admin-result');
  await page.waitForSelector('.admin-detail', { timeout: 30_000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Abrir documento')?.click());
  await page.waitForSelector('.editor-frame iframe', { timeout: 60_000 });
  await page.waitForFunction((origin) => [...document.querySelectorAll('iframe')].some((frame) => frame.src.startsWith(origin)), { timeout: 90_000 }, docsUrl);
  await new Promise((resolve) => setTimeout(resolve, 20_000));
  const frames = page.frames().map((frame) => frame.url()).filter((url) => url.startsWith(docsUrl));
  const editorError = await page.$eval('.editor-error', (element) => element.textContent).catch(() => null);
  if (process.env.LAB_SCREENSHOT_PATH) await page.screenshot({ path: process.env.LAB_SCREENSHOT_PATH, fullPage: true });
  process.stdout.write(JSON.stringify({ docsFrames: frames.length, editorError, errors }, null, 2) + '\n');
  if (!frames.length || editorError || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
