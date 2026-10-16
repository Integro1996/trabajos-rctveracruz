import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";

export const storage = new S3Client({
  endpoint: /^https?:\/\//.test(config.storage.endPoint) ? config.storage.endPoint : `${config.storage.useSSL ? "https" : "http"}://${config.storage.endPoint}:${config.storage.port}`,
  region: config.storage.region,
  forcePathStyle: config.storage.forcePathStyle,
  credentials: {
    accessKeyId: config.storage.accessKey,
    secretAccessKey: config.storage.secretKey,
  },
});

export async function initializeStorage() {
  try {
    await storage.send(new HeadBucketCommand({ Bucket: config.storage.bucket }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404 && error.name !== "NotFound" && error.name !== "NoSuchBucket") throw error;
    await storage.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
  }
}

export async function putDocx(path, buffer) {
  if (!path.startsWith("articles/") || path.includes("..") || !path.endsWith(".docx")) {
    throw new Error("Ruta de almacenamiento DOCX no permitida.");
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > config.maxDocxBytes) {
    throw new Error("El DOCX está vacío o supera el límite permitido.");
  }
  await storage.send(new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: path,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
}

export async function getDocx(path) {
  if (!path.startsWith("articles/") || path.includes("..") || !path.endsWith(".docx")) {
    throw new Error("Ruta de almacenamiento DOCX no permitida.");
  }
  const result = await storage.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: path }));
  const stream = result.Body;
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > config.maxDocxBytes) throw new Error("El DOCX supera el límite permitido.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function assertAssetPath(path) {
  if (!path.startsWith("articles/") || path.includes("..") || !/\/assets\/[0-9a-f-]+\.(?:png|jpg)$/i.test(path)) {
    throw new Error("Ruta de figura no permitida.");
  }
}

export async function putAsset(path, buffer, contentType) {
  assertAssetPath(path);
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > 8 * 1024 * 1024) {
    throw new Error("La figura está vacía o supera 8 MB.");
  }
  if (!["image/png", "image/jpeg"].includes(contentType)) throw new Error("Formato de figura no permitido.");
  await storage.send(new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: path,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: contentType,
  }));
}

export async function getAsset(path) {
  assertAssetPath(path);
  const result = await storage.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: path }));
  const chunks = [];
  let size = 0;
  for await (const chunk of result.Body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error("La figura supera 8 MB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function removeObject(path) {
  if (!path.startsWith("articles/") || path.includes("..")) throw new Error("Ruta de almacenamiento no permitida.");
  await storage.send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: path }));
}

export async function removeArticleObjects(articleId) {
  const prefix = `articles/${articleId}/`;
  const objects = [];
  let continuationToken;
  do {
    const result = await storage.send(new ListObjectsV2Command({
      Bucket: config.storage.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    for (const item of result.Contents || []) {
      if (item.Key?.startsWith(prefix)) objects.push({ Key: item.Key });
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  for (let index = 0; index < objects.length; index += 1000) {
    await storage.send(new DeleteObjectsCommand({
      Bucket: config.storage.bucket,
      Delete: { Objects: objects.slice(index, index + 1000), Quiet: true },
    }));
  }
}

export async function storageHealthy() {
  await storage.send(new HeadObjectCommand({ Bucket: config.storage.bucket, Key: ".healthcheck" })).catch(async (error) => {
    if (error.$metadata?.httpStatusCode !== 404 && error.name !== "NotFound" && error.name !== "NoSuchKey") throw error;
    const body = Buffer.from("ok");
    await storage.send(new PutObjectCommand({ Bucket: config.storage.bucket, Key: ".healthcheck", Body: body }));
  });
  return true;
}
