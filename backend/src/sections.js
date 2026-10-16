import { createHash } from "node:crypto";

export const REQUIRED_BODY_SECTIONS = Object.freeze([
  "Objetivos",
  "Materiales y métodos",
  "Resultados y discusión",
  "Conclusiones",
  "Referencias bibliográficas",
]);

export const SECTION_ORDER = Object.freeze([
  "Introducción",
  "Objetivos",
  "Materiales y métodos",
  "Resultados y discusión",
  "Conclusiones",
  "Agradecimientos",
  "Referencias bibliográficas",
]);

const sectionSet = new Set(SECTION_ORDER);

function placeholderId(articleId, section) {
  const hex = createHash("sha256").update(`section:${articleId}:${section}`).digest("hex").slice(0, 32);
  const value = `${hex.slice(0, 12)}5${hex.slice(13, 16)}8${hex.slice(17)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

// Old articles stored the section only on the first text block. Assign following
// figures, tables, formulas and text to that section without changing their relative order.
export function normalizeSectionBlocks(blocks = [], articleId = null, { seedRequired = true } = {}) {
  const groups = new Map(SECTION_ORDER.map((section) => [section, []]));
  let currentSection = "Materiales y métodos";
  for (const block of blocks) {
    if (sectionSet.has(block.heading)) currentSection = block.heading;
    groups.get(currentSection).push({ ...block, heading: currentSection });
  }
  if (seedRequired) {
    for (const section of REQUIRED_BODY_SECTIONS) {
      if (!groups.get(section).some((block) => block.type === "text")) {
        groups.get(section).unshift({
          id: placeholderId(articleId || "new-article", section),
          type: "text",
          heading: section,
          text: "",
        });
      }
    }
  }
  return SECTION_ORDER.flatMap((section) => groups.get(section)).map((block, index, ordered) => (
    block.type === "figure" || block.type === "table" || block.type === "formula"
      ? {
          ...block,
          pairWithNext: Boolean(block.pairWithNext && ordered[index + 1]?.type === block.type
            && ordered[index + 1]?.heading === block.heading && !ordered[index - 1]?.pairWithNext),
        }
      : block
  ));
}
