import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import mammoth from "mammoth";
import pino from "pino";
import pinoHttp from "pino-http";
import { PDFDocument } from "pdf-lib";
import { config, wordCountRules } from "./config.js";
import { databaseHealthy, inTransaction, pool } from "./db.js";
import { countBodyNarrativeWords, createBodyDocx } from "./document.js";
import { applyPageTemplate } from "./page-template.js";
import { normalizeSectionBlocks } from "./sections.js";
import { composePresentation, metadataSignature, presentationKey } from './presentation.js';
import { getAsset, getDocx, putAsset, putDocx, removeArticleObjects, removeObject, storageHealthy } from "./storage.js";
import { articleContentSchema, countWords, draftArticleContentSchema, LIMITS, metadataSchema, validateFinalContent, validationMessages } from "./validation.js";
import {
  clientIp,
  currentAdmin,
  currentArticleSession,
  issueAdminSession,
  issueArticleSession,
  parseCookies,
  requireAdmin,
  requireArticleAccess,
  revokeCurrentAdmin,
  userAgent,
} from "./auth.js";
import {
  generatePublicReference,
  hashSecret,
  lookupHash,
  normalizeHumanCode,
  normalizeProjectKey,
  SlidingWindowRateLimiter,
  credentialUsable,
  verifySecret,
} from "./security.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ["req.headers.authorization", "req.body.token", "*.password", "*.secret"],
    censor: "[REDACTED]",
  },
});

const app = express();
app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", config.trustProxy);
const onlyofficeOrigin = new URL(config.onlyofficePublicUrl).origin;
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", onlyofficeOrigin],
      connectSrc: ["'self'", onlyofficeOrigin],
      frameSrc: ["'self'", onlyofficeOrigin],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
}));
app.use(cors({ origin: config.publicAppUrl, credentials: true }));
app.use(express.json({ limit: "12mb" }));
app.use(pinoHttp({
  logger,
  serializers: {
    res(response) { return { statusCode: response.statusCode }; },
    req(request) {
      const parsed = new URL(request.url, "http://laboratorio.local");
      if (parsed.pathname.startsWith('/recover/')) parsed.pathname = '/recover/[REDACTED]';
      for (const name of ["token", "adminGrant", "grant"]) {
        if (parsed.searchParams.has(name)) parsed.searchParams.set(name, "[REDACTED]");
      }
      return { id: request.id, method: request.method, url: `${parsed.pathname}${parsed.search}`, remoteAddress: request.remoteAddress };
    },
  },
}));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryLimiter = new SlidingWindowRateLimiter({ max: config.recoveryRateLimitMax, windowMs: config.recoveryRateLimitWindowMinutes * 60_000 });
const adminLoginLimiter = new SlidingWindowRateLimiter({ max: config.adminLoginRateLimitMax, windowMs: config.adminLoginRateLimitWindowMinutes * 60_000 });

function assertUuid(value) {
  if (!uuidPattern.test(value)) {
    const error = new Error("El identificador del artículo no es válido.");
    error.status = 400;
    throw error;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function safeFilename(title) {
  const normalized = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const slug = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);
  return `${slug || "trabajo"}.docx`;
}

async function uniquePublicReference(client = pool) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reference = generatePublicReference();
    const exists = await client.query("SELECT 1 FROM trabajos_articles WHERE public_reference = $1", [reference]);
    if (!exists.rowCount) return reference;
  }
  throw new Error("No fue posible generar una Clave Proyecto única.");
}

async function getArticle(articleId, client = pool) {
  const result = await client.query(
    `SELECT a.*, COALESCE((SELECT MAX(v.version) FROM trabajos_document_versions v WHERE v.article_id = a.id), 0) AS version
     FROM trabajos_articles a WHERE a.id = $1`,
    [articleId],
  );
  if (!result.rowCount) {
    const error = new Error("El artículo experimental no existe.");
    error.status = 404;
    throw error;
  }
  const [authors, keywords, callback] = await Promise.all([
    client.query(
      `SELECT id, first_name, last_name, email, institution, orcid, is_corresponding, position
       FROM trabajos_authors WHERE article_id = $1 ORDER BY position`,
      [articleId],
    ),
    client.query("SELECT value FROM trabajos_keywords WHERE article_id = $1 ORDER BY position", [articleId]),
    client.query(
      `SELECT received_at, onlyoffice_status, result, detail FROM trabajos_callbacks
       WHERE article_id = $1 ORDER BY received_at DESC LIMIT 1`,
      [articleId],
    ),
  ]);
  const row = result.rows[0];
  row.authors = authors.rows.map((author) => ({
    id: author.id,
    firstName: author.first_name,
    lastName: author.last_name,
    email: author.email,
    institution: author.institution,
    orcid: author.orcid,
    isCorresponding: Boolean(author.is_corresponding),
    position: author.position,
  }));
  row.keywords = keywords.rows.map((keyword) => keyword.value);
  row.last_callback = callback.rowCount ? {
    receivedAt: callback.rows[0].received_at,
    status: callback.rows[0].onlyoffice_status,
    result: callback.rows[0].result,
    detail: callback.rows[0].detail,
  } : null;
  const article = mapArticle(row);
  article.previewKey = presentationKey(article);
  article.presentationKey = row.presentation_key;
  article.blocks = await getArticleBlocks(articleId, client);
  article.figureCount = article.blocks.filter((block) => block.type === "figure").length;
  article.tableCount = article.blocks.filter((block) => block.type === "table").length;
  return article;
}

async function getArticleBlocks(articleId, client = pool) {
  const result = await client.query(
    `SELECT b.*, s.mime_type, s.original_name, s.width, s.height, s.byte_size
     FROM trabajos_article_blocks b
     LEFT JOIN trabajos_article_assets s ON s.id = b.asset_id
     WHERE b.article_id = $1 ORDER BY b.position`,
    [articleId],
  );
  return normalizeSectionBlocks(result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    heading: row.section_heading || "",
    ...(row.type === "text" ? { text: row.text_content || "", ...(row.section_heading === "Referencias bibliográficas" && row.caption !== null ? { referenceTitle: row.caption } : {}) } : {}),
    ...(row.type === "formula" ? { latex: row.text_content || "", description: row.caption || "", pairWithNext: Boolean(row.pair_with_next) } : {}),
    ...(row.type === "figure" ? {
      assetId: row.asset_id,
      caption: row.caption || "",
      scale: Number(row.image_scale ?? 100),
      pairWithNext: Boolean(row.pair_with_next),
      asset: {
        id: row.asset_id,
        url: `/api/lab/articles/${articleId}/assets/${row.asset_id}`,
        originalName: row.original_name,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        byteSize: row.byte_size,
      },
    } : {}),
    ...(row.type === "table" ? { caption: row.caption || "", footnote: row.text_content || "", cells: parseJson(row.table_data, [[""]]), pairWithNext: Boolean(row.pair_with_next) } : {}),
  })), articleId);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapArticle(row) {
  return {
    id: row.id,
    publicReference: row.public_reference,
    mesa: row.mesa_code,
    title: row.title,
    bodyWordCount: row.body_word_count,
    bodyCountNote: row.body_count_note,
    status: row.status,
    documentKey: row.document_key,
    documentStoragePath: row.document_storage_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDocumentSavedAt: row.last_document_saved_at,
    introduction: row.introduction || "",
    pageCount: row.page_count === null ? null : Number(row.page_count),
    generatedAt: row.generated_at,
    contentRevision: Number(row.content_revision || 1),
    generatedRevision: row.generated_revision === null ? null : Number(row.generated_revision),
    authors: row.authors || [],
    keywords: row.keywords || [],
    version: Number(row.version || 0),
    lastCallback: row.last_callback || null,
  };
}

function contentSnapshot({ introduction, blocks }) {
  return { introduction, blocks: blocks.map(({ asset, ...block }) => block) };
}

async function loadGenerationAssets(articleId, blocks) {
  const ids = [...new Set(blocks.filter((block) => block.type === "figure").map((block) => block.assetId))];
  if (!ids.length) return new Map();
  const result = await pool.query(
    `SELECT * FROM trabajos_article_assets WHERE article_id = $1 AND id IN (${ids.map((_id, index) => `$${index + 2}`).join(", ")})`,
    [articleId, ...ids],
  );
  const assets = new Map();
  for (const row of result.rows) {
    assets.set(row.id, {
      id: row.id,
      mimeType: row.mime_type,
      originalName: row.original_name,
      width: row.width,
      height: row.height,
      buffer: await getAsset(row.storage_path),
    });
  }
  if (assets.size !== ids.length) {
    const error = new Error("Una de las figuras del artículo ya no está disponible.");
    error.status = 422;
    throw error;
  }
  return assets;
}

async function createArticleRecord({ title = "", mesa = null, authors, keywords = [], introduction = "", blocks = [], assets = new Map() }) {
  const articleId = randomUUID();
  const documentKey = `trabajos-${randomUUID()}`;
  const storagePath = `articles/${articleId}/body-current.docx`;
  const publicReference = await uniquePublicReference();
  const initialAuthors = authors || [{
    firstName: "",
    lastName: "",
    email: "",
    institution: "",
    orcid: "",
    isCorresponding: true,
  }];
  const parsed = draftArticleContentSchema.parse({ title, mesa, authors: initialAuthors, keywords, introduction, blocks: normalizeSectionBlocks(blocks, articleId) });
  const copiedAssets = new Map();
  const preparedBlocks = [];
  const assetRows = [];
  for (const block of parsed.blocks) {
    const blockId = randomUUID();
    if (block.type !== "figure") { preparedBlocks.push({ ...block, id: blockId }); continue; }
    const source = assets.get(block.assetId);
    if (!source) throw new Error("No se encontró la figura que se intentó duplicar.");
    const assetId = randomUUID();
    const extension = source.mimeType === "image/png" ? "png" : "jpg";
    const path = `articles/${articleId}/assets/${assetId}.${extension}`;
    await putAsset(path, source.buffer, source.mimeType);
    copiedAssets.set(assetId, { ...source, id: assetId });
    assetRows.push({ ...source, id: assetId, path });
    preparedBlocks.push({ ...block, id: blockId, assetId });
  }
  const generatedContent = { ...parsed, blocks: preparedBlocks };
  const buffer = await createBodyDocx({ ...generatedContent, assets: copiedAssets.size ? copiedAssets : assets });
  const wordCount = countBodyNarrativeWords(generatedContent);
  await putDocx(storagePath, buffer);
  await putDocx(`articles/${articleId}/versions/v1.docx`, buffer);

  try {
    await inTransaction(async (client) => {
      await client.query(
        `INSERT INTO trabajos_articles
          (id, public_reference, title, introduction, body_word_count, body_count_note, status, document_key, document_storage_path, mesa_code, last_document_saved_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, NOW())`,
        [articleId, publicReference, parsed.title, parsed.introduction, wordCount, "Conteo narrativo estructurado: incluye encabezados y párrafos; excluye pies y celdas.", documentKey, storagePath, parsed.mesa],
      );
      for (const [position, author] of parsed.authors.entries()) {
        await client.query(
          `INSERT INTO trabajos_authors
            (id, article_id, first_name, last_name, email, institution, orcid, is_corresponding, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), articleId, author.firstName, author.lastName, author.email, author.institution, author.orcid, author.isCorresponding, position],
        );
      }
      for (const [position, keyword] of parsed.keywords.entries()) {
        await client.query(
          "INSERT INTO trabajos_keywords (id, article_id, value, position) VALUES ($1, $2, $3, $4)",
          [randomUUID(), articleId, keyword, position],
        );
      }
      for (const asset of assetRows) {
        await client.query(
          `INSERT INTO trabajos_article_assets (id, article_id, storage_path, mime_type, original_name, width, height, byte_size)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [asset.id, articleId, asset.path, asset.mimeType, asset.originalName || "imagen", asset.width, asset.height, asset.buffer.length],
        );
      }
      for (const [position, block] of preparedBlocks.entries()) {
        await client.query(
          `INSERT INTO trabajos_article_blocks (id, article_id, type, position, text_content, caption, asset_id, table_data, image_scale, section_heading, pair_with_next)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [block.id, articleId, block.type, position, block.type === "text" ? block.text : block.type === "formula" ? block.latex : block.type === "table" ? block.footnote : null,
            block.type === "formula" ? block.description : block.type === "figure" || block.type === "table" ? block.caption : block.type === "text" && block.heading === "Referencias bibliográficas" ? block.referenceTitle ?? null : null,
            block.type === "figure" ? block.assetId : null,
            block.type === "table" ? JSON.stringify(block.cells) : null, block.scale ?? 100, block.heading || '', ["figure", "table", "formula"].includes(block.type) && block.pairWithNext === true],
        );
      }
      await client.query(
        `INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot)
         VALUES ($1, $2, 1, $3, $4, $5, $6)`,
        [randomUUID(), articleId, documentKey, `articles/${articleId}/versions/v1.docx`, wordCount, JSON.stringify(contentSnapshot(generatedContent))],
      );
    });
  } catch (error) {
    await removeArticleObjects(articleId).catch(() => undefined);
    throw error;
  }

  logger.info({ articleId, storagePath }, "Documento experimental creado");
  return getArticle(articleId);
}

async function persistArticleContent(articleId, data, client) {
  const locked = await client.query("SELECT id FROM trabajos_articles WHERE id = $1 FOR UPDATE", [articleId]);
  if (!locked.rowCount) {
    const error = new Error("El artículo experimental no existe.");
    error.status = 404;
    throw error;
  }
  const assetIds = [...new Set(data.blocks.filter((block) => block.type === "figure").map((block) => block.assetId))];
  if (assetIds.length) {
    const assets = await client.query(
      `SELECT id FROM trabajos_article_assets WHERE article_id = $1 AND id IN (${assetIds.map((_id, index) => `$${index + 2}`).join(", ")})`,
      [articleId, ...assetIds],
    );
    if (assets.rowCount !== assetIds.length) {
      const error = new Error("Una de las figuras seleccionadas no pertenece a este artículo.");
      error.status = 422;
      throw error;
    }
  }
  const previous = await getArticle(articleId, client);
  const canonicalBody = (value) => JSON.stringify({
    introduction: value.introduction,
    blocks: value.blocks.map((block) => {
      const common = { id: block.id, type: block.type, heading: block.heading || "" };
      if (block.type === "text") return { ...common, text: block.text, referenceTitle: block.referenceTitle };
      if (block.type === "figure") return { ...common, assetId: block.assetId, caption: block.caption, scale: block.scale ?? 100, pairWithNext: Boolean(block.pairWithNext) };
      if (block.type === "formula") return { ...common, latex: block.latex, description: block.description, pairWithNext: Boolean(block.pairWithNext) };
      return { ...common, caption: block.caption, footnote: block.footnote || "", pairWithNext: Boolean(block.pairWithNext), cells: block.cells };
    }),
  });
  const bodyChanged = canonicalBody(previous) !== canonicalBody(data);
  const metadataChanged = metadataSignature(previous) !== metadataSignature(data);
  await client.query(
    `UPDATE trabajos_articles SET title = $2, introduction = $3, mesa_code = $6, status = 'draft',
       page_count = CASE WHEN $4 OR $5 THEN NULL ELSE page_count END,
       presentation_key = CASE WHEN $4 OR $5 THEN NULL ELSE presentation_key END,
       generated_at = CASE WHEN $4 THEN NULL ELSE generated_at END,
       generated_revision = CASE WHEN $4 THEN NULL ELSE generated_revision END,
       content_revision = content_revision + CASE WHEN $4 THEN 1 ELSE 0 END, updated_at = NOW()
     WHERE id = $1`,
    [articleId, data.title, data.introduction, bodyChanged, metadataChanged, data.mesa],
  );
  await client.query("DELETE FROM trabajos_authors WHERE article_id = $1", [articleId]);
  await client.query("DELETE FROM trabajos_keywords WHERE article_id = $1", [articleId]);
  await client.query("DELETE FROM trabajos_article_blocks WHERE article_id = $1", [articleId]);
  for (const [position, author] of data.authors.entries()) {
    await client.query(
      `INSERT INTO trabajos_authors (id, article_id, first_name, last_name, email, institution, orcid, is_corresponding, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), articleId, author.firstName, author.lastName, author.email, author.institution, author.orcid, author.isCorresponding, position],
    );
  }
  for (const [position, keyword] of data.keywords.entries()) {
    await client.query("INSERT INTO trabajos_keywords (id, article_id, value, position) VALUES ($1, $2, $3, $4)", [randomUUID(), articleId, keyword, position]);
  }
  for (const [position, block] of data.blocks.entries()) {
    await client.query(
      `INSERT INTO trabajos_article_blocks (id, article_id, type, position, text_content, caption, asset_id, table_data, image_scale, section_heading, pair_with_next)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [block.id, articleId, block.type, position, block.type === "text" ? block.text : block.type === "formula" ? block.latex : block.type === "table" ? block.footnote : null,
        block.type === "formula" ? block.description : block.type === "figure" || block.type === "table" ? block.caption : block.type === "text" && block.heading === "Referencias bibliográficas" ? block.referenceTitle ?? null : null,
        block.type === "figure" ? block.assetId : null,
        block.type === "table" ? JSON.stringify(block.cells) : null, block.scale ?? 100, block.heading || '', ["figure", "table", "formula"].includes(block.type) && block.pairWithNext === true],
    );
  }
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === "image/png") {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) throw new Error("El archivo PNG no es válido.");
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("El archivo JPEG no es válido.");
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("No fue posible determinar las dimensiones del JPEG.");
}

function decodeImageUpload(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/u);
  if (!match) {
    const error = new Error("Selecciona una figura válida en formato PNG o JPEG.");
    error.status = 422;
    throw error;
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > LIMITS.maxImageBytes) {
    const error = new Error("La figura debe pesar menos de 8 MB.");
    error.status = 422;
    throw error;
  }
  let dimensions;
  try { dimensions = imageDimensions(buffer, match[1]); } catch (cause) {
    cause.status = 422;
    throw cause;
  }
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 12_000 || dimensions.height > 12_000 || dimensions.width * dimensions.height > 50_000_000) {
    const error = new Error("Las dimensiones de la figura no son válidas o son demasiado grandes.");
    error.status = 422;
    throw error;
  }
  return { buffer, mimeType: match[1], ...dimensions };
}

function internalOnlyofficeUrl(source) {
  const url = new URL(source);
  const internal = new URL(config.onlyofficeInternalUrl);
  const publicUrl = new URL(config.onlyofficePublicUrl);
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isPublicOrigin = url.origin === publicUrl.origin || (
    loopbackHosts.has(publicUrl.hostname) && loopbackHosts.has(url.hostname)
    && url.protocol === publicUrl.protocol && url.port === publicUrl.port
  );
  const sourceAllowed = config.onlyofficeDownloadOrigins.includes(url.origin) || isPublicOrigin;
  if (!sourceAllowed) {
    const error = new Error("ONLYOFFICE devolvió una ubicación de archivo no permitida.");
    error.status = 502;
    throw error;
  }
  if (isPublicOrigin) {
    url.protocol = internal.protocol;
    url.hostname = internal.hostname;
    url.port = internal.port;
  }
  const internalPort = internal.port || (internal.protocol === "https:" ? "443" : "80");
  const urlPort = url.port || (url.protocol === "https:" ? "443" : "80");
  const isInternal = url.protocol === internal.protocol && url.hostname === internal.hostname && urlPort === internalPort;
  const isAllowedExternal = config.onlyofficeDownloadOrigins.includes(url.origin) && url.protocol === "https:";
  if (!isInternal && !isAllowedExternal) {
    const error = new Error("ONLYOFFICE devolvió una ubicación de archivo no permitida.");
    error.status = 502;
    throw error;
  }
  return url;
}

async function fetchOnlyofficeFile(source, timeoutMs) {
  let current = internalOnlyofficeUrl(source);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("ONLYOFFICE devolvió una redirección sin destino.");
    current = internalOnlyofficeUrl(new URL(location, current).href);
  }
  throw new Error("ONLYOFFICE devolvió demasiadas redirecciones.");
}

async function renderPdf(article, storagePath, documentKey) {
  const sourceToken = jwt.sign(
    { purpose: "generation-source", articleId: article.id, documentKey, storagePath, includeMetadata: true, metadataHash: metadataSignature(article) },
    config.documentTokenSecret,
    { algorithm: "HS256", expiresIn: "10m" },
  );
  const conversion = {
    async: false,
    filetype: "docx",
    key: documentKey,
    outputtype: "pdf",
    title: safeFilename(article.title),
    url: `${config.onlyofficeCallbackBaseUrl}/api/documents/${article.id}/file?token=${encodeURIComponent(sourceToken)}`,
  };
  const token = jwt.sign(conversion, config.onlyofficeJwtSecret, { algorithm: "HS256", expiresIn: "10m" });
  const response = await fetch(`${config.onlyofficeInternalUrl}/converter?shardkey=${encodeURIComponent(documentKey)}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw Object.assign(new Error(`No fue posible comprobar las páginas del documento (HTTP ${response.status}).`), { status: 502 });
  const result = await response.json();
  if (result.error || !result.endConvert || !result.fileUrl) {
    throw Object.assign(new Error(`ONLYOFFICE no terminó la comprobación de páginas${result.error ? ` (error ${result.error})` : ""}.`), { status: 502 });
  }
  const pdfResponse = await fetchOnlyofficeFile(result.fileUrl, 30_000);
  if (!pdfResponse.ok) throw Object.assign(new Error("No fue posible descargar la vista renderizada para contar sus páginas."), { status: 502 });
  const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
  if (pdfBuffer.length > 30 * 1024 * 1024) throw Object.assign(new Error("La vista renderizada es demasiado grande."), { status: 422 });
  return pdfBuffer;
}

async function countRenderedPages(article, storagePath, documentKey) {
  const pdfBuffer = await renderPdf(article, storagePath, documentKey);
  const pdf = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  return pdf.getPageCount();
}

async function ensurePresentation(article) {
  if (!article.generatedAt || (article.presentationKey === article.previewKey && article.pageCount !== null)) return article;
  const pages = await countRenderedPages(article, article.documentStoragePath, 'layout-' + article.previewKey);
  await inTransaction(async client => {
    await client.query('SELECT id FROM trabajos_articles WHERE id=$1 FOR UPDATE', [article.id]);
    const current = await getArticle(article.id, client);
    if (current.previewKey !== article.previewKey) throw Object.assign(new Error('El documento cambió durante la preparación de la vista. Vuelve a intentarlo.'), {status:409});
    await client.query("UPDATE trabajos_articles SET page_count=$2, presentation_key=$3, status=CASE WHEN $2::int < $4::int OR $2::int > $5::int THEN 'requires_changes' ELSE status END WHERE id=$1", [article.id,pages,article.previewKey,LIMITS.minPages,LIMITS.maxPages]);
  });
  return getArticle(article.id);
}

async function useRecoveryCredential(type, rawSecret) {
  const secret = type === "QR_TOKEN" ? String(rawSecret || "") : normalizeHumanCode(rawSecret);
  const lookup = lookupHash(secret, config.recoveryPepper, type);
  return inTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM trabajos_recovery_credentials WHERE lookup_hash = $1 AND type = $2 FOR UPDATE",
      [lookup, type],
    );
    if (!result.rowCount) return null;
    const credential = result.rows[0];
    const usable = credentialUsable(credential) && await verifySecret(secret, credential.secret_hash);
    if (!usable) return null;
    await client.query("UPDATE trabajos_recovery_credentials SET use_count = use_count + 1 WHERE id = $1", [credential.id]);
    return credential.article_id;
  });
}

async function audit(req, action, articleId = null, reason = null, metadata = {}, client = pool) {
  if (!req.admin) return;
  const scrub = (value) => String(value || "")
    .replace(/[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}(?:-[A-HJ-KM-NP-Z2-9]{2})?/g, "[REDACTED-CODE]")
    .replace(/\/recover\/[A-Za-z0-9_-]+/g, "/recover/[REDACTED]");
  const safeReason = reason ? scrub(reason).slice(0, 2000) : null;
  const safeMetadata = JSON.parse(JSON.stringify(metadata, (key, value) => /password|secret|token|cookie|code|grant/i.test(key) ? "[REDACTED]" : value));
  await client.query(
    `INSERT INTO trabajos_admin_audit_log (admin_id, article_id, action, reason, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [req.admin.id, articleId, action, safeReason, JSON.stringify(safeMetadata), clientIp(req), userAgent(req)],
  );
}

async function recordCallback(articleId, status, key, result, detail) {
  await pool.query(
    `INSERT INTO trabajos_callbacks (article_id, onlyoffice_status, document_key, result, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [articleId, Number.isInteger(status) ? status : null, String(key || "").slice(0, 128) || null, result, String(detail || "").slice(0, 1500)],
  );
}

function callbackJwt(req) {
  const authorization = req.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || req.body?.token;
  if (!token) throw new Error("Callback sin JWT.");
  return jwt.verify(token, config.onlyofficeJwtSecret, { algorithms: ["HS256"] });
}

function verifyCallback(req) {
  const payload = callbackJwt(req);
  const candidate = payload.payload || payload;
  if (!candidate.key || candidate.key !== req.body.key) throw new Error("El document key del JWT no coincide.");
  if (candidate.status === undefined || Number(candidate.status) !== Number(req.body.status)) {
    throw new Error("El status del JWT no coincide.");
  }
  if (candidate.url !== req.body.url) throw new Error("La URL del callback no coincide con el JWT.");
  return payload;
}

async function buildEditorConfig(article, {
  user = { id: "trabajos-user", name: "Autor del trabajo" },
  editable = true,
  grantId = "",
} = {}) {
  if (!editable) article = await ensurePresentation(article);
  const editorKey = editable ? article.documentKey : article.previewKey;
  const downloadToken = jwt.sign(
    { purpose: editable ? "document-download" : "document-preview", articleId: article.id, documentKey: editorKey },
    config.documentTokenSecret,
    { algorithm: "HS256", expiresIn: "2h" },
  );
  const editorConfig = {
    document: {
      fileType: "docx",
      key: editorKey,
      title: safeFilename(article.title),
      url: `${config.onlyofficeCallbackBaseUrl}/api/documents/${article.id}/file?token=${encodeURIComponent(downloadToken)}`,
      permissions: { chat: false, comment: false, copy: true, download: true, edit: editable, print: true, review: false },
    },
    documentType: "word",
    editorConfig: {
      lang: "es",
      mode: editable ? "edit" : "view",
      callbackUrl: `${config.onlyofficeCallbackBaseUrl}/api/onlyoffice/callback/${article.id}${grantId ? `?grant=${grantId}` : ''}`,
      user,
      customization: {
        feedback: false,
        help: true,
        hideRightMenu: true,
        anonymous: { request: false, label: "Vista previa" },
      },
    },
    type: "desktop",
  };
  editorConfig.token = jwt.sign(editorConfig, config.onlyofficeJwtSecret, { algorithm: "HS256", expiresIn: "2h" });
  return { documentServerUrl: config.onlyofficePublicUrl, config: editorConfig };
}

app.get("/health", asyncRoute(async (_req, res) => {
  const checks = await Promise.allSettled([
    databaseHealthy(),
    storageHealthy(),
    fetch(`${config.onlyofficeInternalUrl}/healthcheck`, { signal: AbortSignal.timeout(5_000) }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }),
  ]);
  const service = (index) => checks[index].status === "fulfilled" ? "connected" : "error";
  const payload = {
    status: checks.every((check) => check.status === "fulfilled") ? "ok" : "degraded",
    backend: "connected",
    postgres: service(0),
    storage: service(1),
    onlyoffice: service(2),
    jwtConfigured: Boolean(config.onlyofficeJwtSecret),
    timestamp: new Date().toISOString(),
  };
  res.status(payload.status === "ok" ? 200 : 503).json(payload);
}));

app.get("/api/lab/config", (_req, res) => {
  res.json({ limits: LIMITS, wordCountRules, onlyofficePublicUrl: config.onlyofficePublicUrl });
});

app.post("/api/lab/recover/code", asyncRoute(async (req, res) => {
  const key = `code:${clientIp(req)}`;
  const limit = recoveryLimiter.check(key);
  if (!limit.allowed) {
    await pool.query(
      "INSERT INTO trabajos_recovery_attempts (kind, successful, rate_limited, ip_address, user_agent) VALUES ('CODE', FALSE, TRUE, $1, $2)",
      [clientIp(req), userAgent(req)],
    );
    res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return res.status(429).json({ error: "No fue posible recuperar el trabajo con ese código." });
  }
  const projectKey = normalizeProjectKey(req.body?.code);
  let articleId = projectKey
    ? (await pool.query("SELECT id FROM trabajos_articles WHERE public_reference = $1", [projectKey])).rows[0]?.id
    : null;
  if (!articleId) {
    const humanCode = normalizeHumanCode(req.body?.code);
    articleId = await useRecoveryCredential("HUMAN_CODE", humanCode);
    if (!articleId) articleId = await useRecoveryCredential("TEMPORARY_CODE", humanCode);
  }
  await pool.query(
    "INSERT INTO trabajos_recovery_attempts (kind, successful, ip_address, user_agent) VALUES ('CODE', $1, $2, $3)",
    [Boolean(articleId), clientIp(req), userAgent(req)],
  );
  if (!articleId) return res.status(401).json({ error: "No se encontró un trabajo con esa Clave Proyecto." });
  recoveryLimiter.reset(key);
  await issueArticleSession(req, res, articleId, { forceNew: true });
  res.json({ article: await getArticle(articleId) });
}));

app.get("/recover/:token", asyncRoute(async (req, res) => {
  const key = `qr:${clientIp(req)}`;
  const limit = recoveryLimiter.check(key);
  const articleId = limit.allowed ? await useRecoveryCredential("QR_TOKEN", req.params.token) : null;
  await pool.query(
    "INSERT INTO trabajos_recovery_attempts (kind, successful, rate_limited, ip_address, user_agent) VALUES ('QR', $1, $2, $3, $4)",
    [Boolean(articleId), !limit.allowed, clientIp(req), userAgent(req)],
  );
  if (!articleId) return res.redirect(303, `${config.publicAppUrl}/?recovery=failed`);
  recoveryLimiter.reset(key);
  await issueArticleSession(req, res, articleId, { forceNew: true });
  res.redirect(303, `${config.publicAppUrl}/?article=${encodeURIComponent(articleId)}&recovered=qr`);
}));

app.get("/api/lab/articles", asyncRoute(async (req, res) => {
  const session = await currentArticleSession(req);
  if (!session) return res.json([]);
  const result = await pool.query(
    `SELECT DISTINCT a.id, a.public_reference, a.title, a.status, a.body_word_count, a.page_count, a.generated_at,
       a.updated_at, a.last_document_saved_at,
       (SELECT COUNT(*) FROM trabajos_article_blocks b WHERE b.article_id = a.id AND b.type = 'figure') AS figure_count,
       (SELECT COUNT(*) FROM trabajos_article_blocks b WHERE b.article_id = a.id AND b.type = 'table') AS table_count
     FROM trabajos_articles a JOIN trabajos_article_sessions s ON s.article_id = a.id
     WHERE s.session_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
     ORDER BY a.updated_at DESC`,
    [session.hash],
  );
  res.json(result.rows.map((row) => ({
    id: row.id,
    publicReference: row.public_reference,
    title: row.title,
    status: row.status,
    bodyWordCount: row.body_word_count,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    generatedAt: row.generated_at,
    figureCount: Number(row.figure_count || 0),
    tableCount: Number(row.table_count || 0),
    updatedAt: row.updated_at,
    lastDocumentSavedAt: row.last_document_saved_at,
  })));
}));

app.post("/api/lab/articles", asyncRoute(async (req, res) => {
  const title = req.body?.title ?? "";
  const article = await createArticleRecord({ title });
  try {
    await issueArticleSession(req, res, article.id);
    res.status(201).json({ article });
  } catch (error) {
    await pool.query("DELETE FROM trabajos_articles WHERE id = $1", [article.id]).catch(() => undefined);
    await removeArticleObjects(article.id).catch(() => undefined);
    throw error;
  }
}));

app.get("/api/lab/articles/:articleId", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  res.json(await getArticle(req.params.articleId));
}));

app.patch("/api/lab/articles/:articleId", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const parsed = draftArticleContentSchema.safeParse({
    ...req.body,
    blocks: Array.isArray(req.body?.blocks) ? normalizeSectionBlocks(req.body.blocks, req.params.articleId) : req.body?.blocks,
  });
  if (!parsed.success) {
    return res.status(422).json({ error: "El contenido del artículo no es válido.", details: validationMessages(parsed.error) });
  }
  const article = await inTransaction(async (client) => {
    await persistArticleContent(req.params.articleId, parsed.data, client);
    return getArticle(req.params.articleId, client);
  });
  res.json(article);
}));

app.post("/api/lab/articles/:articleId/assets", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  await getArticle(req.params.articleId);
  const image = decodeImageUpload(req.body?.dataUrl);
  const assetId = randomUUID();
  const extension = image.mimeType === "image/png" ? "png" : "jpg";
  const storagePath = `articles/${req.params.articleId}/assets/${assetId}.${extension}`;
  const originalName = String(req.body?.fileName || "imagen").replace(/[\u0000-\u001f<>:"/\\|?*]/gu, "_").slice(0, 255) || "imagen";
  await putAsset(storagePath, image.buffer, image.mimeType);
  try {
    await pool.query(
      `INSERT INTO trabajos_article_assets (id, article_id, storage_path, mime_type, original_name, width, height, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [assetId, req.params.articleId, storagePath, image.mimeType, originalName, image.width, image.height, image.buffer.length],
    );
  } catch (error) {
    await removeObject(storagePath).catch(() => undefined);
    throw error;
  }
  res.status(201).json({
    id: assetId,
    url: `/api/lab/articles/${req.params.articleId}/assets/${assetId}`,
    originalName,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    byteSize: image.buffer.length,
  });
}));

app.get("/api/lab/articles/:articleId/assets/:assetId", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  assertUuid(req.params.assetId);
  const result = await pool.query("SELECT * FROM trabajos_article_assets WHERE id = $1 AND article_id = $2", [req.params.assetId, req.params.articleId]);
  if (!result.rowCount) return res.status(404).json({ error: "La figura no existe." });
  const asset = result.rows[0];
  const buffer = await getAsset(asset.storage_path);
  res.set({ "Content-Type": asset.mime_type, "Content-Length": String(buffer.length), "Cache-Control": "private, max-age=300" }).send(buffer);
}));

app.post("/api/lab/articles/:articleId/generate", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await getArticle(req.params.articleId);
  const parsed = articleContentSchema.safeParse(article);
  if (!parsed.success) return res.status(422).json({ error: "Corrige el contenido antes de generar el documento.", details: validationMessages(parsed.error) });
  const missingContent = validateFinalContent(parsed.data);
  if (missingContent.length) return res.status(422).json({ error: "Completa las secciones antes de generar el documento.", details: missingContent });
  const preserveBody = article.generatedAt && article.generatedRevision === article.contentRevision;
  const updatedTemplate = preserveBody ? await applyPageTemplate(await getDocx(article.documentStoragePath)) : null;
  if (updatedTemplate && !updatedTemplate.changed) return res.json(await ensurePresentation(article));
  const assets = preserveBody ? new Map() : await loadGenerationAssets(article.id, parsed.data.blocks);
  const buffer = updatedTemplate?.buffer || await createBodyDocx({ ...parsed.data, assets });
  const wordCount = preserveBody ? article.bodyWordCount : countBodyNarrativeWords(parsed.data);
  if (wordCountRules.enforceMaxWords && wordCount > wordCountRules.maxWords) {
    return res.status(422).json({ error: `El cuerpo contiene ${wordCount} palabras; el máximo permitido es ${wordCountRules.maxWords}.` });
  }
  const documentKey = `trabajos-${randomUUID()}`;
  const candidatePath = `articles/${article.id}/generated/${randomUUID()}.docx`;
  await putDocx(candidatePath, buffer);
  let pageCount;
  try {
    pageCount = await countRenderedPages(article, candidatePath, documentKey);
  } catch (error) {
    await removeObject(candidatePath).catch(() => undefined);
    throw error;
  }
  try {
    await inTransaction(async (client) => {
      const locked = await client.query("SELECT content_revision, document_key FROM trabajos_articles WHERE id = $1 FOR UPDATE", [article.id]);
      if (!locked.rowCount || Number(locked.rows[0].content_revision) !== article.contentRevision || locked.rows[0].document_key !== article.documentKey || metadataSignature(await getArticle(article.id, client)) !== metadataSignature(article)) {
        const error = new Error("El contenido cambió durante la generación. Vuelve a intentarlo.");
        error.status = 409;
        throw error;
      }
      const next = await client.query("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM trabajos_document_versions WHERE article_id = $1", [article.id]);
      const version = Number(next.rows[0].version);
      const currentPath = `articles/${article.id}/body-current.docx`;
      const versionPath = `articles/${article.id}/versions/v${version}.docx`;
      await putDocx(currentPath, buffer);
      await putDocx(versionPath, buffer);
      await client.query(
        `UPDATE trabajos_articles SET document_key = $2, document_storage_path = $3, body_word_count = $4,
           body_count_note = $8, page_count = $5, generated_at = NOW(),
           generated_revision = content_revision, last_document_saved_at = NOW(), updated_at = NOW(),
           status = CASE WHEN $5::int < $6::int OR $5::int > $7::int THEN 'requires_changes' ELSE 'draft' END
         WHERE id = $1`,
        [article.id, documentKey, currentPath, wordCount, pageCount, LIMITS.minPages, LIMITS.maxPages, preserveBody ? article.bodyCountNote : 'Conteo narrativo estructurado: incluye encabezados y párrafos; excluye pies y celdas.'],
      );
      await client.query(
        `INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot, page_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), article.id, version, documentKey, versionPath, wordCount, preserveBody ? null : JSON.stringify(contentSnapshot(parsed.data)), pageCount],
      );
    });
  } catch (error) {
    await removeObject(candidatePath).catch(() => undefined);
    throw error;
  }
  await removeObject(candidatePath).catch(() => undefined);
  res.json(await getArticle(article.id));
}));

app.post("/api/lab/articles/:articleId/finalize", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await ensurePresentation(await getArticle(req.params.articleId));
  const parsed = articleContentSchema.safeParse(article);
  const errors = [
    ...(parsed.success ? [] : validationMessages(parsed.error)),
    ...(parsed.success ? validateFinalContent(parsed.data) : []),
    ...(!article.generatedAt || article.generatedRevision !== article.contentRevision ? ["Genera una vista actualizada antes de finalizar."] : []),
    ...(article.pageCount === null ? ["No fue posible comprobar el número de páginas."] : []),
    ...(article.pageCount !== null && article.pageCount < LIMITS.minPages ? [`El documento ocupa ${article.pageCount} páginas; el mínimo requerido es ${LIMITS.minPages}.`] : []),
    ...(article.pageCount > LIMITS.maxPages ? [`El documento ocupa ${article.pageCount} páginas; el máximo permitido es ${LIMITS.maxPages}.`] : []),
    ...(wordCountRules.enforceMaxWords && article.bodyWordCount > wordCountRules.maxWords ? [`El documento contiene ${article.bodyWordCount} palabras; el máximo permitido es ${wordCountRules.maxWords}.`] : []),
  ];
  if (errors.length) return res.status(422).json({ error: "El artículo no puede finalizarse.", details: errors });
  const finalized = await pool.query(
    `UPDATE trabajos_articles SET status = 'finalized', updated_at = NOW()
     WHERE id = $1 AND content_revision = $2 AND generated_revision = $2 AND document_key = $3
       AND page_count BETWEEN $4 AND $5 AND (NOT $7::boolean OR body_word_count <= $6)`,
    [article.id, article.contentRevision, article.documentKey, LIMITS.minPages, LIMITS.maxPages, wordCountRules.maxWords, wordCountRules.enforceMaxWords],
  );
  if (!finalized.rowCount) return res.status(409).json({error:'El cuerpo cambió durante la finalización. Revisa la versión actual.'});
  res.json(await getArticle(article.id));
}));

app.delete("/api/lab/articles/:articleId", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const result = await pool.query("DELETE FROM trabajos_articles WHERE id = $1", [req.params.articleId]);
  if (!result.rowCount) return res.status(404).json({ error: "El artículo experimental no existe." });
  await removeArticleObjects(req.params.articleId);
  logger.info({ articleId: req.params.articleId }, "Artículo experimental eliminado");
  res.status(204).end();
}));

app.get("/api/lab/articles/:articleId/editor-config", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await getArticle(req.params.articleId);
  if (!article.generatedAt) return res.status(409).json({ error: "Genera el documento antes de abrir la vista previa." });
  res.json(await buildEditorConfig(article, {editable: false}));
}));

app.get("/api/lab/articles/:articleId/preview.pdf", asyncRoute(requireArticleAccess), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await getArticle(req.params.articleId);
  if (!article.generatedAt) return res.status(409).json({ error: "Genera el documento antes de abrir la vista previa." });
  const ready = await ensurePresentation(article);
  const pdfBuffer = await renderPdf(ready, ready.documentStoragePath, 'layout-' + ready.previewKey);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Length": String(pdfBuffer.length),
    "Content-Disposition": `inline; filename="${safeFilename(ready.title).replace(/\.docx$/i, '.pdf')}"`,
    "Cache-Control": "private, no-store",
  }).send(pdfBuffer);
}));

function sendDocx(res, article, buffer, filename = safeFilename(article.title)) {
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Length": String(buffer.length),
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  }).send(buffer);
}

app.post("/api/lab/admin/login", asyncRoute(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const key = `admin:${clientIp(req)}:${email}`;
  const limit = adminLoginLimiter.check(key);
  if (!limit.allowed) {
    logger.warn({ ipAddress: clientIp(req), rateLimited: true }, "Login administrativo bloqueado por rate limiting");
    res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return res.status(429).json({ error: "No fue posible iniciar sesión administrativa." });
  }
  const result = await pool.query("SELECT * FROM trabajos_admin_users WHERE email = $1 AND active = TRUE", [email]);
  const admin = result.rows[0];
  const valid = admin && await verifySecret(String(req.body?.password || ""), admin.password_hash);
  if (!valid) {
    logger.warn({ ipAddress: clientIp(req), rateLimited: false }, "Login administrativo fallido");
    return res.status(401).json({ error: "No fue posible iniciar sesión administrativa." });
  }
  adminLoginLimiter.reset(key);
  const sessionId = await issueAdminSession(req, res, admin.id);
  await pool.query("UPDATE trabajos_admin_users SET last_login_at = NOW() WHERE id = $1", [admin.id]);
  req.admin = { id: admin.id, name: admin.name, email: admin.email, session_id: sessionId };
  await audit(req, "ADMIN_LOGIN", null, null, { method: "password" });
  res.json({ admin: { name: admin.name, email: admin.email } });
}));

app.get("/api/lab/admin/session", asyncRoute(async (req, res) => {
  const admin = await currentAdmin(req);
  res.json({ authenticated: Boolean(admin), admin: admin ? { name: admin.name, email: admin.email } : null });
}));

app.post("/api/lab/admin/logout", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  await revokeCurrentAdmin(req, res);
  res.status(204).end();
}));

app.get("/api/lab/admin/summary", asyncRoute(requireAdmin), asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'draft') AS drafts,
    COUNT(*) FILTER (WHERE status = 'finalized') AS finalized,
    COUNT(*) FILTER (WHERE status = 'requires_changes') AS requires_changes
    FROM trabajos_articles`);
  const row = result.rows[0];
  res.json({ total: Number(row.total), drafts: Number(row.drafts), finalized: Number(row.finalized), requiresChanges: Number(row.requires_changes) });
}));

app.get("/api/lab/admin/articles", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const search = String(req.query.q || "").trim();
  const date = String(req.query.date || "").trim();
  const status = String(req.query.status || "").trim();
  if (status && !["draft", "finalized", "requires_changes"].includes(status)) return res.status(400).json({ error: "Estado no válido." });
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) return res.status(400).json({ error: "Fecha no válida." });
  const paginated = req.query.page !== undefined;
  const requestedPage = paginated ? Number(req.query.page) : 1;
  const pageSize = paginated ? Number(req.query.pageSize || 10) : 100;
  if (!Number.isInteger(requestedPage) || requestedPage < 1 || !Number.isInteger(pageSize) || pageSize < 1 || (paginated && pageSize > 50)) {
    return res.status(400).json({ error: "La página o el tamaño de página no son válidos." });
  }
  const where = `WHERE ($1::text = '' OR a.public_reference ILIKE ('%' || $1::text || '%') OR a.title ILIKE ('%' || $1::text || '%')
       OR a.id::text ILIKE ('%' || $1::text || '%')
       OR EXISTS (SELECT 1 FROM trabajos_authors au WHERE au.article_id = a.id AND
         (au.first_name ILIKE ('%' || $1::text || '%') OR au.last_name ILIKE ('%' || $1::text || '%') OR au.email ILIKE ('%' || $1::text || '%'))))
       AND ($2::text = '' OR DATE(a.created_at) = NULLIF($2::text, '')::date)
       AND ($3::text = '' OR a.status = $3::text)`;
  const filters = [search, date, status];
  const total = paginated ? Number((await pool.query(`SELECT COUNT(*) AS total FROM trabajos_articles a ${where}`, filters)).rows[0].total) : null;
  const totalPages = paginated ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const page = Math.min(requestedPage, totalPages);
  const result = await pool.query(
    `SELECT a.id, a.public_reference, a.title, a.status, a.page_count, a.updated_at, a.created_at,
       COALESCE((SELECT CONCAT(au.first_name, ' ', au.last_name) FROM trabajos_authors au WHERE au.article_id = a.id ORDER BY au.position LIMIT 1), '') AS primary_author,
       COALESCE((SELECT MAX(v.version) FROM trabajos_document_versions v WHERE v.article_id = a.id), 0) AS version
     FROM trabajos_articles a
     ${where}
     ORDER BY a.updated_at DESC, a.id DESC LIMIT $4 OFFSET $5`,
    [...filters, pageSize, (page - 1) * pageSize],
  );
  const items = result.rows.map((row) => ({
    id: row.id, publicReference: row.public_reference, title: row.title, status: row.status,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    primaryAuthor: row.primary_author, version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  res.json(paginated ? { items, total, page, pageSize, totalPages } : items);
}));

app.post("/api/lab/admin/articles", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const parsed = articleContentSchema.safeParse({
    title: req.body?.title, mesa: req.body?.mesa, authors: req.body?.authors, keywords: req.body?.keywords,
    introduction: "", blocks: [],
  });
  if (!parsed.success) return res.status(422).json({ error: "Revisa los datos del trabajo.", details: validationMessages(parsed.error) });
  const article = await createArticleRecord(parsed.data);
  try {
    await audit(req, "CREATE_ARTICLE", article.id, null, { publicReference: article.publicReference });
    res.status(201).json({ article });
  } catch (error) {
    await pool.query("DELETE FROM trabajos_articles WHERE id = $1", [article.id]).catch(() => undefined);
    await removeArticleObjects(article.id).catch(() => undefined);
    throw error;
  }
}));

app.get("/api/lab/admin/articles/:articleId", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await getArticle(req.params.articleId);
  const [sessions, credentials, versions, onlyoffice, document] = await Promise.all([
    pool.query("SELECT COUNT(*) AS count FROM trabajos_article_sessions WHERE article_id = $1 AND revoked_at IS NULL AND expires_at > NOW()", [article.id]),
    pool.query(
      `SELECT type, SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR use_count < max_uses) THEN 1 ELSE 0 END) AS active
       FROM trabajos_recovery_credentials WHERE article_id = $1 GROUP BY type`,
      [article.id],
    ),
    pool.query("SELECT version, word_count, page_count, TRUE AS restorable, created_at FROM trabajos_document_versions WHERE article_id = $1 ORDER BY version DESC", [article.id]),
    fetch(`${config.onlyofficeInternalUrl}/healthcheck`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.ok).catch(() => false),
    getDocx(article.documentStoragePath).then((buffer) => ({ available: true, bytes: buffer.length })).catch(() => ({ available: false, bytes: 0 })),
  ]);
  await audit(req, "VIEW_ARTICLE", article.id);
  res.json({
    article,
    document,
    onlyofficeAvailable: onlyoffice,
    activeSessions: sessions.rows[0].count,
    credentials: Object.fromEntries(credentials.rows.map((row) => [row.type, row.active > 0])),
    versions: versions.rows.map((row) => ({ version: row.version, wordCount: row.word_count, pageCount: row.page_count, restorable: row.restorable, createdAt: row.created_at })),
  });
}));

app.patch("/api/lab/admin/articles/:articleId", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const metadata = metadataSchema.omit({ status: true }).safeParse(req.body);
  if (!metadata.success) return res.status(422).json({ error: "Revisa los datos del trabajo.", details: validationMessages(metadata.error) });
  const article = await inTransaction(async (client) => {
    const locked = await client.query("SELECT id FROM trabajos_articles WHERE id = $1 FOR UPDATE", [req.params.articleId]);
    if (!locked.rowCount) { const error = new Error("El trabajo ya no existe."); error.status = 404; throw error; }
    const current = await getArticle(req.params.articleId, client);
    const expectedUpdate = req.body?.updatedAt ? Date.parse(req.body.updatedAt) : null;
    if (req.body?.updatedAt && !Number.isFinite(expectedUpdate)) {
      const error = new Error("La fecha de edición no es válida."); error.status = 422; throw error;
    }
    if (expectedUpdate !== null && expectedUpdate !== new Date(current.updatedAt).getTime()) {
      const error = new Error("El trabajo cambió desde que lo abriste. Actualiza la vista antes de guardar."); error.status = 409; throw error;
    }
    const content = articleContentSchema.safeParse({
      title: metadata.data.title, mesa: metadata.data.mesa, authors: metadata.data.authors, keywords: metadata.data.keywords,
      introduction: current.introduction, blocks: current.blocks,
    });
    if (!content.success) { const error = new Error(validationMessages(content.error).join(" ")); error.status = 422; throw error; }
    await persistArticleContent(req.params.articleId, content.data, client);
    await audit(req, "UPDATE_ARTICLE", req.params.articleId, null, { publicReference: current.publicReference }, client);
    return getArticle(req.params.articleId, client);
  });
  res.json(article);
}));

app.delete("/api/lab/admin/articles/:articleId", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const deleted = await inTransaction(async (client) => {
    const result = await client.query("SELECT id, title, public_reference FROM trabajos_articles WHERE id = $1 FOR UPDATE", [req.params.articleId]);
    if (!result.rowCount) { const error = new Error("El trabajo ya no existe."); error.status = 404; throw error; }
    const row = result.rows[0];
    if (req.body?.confirmReference !== (row.public_reference || row.id)) {
      const error = new Error("Escribe la Clave Proyecto o el ID exacto para confirmar la eliminación."); error.status = 422; throw error;
    }
    await audit(req, "DELETE_ARTICLE", row.id, String(req.body?.reason || "Eliminación administrativa"),
      { publicReference: row.public_reference, title: row.title }, client);
    await client.query("DELETE FROM trabajos_articles WHERE id = $1", [row.id]);
    return row;
  });
  await removeArticleObjects(deleted.id).catch((error) => logger.error({ articleId: deleted.id, err: error }, "No se pudieron eliminar los objetos del trabajo"));
  res.status(204).end();
}));

app.get("/api/lab/admin/articles/:articleId/download", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await getArticle(req.params.articleId);
  const buffer = await composePresentation(await getDocx(article.documentStoragePath), article);
  await audit(req, "DOWNLOAD_DOCUMENT", article.id, null, { bytes: buffer.length });
  sendDocx(res, article, buffer);
}));

app.get("/api/lab/admin/articles/:articleId/versions/:version/download", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const version = Number(req.params.version);
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "Versión no válida." });
  const article = await getArticle(req.params.articleId);
  const result = await pool.query("SELECT storage_path FROM trabajos_document_versions WHERE article_id = $1 AND version = $2", [article.id, version]);
  if (!result.rowCount) return res.status(404).json({ error: "Versión no encontrada." });
  const buffer = await getDocx(result.rows[0].storage_path);
  await audit(req, "VIEW_VERSION", article.id, null, { version, bytes: buffer.length });
  sendDocx(res, article, buffer, `${article.publicReference || article.id}-v${version}.docx`);
}));

app.post("/api/lab/admin/articles/:articleId/revoke-sessions", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  await getArticle(req.params.articleId);
  const result = await pool.query(
    "UPDATE trabajos_article_sessions SET revoked_at = NOW() WHERE article_id = $1 AND revoked_at IS NULL",
    [req.params.articleId],
  );
  await audit(req, "REVOKE_SESSIONS", req.params.articleId, String(req.body?.reason || "").slice(0, 1000) || null, { revokedCount: result.rowCount });
  res.json({ revokedCount: result.rowCount });
}));

app.post("/api/lab/admin/articles/:articleId/emergency-access", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 10) return res.status(422).json({ error: "El motivo obligatorio debe tener al menos 10 caracteres." });
  const article = await getArticle(req.params.articleId);
  if (!article.generatedAt) return res.status(409).json({ error: "El documento todavía no se ha generado." });
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  const grantId = randomUUID();
  await pool.query(
    `INSERT INTO trabajos_admin_document_grants (id, admin_session_id, article_id, reason, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [grantId, req.admin.session_id, article.id, reason, expiresAt],
  );
  await audit(req, "EMERGENCY_ACCESS", article.id, reason, { expiresAt });
  res.json(await buildEditorConfig(article, {
    user: { id: `admin-${req.admin.id}`, name: req.admin.name },
    editable: true,
    grantId,
  }));
}));

app.get("/api/lab/admin/articles/:articleId/editor-config", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const article = await getArticle(req.params.articleId);
  await audit(req, "OPEN_DOCUMENT", article.id, null, { mode: "view" });
  res.json(await buildEditorConfig(article, {
    user: { id: `admin-${req.admin.id}`, name: req.admin.name },
    editable: false,
  }));
}));

app.post("/api/lab/admin/articles/:articleId/versions/:version/restore", asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const version = Number(req.params.version);
  const reason = String(req.body?.reason || "").trim();
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "Versión no válida." });
  if (reason.length < 10) return res.status(422).json({ error: "El motivo obligatorio debe tener al menos 10 caracteres." });
  const article = await getArticle(req.params.articleId);
  const source = await pool.query("SELECT storage_path, word_count, page_count, content_snapshot FROM trabajos_document_versions WHERE article_id = $1 AND version = $2", [article.id, version]);
  if (!source.rowCount) return res.status(404).json({ error: "Versión no encontrada." });
  const buffer = await getDocx(source.rows[0].storage_path);
  const nextKey = `trabajos-${randomUUID()}`;
  const restoredPageCount = await countRenderedPages(article, source.rows[0].storage_path, nextKey);
  const storedWordCount = Number(source.rows[0].word_count);
  const restoredWordCount = Number.isInteger(storedWordCount) && storedWordCount >= 0
    ? storedWordCount
    : countWords((await mammoth.extractRawText({ buffer })).value);
  const nextVersion = await inTransaction(async (client) => {
    const locked = await client.query("SELECT id FROM trabajos_articles WHERE id = $1 FOR UPDATE", [article.id]);
    if (!locked.rowCount) throw new Error("El trabajo ya no existe.");
    const snapshot = parseJson(source.rows[0].content_snapshot);
    if (snapshot) {
      const current = await getArticle(article.id, client);
      await persistArticleContent(article.id, { ...current, introduction: snapshot.introduction, blocks: snapshot.blocks }, client);
    }
    const next = await client.query("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM trabajos_document_versions WHERE article_id = $1", [article.id]);
    const versionNumber = Number(next.rows[0].version);
    const nextPath = `articles/${article.id}/versions/v${versionNumber}.docx`;
    const currentPath = `articles/${article.id}/body-current.docx`;
    await putDocx(nextPath, buffer);
    await putDocx(currentPath, buffer);
    await client.query(
      `UPDATE trabajos_articles SET document_key = $2, document_storage_path = $3, body_word_count = $4,
       body_count_note = 'Conteo restaurado de la versión del cuerpo; conserva la precisión registrada en esa versión.', page_count = $5, generated_at = NOW(),
       generated_revision = content_revision, last_document_saved_at = NOW(), updated_at = NOW(),
       status = CASE WHEN $5::int < $6::int OR $5::int > $7::int OR ($9::boolean AND $4::int > $8::int) THEN 'requires_changes' ELSE 'draft' END WHERE id = $1`,
      [article.id, nextKey, currentPath, restoredWordCount, restoredPageCount, LIMITS.minPages, LIMITS.maxPages, wordCountRules.maxWords, wordCountRules.enforceMaxWords],
    );
    await client.query(
      `INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot, page_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), article.id, versionNumber, nextKey, nextPath, restoredWordCount, source.rows[0].content_snapshot ? JSON.stringify(source.rows[0].content_snapshot) : null, restoredPageCount],
    );
    return versionNumber;
  });
  await audit(req, "RESTORE_VERSION", article.id, reason, { restoredFrom: version, createdVersion: nextVersion });
  res.json({ restoredFrom: version, createdVersion: nextVersion, article: await getArticle(article.id) });
}));

app.get("/api/lab/admin/audit", asyncRoute(requireAdmin), asyncRoute(async (_req, res) => {
  const result = await pool.query(
    `SELECT l.id, l.action, l.reason, l.metadata, l.created_at, l.article_id,
       u.name AS admin_name, u.email AS admin_email, COALESCE(a.public_reference, l.metadata->>'publicReference') AS public_reference
     FROM trabajos_admin_audit_log l
     JOIN trabajos_admin_users u ON u.id = l.admin_id
     LEFT JOIN trabajos_articles a ON a.id = l.article_id
     ORDER BY l.created_at DESC LIMIT 200`,
  );
  res.json(result.rows.map((row) => ({
    id: row.id, action: row.action, reason: row.reason, metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at, articleId: row.article_id, publicReference: row.public_reference,
    admin: { name: row.admin_name, email: row.admin_email },
  })));
}));

const serveDocumentFile = asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  let payload;
  try {
    payload = jwt.verify(String(req.query.token || ""), config.documentTokenSecret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Token de descarga inválido o vencido." });
  }
  if (!["document-download", "document-preview", "generation-source"].includes(payload.purpose) || payload.articleId !== req.params.articleId) {
    return res.status(403).json({ error: "El token no autoriza este documento." });
  }
  const article = await getArticle(req.params.articleId);
  let storagePath = article.documentStoragePath;
  if (payload.purpose === "document-download" || payload.purpose === "document-preview") {
    if (payload.documentKey !== (payload.purpose === "document-preview" ? article.previewKey : article.documentKey)) return res.status(409).json({ error: "La versión solicitada ya no está vigente." });
  } else {
    const prefix = `articles/${article.id}/`;
    if (payload.documentKey?.length < 10 || !String(payload.storagePath || "").startsWith(prefix) || !String(payload.storagePath).endsWith(".docx") || String(payload.storagePath).includes("..")) {
      return res.status(403).json({ error: "La generación solicitada no es válida." });
    }
    storagePath = payload.storagePath;
  }
  if (payload.includeMetadata && payload.metadataHash !== metadataSignature(article)) return res.status(409).json({error:'Los datos cambiaron durante la generación.'});
  const storedBuffer = await getDocx(storagePath);
  const buffer = payload.purpose === 'document-preview' || payload.includeMetadata ? await composePresentation(storedBuffer, article) : storedBuffer;
  logger.info({ articleId: article.id, bytes: buffer.length, purpose: payload.purpose }, "ONLYOFFICE solicitó el documento");
  res.set({
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Length": String(buffer.length),
    "Content-Disposition": `inline; filename="${safeFilename(article.title)}"`,
    "Cache-Control": "no-store",
  }).send(buffer);
});

app.get("/api/documents/:articleId/file", serveDocumentFile);
app.get("/api/lab/onlyoffice/document/:articleId", serveDocumentFile);

async function downloadOnlyofficeDocument(sourceUrl) {
  if (!sourceUrl) throw new Error("ONLYOFFICE no proporcionó el archivo actualizado.");
  const response = await fetchOnlyofficeFile(sourceUrl, 60_000);
  if (!response.ok) throw new Error(`No fue posible descargar el documento actualizado (HTTP ${response.status}).`);
  const advertisedSize = Number(response.headers.get("content-length") || 0);
  if (advertisedSize > config.maxDocxBytes) throw new Error("El documento actualizado supera el límite permitido.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > config.maxDocxBytes) throw new Error("El documento actualizado no es válido.");
  return buffer;
}

const receiveOnlyofficeCallback = asyncRoute(async (req, res) => {
  assertUuid(req.params.articleId);
  const status = Number(req.body?.status);
  const key = String(req.body?.key || "");
  logger.info({ articleId: req.params.articleId, status, key }, "Callback de ONLYOFFICE recibido");
  try {
    verifyCallback(req);
    const article = await getArticle(req.params.articleId);
    if (key !== article.documentKey) {
      if (key === article.previewKey && [1, 4].includes(status)) return res.json({error:0});
      throw new Error("El callback corresponde a un document key que ya no está vigente.");
    }

    if (status === 2 || status === 6) {
      assertUuid(req.query.grant);
      const grant = await pool.query(
        `SELECT g.id FROM trabajos_admin_document_grants g
         JOIN trabajos_admin_sessions s ON s.id = g.admin_session_id
         JOIN trabajos_admin_users u ON u.id = s.admin_id
         WHERE g.id=$1 AND g.article_id=$2 AND g.revoked_at IS NULL AND g.expires_at>NOW()
         AND s.revoked_at IS NULL AND s.expires_at>NOW() AND u.active=TRUE`,
        [req.query.grant, article.id],
      );
      if (!grant.rowCount) throw new Error('El acceso de emergencia expiró o fue revocado.');
      const buffer = await downloadOnlyofficeDocument(String(req.body?.url || ""));
      const temporaryPath = `articles/${article.id}/incoming/${randomUUID()}.docx`;
      await putDocx(temporaryPath, buffer);
      let pageCount;
      try {
        pageCount = await countRenderedPages(article, temporaryPath, `callback-${randomUUID()}`);
      } catch (error) {
        await removeObject(temporaryPath).catch(() => undefined);
        throw error;
      }
      const rawText = await mammoth.extractRawText({ buffer });
      const wordCount = countWords(rawText.value);
      const currentPath = `articles/${article.id}/body-current.docx`;
      await inTransaction(async (client) => {
        const locked = await client.query("SELECT document_key FROM trabajos_articles WHERE id = $1 FOR UPDATE", [article.id]);
        if (!locked.rowCount || locked.rows[0].document_key !== key) throw new Error("El documento cambió durante el guardado.");
        const next = await client.query("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM trabajos_document_versions WHERE article_id = $1", [article.id]);
        const version = Number(next.rows[0].version);
        const versionPath = `articles/${article.id}/versions/v${version}.docx`;
        await putDocx(currentPath, buffer);
        await putDocx(versionPath, buffer);
        await client.query(
          `UPDATE trabajos_articles SET document_storage_path = $2, body_word_count = $3,
             body_count_note = 'Conteo aproximado del DOCX: incluye todo el texto extraíble, también pies y celdas.', page_count = $4,
             generated_at = NOW(), content_revision = content_revision + 1, generated_revision = content_revision + 1,
             last_document_saved_at = NOW(), updated_at = NOW(),
             status = CASE WHEN $4::int < $5::int OR $4::int > $6::int OR ($8::boolean AND $3::int > $7::int) THEN 'requires_changes' ELSE 'draft' END
           WHERE id = $1`,
          [article.id, currentPath, wordCount, pageCount, LIMITS.minPages, LIMITS.maxPages, wordCountRules.maxWords, wordCountRules.enforceMaxWords],
        );
        await client.query(
          `INSERT INTO trabajos_document_versions (id, article_id, version, document_key, storage_path, word_count, content_snapshot, page_count)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
          [randomUUID(), article.id, version, key, versionPath, wordCount, pageCount],
        );
      });
      await removeObject(temporaryPath).catch(() => undefined);
      await recordCallback(article.id, status, key, "saved", "Documento actualizado y versionado.");
    } else {
      const descriptions = {
        1: "Documento abierto en vista previa.",
        3: "ONLYOFFICE informó un error.",
        4: "Documento cerrado sin cambios.",
        7: "ONLYOFFICE informó un error de guardado.",
      };
      await recordCallback(article.id, status, key, status === 3 || status === 7 ? "error" : "acknowledged", descriptions[status] || "Status recibido.");
    }
    return res.json({ error: 0 });
  } catch (error) {
    logger.error({ articleId: req.params.articleId, status, key, err: error }, "Falló el callback de ONLYOFFICE");
    await recordCallback(req.params.articleId, status, key, "error", error.message).catch(() => undefined);
    return res.json({ error: 1 });
  }
});

app.post("/api/onlyoffice/callback/:articleId", receiveOnlyofficeCallback);
app.post("/api/lab/onlyoffice/callback/:articleId", receiveOnlyofficeCallback);

app.use((req, res) => res.status(404).json({ error: "Ruta de laboratorio no encontrada." }));

app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) req.log?.error({ err: error }, "Error no controlado en la API del laboratorio");
  else req.log?.warn({ status, message: error.message }, "Solicitud rechazada por la API del laboratorio");
  res.status(status).json({
    error: status === 500 ? "No fue posible completar la operación del laboratorio." : error.message,
    ...(process.env.NODE_ENV === "development" ? { technicalDetail: error.message } : {}),
  });
});

export async function seedDatabase() {
  if (config.adminSeed.email && config.adminSeed.password) {
    const passwordHash = await hashSecret(config.adminSeed.password);
    await pool.query(
      `INSERT INTO trabajos_admin_users (id, name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), config.adminSeed.name, config.adminSeed.email, passwordHash],
    );
    logger.info({ email: config.adminSeed.email }, "Administrador de trabajos sincronizado desde variables de entorno");
  } else {
    logger.warn("ADMIN_EMAIL/ADMIN_PASSWORD no están configurados; el panel administrativo no permitirá iniciar sesión");
  }

  if (!config.seedEnabled) return;
  const count = await pool.query("SELECT COUNT(*) AS count FROM trabajos_articles");
  if (count.rows[0].count > 0) return;
  await createArticleRecord({
    title: "Efectos de algas verdes en cultivos",
    authors: [
      { firstName: "Ana", lastName: "Pérez", email: "ana@laboratorio.test", institution: "INIFAP", orcid: "0000-0002-1825-0097", isCorresponding: true },
      { firstName: "Luis", lastName: "García", email: "luis@laboratorio.test", institution: "Universidad de prueba", orcid: "", isCorresponding: false },
      { firstName: "María", lastName: "Hernández", email: "maria@laboratorio.test", institution: "Centro experimental", orcid: "", isCorresponding: false },
    ],
    keywords: ["frutales", "Algas verdes", "suelo"],
  });
  logger.info("Seed opcional del laboratorio creado");
}

export default app;
