import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const root = path.resolve(config.storage.path);

function allowedRelativePath(value) {
  return typeof value === "string"
    && value.startsWith("articles/")
    && !value.includes("..")
    && !path.isAbsolute(value);
}

function privatePath(relativePath) {
  if (!allowedRelativePath(relativePath)) throw new Error("Ruta de almacenamiento no permitida.");
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Ruta de almacenamiento no permitida.");
  return resolved;
}

async function atomicWrite(relativePath, buffer) {
  const destination = privatePath(relativePath);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer, { mode: 0o600 });
  await rename(temporary, destination);
}

export async function initializeStorage() {
  await mkdir(root, { recursive: true, mode: 0o700 });
}

export async function putDocx(relativePath, buffer) {
  if (!relativePath.endsWith(".docx")) throw new Error("Ruta DOCX no permitida.");
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > config.maxDocxBytes) {
    throw new Error("El DOCX está vacío o supera el límite permitido.");
  }
  await atomicWrite(relativePath, buffer);
}

export async function getDocx(relativePath) {
  if (!relativePath.endsWith(".docx")) throw new Error("Ruta DOCX no permitida.");
  const file = privatePath(relativePath);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > config.maxDocxBytes) throw new Error("El DOCX no es válido.");
  return readFile(file);
}

function assertAssetPath(relativePath) {
  if (!allowedRelativePath(relativePath) || !/\/assets\/[0-9a-f-]+\.(?:png|jpg)$/i.test(relativePath)) {
    throw new Error("Ruta de figura no permitida.");
  }
}

export async function putAsset(relativePath, buffer, contentType) {
  assertAssetPath(relativePath);
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > 8 * 1024 * 1024) throw new Error("La figura está vacía o supera 8 MB.");
  if (!["image/png", "image/jpeg"].includes(contentType)) throw new Error("Formato de figura no permitido.");
  await atomicWrite(relativePath, buffer);
}

export async function getAsset(relativePath) {
  assertAssetPath(relativePath);
  const file = privatePath(relativePath);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > 8 * 1024 * 1024) throw new Error("La figura no es válida.");
  return readFile(file);
}

export async function removeObject(relativePath) {
  await unlink(privatePath(relativePath)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function removeArticleObjects(articleId) {
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) throw new Error("Identificador de artículo no permitido.");
  await rm(privatePath(`articles/${articleId}`), { recursive: true, force: true });
}

export async function storageHealthy() {
  await initializeStorage();
  const probe = privatePath(`articles/.health-${randomUUID()}`);
  await mkdir(path.dirname(probe), { recursive: true, mode: 0o700 });
  await writeFile(probe, "ok", { mode: 0o600 });
  await unlink(probe);
  return true;
}
