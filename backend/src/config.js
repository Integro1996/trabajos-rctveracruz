import process from "node:process";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function firstDefined(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function requiredAny(...names) {
  const value = firstDefined(...names);
  if (!value) throw new Error(`Falta la variable de entorno ${names.join(" o ")}.`);
  return value;
}

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isInteger(value)) throw new Error(`${name} debe ser un entero.`);
  return value;
}

function integerAny(names, fallback) {
  const source = firstDefined(...names);
  const value = Number.parseInt(source || String(fallback), 10);
  if (!Number.isInteger(value)) throw new Error(`${names.join(" o ")} debe ser un entero.`);
  return value;
}

const onlyofficeJwtSecret = required("ONLYOFFICE_JWT_SECRET");
const publicAppUrl = required("PUBLIC_APP_URL").replace(/\/$/, "");
const storageDriver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || "s3";
if (!["filesystem", "s3"].includes(storageDriver)) throw new Error("STORAGE_DRIVER debe ser filesystem o s3.");

export const config = Object.freeze({
  port: integer("PORT", 4000),
  trustProxy: process.env.TRUST_PROXY?.trim() || "",
  database: {
    host: requiredAny("DB_HOST", "PGHOST"),
    port: integerAny(["DB_PORT", "PGPORT"], 5432),
    name: requiredAny("DB_NAME", "PGDATABASE"),
    user: requiredAny("DB_USER", "PGUSER"),
    password: requiredAny("DB_PASSWORD", "PGPASSWORD"),
    ssl: firstDefined("DB_SSL", "PGSSL") === "true",
  },
  onlyofficeCallbackBaseUrl: (process.env.ONLYOFFICE_CALLBACK_BASE_URL || publicAppUrl).trim().replace(/\/$/, ""),
  onlyofficeInternalUrl: (process.env.ONLYOFFICE_INTERNAL_URL || process.env.ONLYOFFICE_PUBLIC_URL || "").trim().replace(/\/$/, ""),
  onlyofficePublicUrl: required("ONLYOFFICE_PUBLIC_URL").replace(/\/$/, ""),
  onlyofficeJwtSecret,
  onlyofficeDownloadOrigins: (process.env.ONLYOFFICE_DOWNLOAD_ORIGINS || process.env.ONLYOFFICE_PUBLIC_URL || "")
    .split(",").map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin),
  documentTokenSecret: process.env.DOCUMENT_TOKEN_SECRET?.trim() || onlyofficeJwtSecret,
  publicAppUrl,
  recoveryPepper: required("RECOVERY_PEPPER"),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  articleSessionDays: integer("ARTICLE_SESSION_DAYS", 30),
  adminSessionHours: integer("ADMIN_SESSION_HOURS", 8),
  recoveryRateLimitMax: integer("RECOVERY_RATE_LIMIT_MAX", 8),
  recoveryRateLimitWindowMinutes: integer("RECOVERY_RATE_LIMIT_WINDOW_MINUTES", 15),
  adminLoginRateLimitMax: integer("ADMIN_LOGIN_RATE_LIMIT_MAX", 6),
  adminLoginRateLimitWindowMinutes: integer("ADMIN_LOGIN_RATE_LIMIT_WINDOW_MINUTES", 15),
  temporaryAccessHours: integer("TEMPORARY_ACCESS_HOURS", 24),
  adminSeed: {
    name: firstDefined("ADMIN_NAME", "TRABAJOS_ADMIN_NAME") || "Administrador de trabajos",
    email: firstDefined("ADMIN_EMAIL", "TRABAJOS_ADMIN_EMAIL").toLowerCase(),
    password: firstDefined("ADMIN_PASSWORD", "TRABAJOS_ADMIN_PASSWORD"),
  },
  storage: {
    driver: storageDriver,
    path: process.env.STORAGE_PATH?.trim() || "/private/trabajos-storage",
    endPoint: process.env.STORAGE_ENDPOINT?.trim() || "",
    port: integer("STORAGE_PORT", 9000),
    useSSL: process.env.STORAGE_USE_SSL === "true",
    accessKey: process.env.STORAGE_ACCESS_KEY || "",
    secretKey: process.env.STORAGE_SECRET_KEY || "",
    bucket: process.env.STORAGE_BUCKET || "trabajos",
    region: process.env.STORAGE_REGION || "us-east-1",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
  },
  maxDocxBytes: integer("MAX_DOCX_BYTES", 20 * 1024 * 1024),
  seedEnabled: process.env.SEED_ENABLED === "true",
  logLevel: process.env.LOG_LEVEL || "info",
});

if (!config.onlyofficeInternalUrl) throw new Error("Falta ONLYOFFICE_INTERNAL_URL o ONLYOFFICE_PUBLIC_URL.");

export const wordCountRules = Object.freeze({
  // Regla general desactivada; conservar el límite para poder reactivarlo.
  enforceMaxWords: false,
  maxWords: 250,
  minPages: 3,
  maxPages: 5,
  countParagraphs: true,
  countHeadings: true,
  countImageCaptions: false,
  countTableCaptions: false,
  countTableCells: false,
});
