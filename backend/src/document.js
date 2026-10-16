import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Math as DocxMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSuperScript,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import mammoth from "mammoth";
import { countWords, LIMITS } from "./validation.js";
import { applyPageTemplate, PAGE_BODY_WIDTH_TWIPS, PAGE_SIDE_MARGIN_TWIPS } from "./page-template.js";
import { scientificNameRuns } from "./scientific-names.js";
import { normalizeSectionBlocks, SECTION_ORDER } from "./sections.js";
import { parseFormulaLatex, splitInlineMath } from "./formulas.js";

const PAIRED_CELL_WIDTH_TWIPS = PAGE_BODY_WIDTH_TWIPS / 2;
const PAIRED_IMAGE_MAX_WIDTH_PX = Math.floor((PAIRED_CELL_WIDTH_TWIPS - 120) / 15) - 4;

function formulaComponents(nodes) {
  return nodes.flatMap((node) => {
    if (node.type === "group") return formulaComponents(node.children);
    if (node.type === "text") return [new MathRun(node.value)];
    if (node.type === "fraction") return [new MathFraction({ numerator: formulaComponents(node.numerator), denominator: formulaComponents(node.denominator) })];
    if (node.type === "radical") return [new MathRadical({ children: formulaComponents(node.children) })];
    const base = formulaComponents(node.base);
    const subScript = node.sub && formulaComponents(node.sub);
    const superScript = node.sup && formulaComponents(node.sup);
    if (subScript && superScript) return [new MathSubSuperScript({ children: base, subScript, superScript })];
    if (subScript) return [new MathSubScript({ children: base, subScript })];
    return [new MathSuperScript({ children: base, superScript })];
  });
}

function formulaParagraph(latex, paired = false) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: paired ? 70 : 100, after: paired ? 70 : 110 },
    keepLines: true,
    keepNext: true,
    children: [new DocxMath({ children: formulaComponents(parseFormulaLatex(latex)) })],
  });
}

function formulaDescriptionParagraph(description) {
  const explanation = String(description || "").trim().replace(/^D[oó]nde:\s*/iu, "");
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 130, line: 250 },
    style: "FormulaDescription",
    children: [
      new TextRun({ text: "Donde: ", font: "Arial", size: 18 }),
      ...splitInlineMath(explanation).flatMap((part) => part.type === "math"
        ? [new DocxMath({ children: formulaComponents(part.nodes) })]
        : scientificNameRuns(part.text, { font: "Arial", size: 18 })),
    ],
  });
}

function pairedFormulaChildren(first, second) {
  const cellWidth = PAIRED_CELL_WIDTH_TWIPS;
  const cell = (children) => new TableCell({
    width: { size: cellWidth, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 20, bottom: 20, left: 70, right: 70 },
    children,
  });
  return new Table({
    width: { size: cellWidth * 2, type: WidthType.DXA },
    columnWidths: [cellWidth, cellWidth],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ cantSplit: true, children: [first, second].map((block) => cell([formulaParagraph(block.latex, true)])) }),
      new TableRow({ children: [first, second].map((block) => cell([formulaDescriptionParagraph(block.description)])) }),
    ],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
  });
}

function paragraphs(value, options = {}) {
  const lines = String(value || "").replace(/\r\n?/gu, "\n").trimEnd().split("\n");
  return lines.map((line) => new Paragraph({
    ...options,
    children: line ? scientificNameRuns(line, { font: "Arial", size: 20 }) : [],
  }));
}

function referenceParagraphs(block) {
  const title = String(block.referenceTitle || "").trim();
  const description = String(block.text || "").replace(/\r\n?/gu, "\n");
  const combined = title + (title && description.trim() ? (/[.!?:;]$/u.test(title) ? " " : ". ") : "") + description.trim();
  const entries = block.referenceTitle !== undefined
    ? [combined.replace(/\s+/gu, " ")]
    : description.split("\n");
  return entries
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      indent: { left: 720, hanging: 720 },
      spacing: { after: 180, line: 260 },
      keepLines: true,
      children: scientificNameRuns(line, { font: "Arial", size: 20 }),
    }));
}

function caption(kind, number, text, options = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 80, after: 220 },
    keepNext: false,
    ...options,
    children: [
      new TextRun({ text: `${kind} ${number}. `, bold: true, font: "Arial", size: 18 }),
      ...scientificNameRuns(String(text || "").trim(), { font: "Arial", size: 18 }),
    ],
  });
}

function imageDimensions(asset, imageScale = 100, maxWidth = 520) {
  const maxHeight = 310;
  const scale = Math.min(maxWidth / asset.width, maxHeight / asset.height, 1) * imageScale / 100;
  return {
    width: Math.max(1, Math.round(asset.width * scale)),
    height: Math.max(1, Math.round(asset.height * scale)),
  };
}

function figureChildren(block, number, asset, maxWidth = 520, rowImageHeight = null) {
  if (!asset) return [new Paragraph({ text: `[Figura no disponible]`, alignment: AlignmentType.CENTER, keepNext: true }), caption("Figura", number, block.caption)];
  const dimensions = imageDimensions(asset, block.scale ?? 100, maxWidth);
  const spaceBelowImage = rowImageHeight === null ? 0 : 80 + Math.max(0, rowImageHeight - dimensions.height) * 15;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: spaceBelowImage },
      keepNext: true,
      children: [new ImageRun({
        type: asset.mimeType === "image/png" ? "png" : "jpg",
        data: asset.buffer,
        transformation: dimensions,
      })],
    }),
    caption("Figura", number, block.caption, rowImageHeight === null ? {} : { spacing: { before: 0, after: 220 } }),
  ];
}

function pairedFigureChildren(first, second, firstNumber, assets) {
  const cellWidth = PAIRED_CELL_WIDTH_TWIPS;
  const figures = [first, second];
  const rowImageHeight = Math.max(...figures.map((block) => {
    const asset = assets.get(block.assetId);
    return asset ? imageDimensions(asset, block.scale ?? 100, PAIRED_IMAGE_MAX_WIDTH_PX).height : 0;
  }));
  const cells = figures.map((block, index) => new TableCell({
    width: { size: cellWidth, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    children: figureChildren(block, firstNumber + index, assets.get(block.assetId), PAIRED_IMAGE_MAX_WIDTH_PX, rowImageHeight),
  }));
  return new Table({
    width: { size: cellWidth * 2, type: WidthType.DXA },
    columnWidths: [cellWidth, cellWidth],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ cantSplit: true, children: cells })],
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
  });
}

function tableCellTextRuns(value, bold = false) {
  const text = String(value ?? "");
  const notation = text.match(/^(.*[+-]?\d+(?:[.,]\d+)?\s*(?:±|\+\/-)\s*[+-]?\d+(?:[.,]\d+)?)(\s*)([a-z]{1,3})$/u);
  if (!notation) return scientificNameRuns(text, { bold, font: "Arial", size: 17 });
  const [, result, spacing, letters] = notation;
  return [
    ...scientificNameRuns(result + spacing, { bold, font: "Arial", size: 17 }),
    new TextRun({ text: letters, bold, font: "Arial", size: 13, superScript: true }),
  ];
}

function tableGrid(block, widthTwips = null) {
  const rows = block.cells.map((cells, rowIndex) => new TableRow({
    cantSplit: true,
    tableHeader: rowIndex === 0,
    children: cells.map((value) => new TableCell({
      margins: { top: 70, bottom: 70, left: 90, right: 90 },
      children: [new Paragraph({
        keepNext: Boolean(block.footnote?.trim() && rowIndex === block.cells.length - 1),
        children: tableCellTextRuns(value, rowIndex === 0),
      })],
    })),
  }));
  const columnCount = block.cells[0].length;
  const columnWidth = widthTwips === null ? null : Math.floor(widthTwips / columnCount);
  return new Table({
    width: widthTwips === null ? { size: 100, type: WidthType.PERCENTAGE } : { size: widthTwips, type: WidthType.DXA },
    ...(widthTwips === null ? {} : {
      columnWidths: Array.from({ length: columnCount }, (_, index) => index === 0 ? widthTwips - columnWidth * (columnCount - 1) : columnWidth),
      layout: TableLayoutType.FIXED,
    }),
    rows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "7B879D" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "7B879D" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "7B879D" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "7B879D" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "C9D1DE" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "C9D1DE" },
    },
  });
}

function tableFootnote(block) {
  const note = String(block.footnote || "").trim().replace(/\s+/gu, " ");
  if (!note) return [];
  return [new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 40, after: 180, line: 200 },
    keepLines: true,
    children: [
      new TextRun({ text: "Nota: ", bold: true, font: "Arial", size: 16 }),
      ...scientificNameRuns(note, { font: "Arial", size: 16 }),
    ],
  })];
}

function tableChildren(block, number) {
  return [
    caption("Cuadro", number, block.caption, { keepNext: true, spacing: { before: 140, after: 80 } }),
    tableGrid(block),
    ...tableFootnote(block),
  ];
}

function pairedTableChildren(first, second, firstNumber) {
  const cellWidth = PAIRED_CELL_WIDTH_TWIPS;
  const blocks = [first, second];
  const cell = (children) => new TableCell({
    width: { size: cellWidth, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    children,
  });
  return new Table({
    width: { size: cellWidth * 2, type: WidthType.DXA },
    columnWidths: [cellWidth, cellWidth],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ cantSplit: true, children: blocks.map((block, index) => cell([
        caption("Cuadro", firstNumber + index, block.caption, { keepNext: true, spacing: { before: 80, after: 80 } }),
      ])) }),
      new TableRow({ cantSplit: true, children: blocks.map((block) => cell([
        tableGrid(block, cellWidth - 120),
        ...tableFootnote(block),
      ])) }),
    ],
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
  });
}

export function countBodyNarrativeWords({ introduction = "", blocks = [] }) {
  const ordered = normalizeSectionBlocks(blocks, null, { seedRequired: false });
  const content = SECTION_ORDER.filter((section) => !["Objetivos", "Agradecimientos"].includes(section)
    || ordered.some((block) => block.heading === section && (block.type !== "text" || block.text.trim())));
  content.push(introduction);
  for (const block of ordered) if (block.type === "text") content.push(block.referenceTitle || "", block.text);
  return countWords(content.join(" "));
}

export async function createBodyDocx({ introduction = "", blocks = [], assets = new Map() }) {
  const children = [];
  const ordered = normalizeSectionBlocks(blocks, null, { seedRequired: false });
  let figureNumber = 0;
  let tableNumber = 0;
  for (const section of SECTION_ORDER) {
    const sectionBlocks = ordered.filter((block) => block.heading === section);
    if (section === "Agradecimientos" && !sectionBlocks.length) continue;
    children.push(new Paragraph({ text: section, heading: HeadingLevel.HEADING_1, keepNext: true }));
    if (section === "Introducción" && introduction.trim()) {
      children.push(...paragraphs(introduction, { alignment: AlignmentType.JUSTIFIED, spacing: { after: 100, line: 260 } }));
    }
    for (let index = 0; index < sectionBlocks.length; index += 1) {
      const block = sectionBlocks[index];
      if (block.type === "text" && (block.text.trim() || block.referenceTitle?.trim())) {
        children.push(...(section === "Referencias bibliográficas"
          ? referenceParagraphs(block)
          : paragraphs(block.text, { alignment: AlignmentType.JUSTIFIED, spacing: { after: 100, line: 260 } })));
      } else if (block.type === "figure") {
        figureNumber += 1;
        if (block.pairWithNext && sectionBlocks[index + 1]?.type === "figure") {
          children.push(pairedFigureChildren(block, sectionBlocks[index + 1], figureNumber, assets));
          figureNumber += 1;
          index += 1;
        } else {
          children.push(...figureChildren(block, figureNumber, assets.get(block.assetId)));
        }
      } else if (block.type === "table") {
        tableNumber += 1;
        const next = sectionBlocks[index + 1];
        if (block.pairWithNext && next?.type === "table" && block.cells[0].length <= LIMITS.maxPairedTableColumns && next.cells[0].length <= LIMITS.maxPairedTableColumns) {
          children.push(pairedTableChildren(block, next, tableNumber));
          tableNumber += 1;
          index += 1;
        } else {
          children.push(...tableChildren(block, tableNumber));
        }
      } else if (block.type === "formula" && block.latex.trim()) {
        const next = sectionBlocks[index + 1];
        if (block.pairWithNext && next?.type === "formula") {
          children.push(pairedFormulaChildren(block, next));
          index += 1;
        } else {
          children.push(formulaParagraph(block.latex), formulaDescriptionParagraph(block.description));
        }
      }
    }
  }

  const doc = new Document({
    creator: "RCT Veracruz",
    title: "Cuerpo del trabajo",
    description: "Cuerpo editable del trabajo; los metadatos se conservan en la aplicación.",
    styles: {
      default: { document: { run: { font: "Arial", size: 20 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 20, bold: true, color: "000000" }, paragraph: { alignment:AlignmentType.JUSTIFIED, spacing: { before: 180, after: 90 }, keepNext: true } },
        { id: "FormulaDescription", name: "Formula Description", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 18 }, paragraph: { alignment: AlignmentType.LEFT } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 850, right: PAGE_SIDE_MARGIN_TWIPS, bottom: 850, left: PAGE_SIDE_MARGIN_TWIPS },
        },
      },
      children,
    }],
  });
  return (await applyPageTemplate(await Packer.toBuffer(doc))).buffer;
}

// Se conserva para inspeccionar versiones antiguas creadas antes del constructor por bloques.
export async function inspectDocx(buffer) {
  const { value, messages } = await mammoth.extractRawText({ buffer });
  return {
    wordCount: countWords(value),
    note: "Conteo obtenido del contenido del documento.",
    warnings: messages.map((message) => message.message).slice(0, 10),
  };
}
