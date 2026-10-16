import { z } from "zod";
import { REQUIRED_BODY_SECTIONS, SECTION_ORDER } from "./sections.js";
import { parseFormulaLatex, splitInlineMath } from "./formulas.js";
import { MESA_CODES } from "./mesas.js";

export const LIMITS = Object.freeze({
  titleWords: 20,
  titleCharacters: 130,
  keywords: 5,
  authorsMin: 1,
  authorsMax: 30,
  minPages: 3,
  maxPages: 5,
  maxBlocks: 100,
  maxImageBytes: 8 * 1024 * 1024,
  maxTableRows: 50,
  maxTableColumns: 10,
  maxPairedTableColumns: 4,
});

export function normalizeSpaces(value = "") {
  return String(value).trim().replace(/\s+/gu, " ");
}

export function countWords(value = "") {
  const normalized = normalizeSpaces(value);
  return normalized ? normalized.split(" ").length : 0;
}

export function parseKeywords(value) {
  const parts = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    const keyword = normalizeSpaces(part);
    const key = keyword.toLocaleLowerCase("es-MX");
    if (keyword && !seen.has(key)) {
      seen.add(key);
      result.push(keyword);
    }
  }
  return result;
}

const authorSchema = z.object({
  id: z.union([z.string().uuid(), z.null()]).optional(),
  firstName: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
  lastName: z.string().trim().min(1, "Los apellidos son obligatorios.").max(160),
  email: z.union([z.literal(""), z.string().trim().email("El correo no es válido.").max(190)]).default(""),
  institution: z.string().trim().min(1, "La institución es obligatoria.").max(255),
  orcid: z.union([
    z.literal(""),
    z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i, "El ORCID debe tener el formato 0000-0000-0000-000X."),
  ]),
  isCorresponding: z.boolean().default(false),
}).superRefine((author, ctx) => {
  if (author.isCorresponding && !author.email) {
    ctx.addIssue({ code: "custom", path: ["email"], message: "El correo del autor correspondiente es obligatorio." });
  }
});

// A draft can be saved while its author details are still being entered.
const draftAuthorSchema = z.object({
  ...authorSchema.shape,
  firstName: z.string().trim().max(120),
  lastName: z.string().trim().max(160),
  institution: z.string().trim().max(255),
});

export const metadataSchema = z.object({
  mesa: z.enum(MESA_CODES, { error: "Selecciona una mesa válida." }).nullable().default(null),
  title: z.string().transform(normalizeSpaces).superRefine((title, ctx) => {
    if (!title) ctx.addIssue({ code: "custom", message: "El título es obligatorio." });
    if (countWords(title) > LIMITS.titleWords) {
      ctx.addIssue({ code: "custom", message: `El título supera las ${LIMITS.titleWords} palabras.` });
    }
    if ([...title].length > LIMITS.titleCharacters) {
      ctx.addIssue({ code: "custom", message: `El título supera los ${LIMITS.titleCharacters} caracteres.` });
    }
  }),
  status: z.enum(["draft", "requires_changes", "finalized"]).default("draft"),
  authors: z.array(authorSchema).min(LIMITS.authorsMin, "Debe existir al menos un autor.").max(LIMITS.authorsMax),
  keywords: z.array(z.string()).transform(parseKeywords).superRefine((keywords, ctx) => {
    if (keywords.length > LIMITS.keywords) {
      ctx.addIssue({ code: "custom", message: `Se permiten máximo ${LIMITS.keywords} palabras clave.` });
    }
  }),
});

const blockId = z.string().uuid("El elemento no tiene un identificador válido.");
const caption = z.string().trim().max(500, "La descripción no puede superar 500 caracteres.");
const blockSection = z.enum(["", ...SECTION_ORDER]).default("");
const textBlockSchema = z.object({
  id: blockId,
  type: z.literal("text"),
  text: z.string().max(100_000, "El texto es demasiado extenso."),
  referenceTitle: z.string().max(500, "El nombre o título de la referencia no puede superar 500 caracteres.").optional(),
  heading: blockSection,
});
const figureBlockSchema = z.object({
  id: blockId,
  type: z.literal("figure"),
  assetId: z.string().uuid("La figura seleccionada no es válida."),
  caption,
  heading: blockSection,
  scale: z.number().int().min(25).max(100).default(100),
  pairWithNext: z.boolean().default(false),
});
const tableBlockSchema = z.object({
  id: blockId,
  type: z.literal("table"),
  caption,
  footnote: z.string().max(2000, "La nota al pie del cuadro no puede superar 2,000 caracteres.").default(""),
  heading: blockSection,
  pairWithNext: z.boolean().default(false),
  cells: z.array(z.array(z.string().max(1_000, "Una celda supera 1,000 caracteres."))).min(1).max(LIMITS.maxTableRows),
}).superRefine((block, ctx) => {
  const columns = block.cells[0]?.length || 0;
  if (columns < 1 || columns > LIMITS.maxTableColumns) {
    ctx.addIssue({ code: "custom", message: `Los cuadros deben tener entre 1 y ${LIMITS.maxTableColumns} columnas.` });
  }
  if (block.cells.some((row) => row.length !== columns)) {
    ctx.addIssue({ code: "custom", message: "Todas las filas de un cuadro deben tener el mismo número de columnas." });
  }
});
const formulaBlockSchema = z.object({
  id: blockId,
  type: z.literal("formula"),
  heading: blockSection,
  latex: z.string().max(2000, "La fórmula supera el límite de 2,000 caracteres."),
  description: z.string().max(2000, "La explicación de la fórmula supera 2,000 caracteres.").default(""),
  pairWithNext: z.boolean().default(false),
});

export const articleContentSchema = metadataSchema.omit({ status: true }).extend({
  introduction: z.string().max(500_000, "La introducción supera el máximo técnico permitido."),
  blocks: z.array(z.discriminatedUnion("type", [textBlockSchema, figureBlockSchema, tableBlockSchema, formulaBlockSchema])).max(LIMITS.maxBlocks),
}).superRefine((content, ctx) => {
  const ids = new Set();
  let currentSection = "Materiales y métodos";
  for (const [index, block] of content.blocks.entries()) {
    if (ids.has(block.id)) ctx.addIssue({ code: "custom", message: "Hay elementos duplicados en el artículo." });
    ids.add(block.id);
    if (block.heading) currentSection = block.heading;
    const section = currentSection;
    if ((block.type === "figure" || block.type === "table" || block.type === "formula") && block.pairWithNext) {
      const next = content.blocks[index + 1];
      if (next?.type !== block.type || (next.heading || section) !== section || content.blocks[index - 1]?.pairWithNext) {
        const label = block.type === "figure" ? "figuras" : block.type === "table" ? "cuadros" : "fórmulas";
        ctx.addIssue({ code: "custom", path: ["blocks", index, "pairWithNext"], message: `Solo se pueden colocar dos ${label} ${block.type === "table" ? "consecutivos" : "consecutivas"} en una misma fila.` });
      } else if (block.type === "table" && (block.cells[0].length > LIMITS.maxPairedTableColumns || next.cells[0].length > LIMITS.maxPairedTableColumns)) {
        ctx.addIssue({ code: "custom", path: ["blocks", index, "pairWithNext"], message: `No se pueden mostrar juntos debido a la anchura de la página: cada cuadro puede tener como máximo ${LIMITS.maxPairedTableColumns} columnas.` });
      }
    }
  }
});

export const draftArticleContentSchema = articleContentSchema.safeExtend({
  title: z.string().transform(normalizeSpaces).superRefine((title, ctx) => {
    if (countWords(title) > LIMITS.titleWords) ctx.addIssue({ code: "custom", message: `El título supera las ${LIMITS.titleWords} palabras.` });
    if ([...title].length > LIMITS.titleCharacters) ctx.addIssue({ code: "custom", message: `El título supera los ${LIMITS.titleCharacters} caracteres.` });
  }),
  authors: z.array(draftAuthorSchema).min(LIMITS.authorsMin).max(LIMITS.authorsMax),
});

export function validateBodyWordCount(wordCount) {
  if (!Number.isInteger(wordCount) || wordCount < 0) {
    return { valid: false, message: "El conteo del cuerpo no es válido." };
  }
  return { valid: true, message: null };
}

export function validateFinalContent(content) {
  const errors = [];
  if (!content.mesa) errors.push("Selecciona una mesa para tu trabajo.");
  if (!(content.keywords || []).length) errors.push("Agrega al menos una palabra clave.");
  let section = "Materiales y métodos";
  const textBySection = new Map(SECTION_ORDER.map((name) => [name, []]));
  for (const block of content.blocks) {
    if (SECTION_ORDER.includes(block.heading)) section = block.heading;
    if (block.type === "text") textBySection.get(section).push(block.text);
  }
  if (!normalizeSpaces(content.introduction) && !textBySection.get("Introducción").some(normalizeSpaces)) errors.push("La introducción es obligatoria.");
  for (const name of REQUIRED_BODY_SECTIONS) {
    if (!textBySection.get(name).some(normalizeSpaces)) errors.push(`La sección «${name}» es obligatoria.`);
  }
  if (content.blocks.some((block) => block.heading === "Agradecimientos")
    && !textBySection.get("Agradecimientos").some(normalizeSpaces)) {
    errors.push("Escribe los agradecimientos o desactiva la opción.");
  }
  let mediaSection = "Materiales y métodos";
  let figureNumber = 0;
  let tableNumber = 0;
  let formulaNumber = 0;
  for (const block of content.blocks) {
    if (SECTION_ORDER.includes(block.heading)) mediaSection = block.heading;
    if (block.type === "figure") figureNumber += 1;
    if (block.type === "table") tableNumber += 1;
    if (block.type === "formula") {
      formulaNumber += 1;
      try { parseFormulaLatex(block.latex); }
      catch (error) { errors.push(`Fórmula ${formulaNumber} de «${mediaSection}»: ${error.message}`); }
      if (!normalizeSpaces(block.description)) errors.push(`Fórmula ${formulaNumber} de «${mediaSection}»: escribe la explicación de «Donde:».`);
      else {
        try { splitInlineMath(block.description); }
        catch (error) { errors.push(`Fórmula ${formulaNumber} de «${mediaSection}»: ${error.message}`); }
      }
    }
    if ((block.type === "figure" || block.type === "table") && !normalizeSpaces(block.caption)) {
      const label = block.type === "figure" ? `Figura ${figureNumber}` : `Cuadro ${tableNumber}`;
      errors.push(`${label} de «${mediaSection}» necesita una descripción.`);
    }
  }
  return errors;
}

export function validationMessages(error) {
  if (!(error instanceof z.ZodError)) return ["Los datos enviados no son válidos."];
  return [...new Set(error.issues.map((issue) => issue.message))];
}
