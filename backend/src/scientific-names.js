import { TextRun } from "docx";

const namePattern = /(?<![\p{L}\p{N}])(?<genus>\p{Lu}[\p{Ll}]{2,}|\p{Lu}\.)(?<spacing>\s+(?:×\s*)?)(?<epithet>[\p{Ll}][\p{Ll}-]{2,})(?![\p{L}\p{N}])/gu;
const spanishSentenceStarts = new Set([
  "Algunas", "Algunos", "Ambas", "Ambos", "Aquella", "Aquellas", "Aquellos", "Aquel",
  "Cada", "Como", "Cuando", "Del", "Desde", "Durante", "Esa", "Esas", "Ese", "Esos",
  "Esta", "Estas", "Este", "Estos", "La", "Las", "Los", "Mientras", "Mucha", "Muchas",
  "Mucho", "Muchos", "Ninguna", "Ningunas", "Ninguno", "Ningunos", "Otra", "Otras",
  "Otro", "Otros", "Para", "Pero", "Por", "Según", "Sin", "Sobre", "Todas", "Todos",
  "Una", "Unas", "Uno", "Unos", "Varia", "Varias", "Varios", "Mediante",
  "Cultivo", "Cultivos", "Especie", "Especies", "Familia", "Familias", "Figura", "Figuras",
  "Material", "Materiales", "Metadata", "Muestra", "Muestras", "Planta", "Plantas", "Prueba", "Pruebas",
  "Cuadro", "Cuadros", "Tabla", "Tablas", "Variedad", "Variedades",
]);
const latinEpithetEnding = /(?:mays|ensis|ense|iana|ianum|ianae|anus|ana|anum|ina|inus|ica|icum|icus|osa|osus|ata|atum|atus|arium|aris|are|eae|ellae|ella|ellus|oides|ii|ae|i|us|um|is|e|a)$/u;
const latinGenusEnding = /(?:us|um|ium|a|ia|is|as|e|ea|o|opsis|odes)$/u;

export function scientificNameRuns(value, options = {}) {
  const text = String(value ?? "");
  const { transformText, ...runOptions } = options;
  const makeRun = (part, italic = false) => new TextRun({
    ...runOptions,
    text: transformText && !italic ? transformText(part) : part,
    ...(italic ? { italics: true } : {}),
  });
  const runs = [];
  let cursor = 0;
  for (const match of text.matchAll(namePattern)) {
    const [name] = match;
    const { genus, epithet } = match.groups;
    if (spanishSentenceStarts.has(genus) || !latinEpithetEnding.test(epithet)) continue;
    // Common, unmistakably Latin generic endings keep ordinary Spanish phrases from being mistaken for binomials.
    if (!/^\p{Lu}\.$/u.test(genus) && !latinGenusEnding.test(genus)) continue;
    const start = match.index;
    if (start > cursor) runs.push(makeRun(text.slice(cursor, start)));
    runs.push(makeRun(name, true));
    cursor = start + name.length;
  }
  if (cursor < text.length || runs.length === 0) runs.push(makeRun(text.slice(cursor)));
  return runs;
}
