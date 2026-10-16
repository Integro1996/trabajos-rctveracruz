import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: process.env.LAB_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 700, isMobile: true, hasTouch: true });
  const url = process.env.LAB_FRONTEND_URL || "http://127.0.0.1:3200";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if ((await page.title()).startsWith("Aviso:")) {
    await page.evaluate(() => [...document.querySelectorAll("button, input, a")]
      .find((element) => (element.textContent || element.value || "").trim() === "Continuar")?.click());
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  assert.match(await page.title(), /RCT-Veracruz/, "Debe abrir la página del generador");
  await page.waitForSelector(".project-key-input input:last-child");

  const box = await page.$eval(".project-key-input", (element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  await page.mouse.click(box.x + box.width - 18, box.y + box.height / 2);
  await page.keyboard.type("cd");
  assert.equal(await page.$eval(".project-key-input input:last-child", (input) => input.value), "CD", "El extremo derecho del campo debe aceptar los últimos dos caracteres");

  await page.click("#recovery-code");
  await page.keyboard.type("fhjk");
  assert.equal(await page.$eval("#recovery-code", (input) => input.value), "FHJK");
  assert.equal(await page.$eval(".project-key-input input:last-child", (input) => input.value), "CD");
  assert.equal(await page.$eval(".project-key-input input:last-child", (input) => document.activeElement === input), true, "Al completar los primeros cuatro caracteres, el foco debe pasar al último segmento");
} finally {
  await browser.close();
}
