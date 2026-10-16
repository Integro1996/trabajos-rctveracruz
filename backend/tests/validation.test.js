import test from "node:test";
import assert from "node:assert/strict";
import { articleContentSchema, draftArticleContentSchema, LIMITS, metadataSchema, parseKeywords, validateFinalContent } from "../src/validation.js";
import { normalizeSectionBlocks, REQUIRED_BODY_SECTIONS } from "../src/sections.js";

test('un borrador nuevo permite datos vacíos, pero la generación exige completarlos', () => {
  const blank = {
    title: '', mesa: null, keywords: [], introduction: '', blocks: [],
    authors: [{ firstName: '', lastName: '', email: '', institution: '', orcid: '', isCorresponding: true }],
  };
  assert.equal(draftArticleContentSchema.safeParse(blank).success, true);
  assert.equal(draftArticleContentSchema.safeParse({ ...blank, authors: [{ ...blank.authors[0], firstName: 'Ana' }] }).success, true);
  assert.equal(articleContentSchema.safeParse(blank).success, false);
  assert.equal(draftArticleContentSchema.safeParse({ ...blank, authors: [{ ...blank.authors[0], email: 'correo-inválido' }] }).success, false);
});

test('la explicación matemática de Donde rechaza comandos no compatibles', () => {
  const base = { ...metadata(), introduction: 'Inicio', blocks: [{
    id: '77777777-7777-4777-8777-777777777777', type: 'formula', heading: 'Introducción', latex: 'x=1',
    description: String.raw`$\color{red}{x}$ es el valor observado.`,
  }] };
  assert(validateFinalContent(base).some(message => message.includes('sin colores')));
  assert(validateFinalContent({ ...base, blocks: [{ ...base.blocks[0], description: String.raw`$$\mu` }] })
    .some(message => message.includes('Cierra la notación matemática')));
});

test('la fórmula se acepta como elemento y se exige contenido válido al generar', () => {
  const formula = { id: '77777777-7777-4777-8777-777777777777', type: 'formula', heading: 'Introducción', latex: String.raw`T_d=\frac{\log 2}{\mu}`, description: 'Td es el tiempo de duplicación.' };
  const content = { ...metadata(), introduction: 'Intro', blocks: [formula] };
  assert.equal(articleContentSchema.safeParse(content).success, true);
  assert(!validateFinalContent(content).some((message) => message.includes('Fórmula')));
  assert(validateFinalContent({ ...content, blocks: [{ ...formula, latex: '' }] }).some((message) => message.includes('Fórmula 1')));
  assert(validateFinalContent({ ...content, blocks: [{ ...formula, description: '' }] }).some((message) => message.includes('Donde:')));
  assert(validateFinalContent({ ...content, blocks: [{ ...formula, latex: String.raw`\matrix{1}` }] }).some((message) => message.includes('compatible')));
  const second = { ...formula, id: '88888888-8888-4888-8888-888888888888', latex: String.raw`\mu=\frac{1}{2}` };
  assert.equal(articleContentSchema.safeParse({ ...content, blocks: [{ ...formula, pairWithNext: true }, second] }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...content, blocks: [{ ...formula, pairWithNext: true }] }).success, false);
});

const author = {
  firstName: "Ana",
  lastName: "Pérez",
  email: "ana@example.test",
  institution: "INIFAP",
  orcid: "0000-0002-1825-0097",
  isCorresponding: true,
};

function metadata(overrides = {}) {
  return { title: "Este es un título", mesa: "AG", status: "draft", authors: [author], keywords: ["prueba"], ...overrides };
}

test("acepta una sola mesa de las seis disponibles", () => {
  for (const mesa of ["AG", "PE", "FO", "MA", "AE", "AI"]) assert.equal(metadataSchema.safeParse(metadata({ mesa })).success, true);
  assert.equal(metadataSchema.safeParse(metadata({ mesa: ["AG", "PE"] })).success, false);
  assert.equal(metadataSchema.safeParse(metadata({ mesa: "XX" })).success, false);
  assert(validateFinalContent({ ...metadata({ mesa: null }), introduction: "", blocks: [] }).some((message) => message.includes("Selecciona una mesa")));
});

test("acepta un título corto", () => {
  assert.equal(metadataSchema.safeParse(metadata()).success, true);
});

test("rechaza más de 20 palabras", () => {
  const title = Array.from({ length: LIMITS.titleWords + 1 }, (_, index) => `p${index}`).join(" ");
  assert.equal(metadataSchema.safeParse(metadata({ title })).success, false);
});

test("rechaza más de 130 caracteres", () => {
  assert.equal(metadataSchema.safeParse(metadata({ title: "a".repeat(LIMITS.titleCharacters + 1) })).success, false);
});

test("frutales, Algas verdes son dos keywords", () => {
  assert.deepEqual(parseKeywords("frutales, Algas verdes"), ["frutales", "Algas verdes"]);
});

test("acepta 5 palabras clave y rechaza 6", () => {
  const five = Array.from({ length: 5 }, (_, index) => `k${index}`);
  assert.equal(metadataSchema.safeParse(metadata({ keywords: five })).success, true);
  assert.equal(metadataSchema.safeParse(metadata({ keywords: [...five, "k5"] })).success, false);
  assert(validateFinalContent({ ...metadata({ keywords: [] }), introduction: "", blocks: [] }).some((message) => message.includes("palabra clave")));
});

test("rechaza cero autores", () => {
  assert.equal(metadataSchema.safeParse(metadata({ authors: [] })).success, false);
});

test("solo el autor correspondiente necesita correo", () => {
  const collaborator = { firstName: "Luis", lastName: "Ruiz", institution: "INIFAP", orcid: "", isCorresponding: false };
  const valid = metadataSchema.safeParse(metadata({ authors: [author, collaborator] }));
  assert.equal(valid.success, true);
  assert.equal(valid.data.authors[1].email, "");
  assert.equal(metadataSchema.safeParse(metadata({ authors: [{ ...author, email: "" }, collaborator] })).success, false);
  assert.equal(metadataSchema.safeParse(metadata({ authors: [author, { ...collaborator, email: "correo inválido" }] })).success, false);
});

test("acepta bloques de texto, figura y tabla", () => {
  const content = {
    ...metadata(),
    introduction: "Introducción de prueba",
    blocks: [
      { id: "77777777-7777-4777-8777-777777777777", type: "text", heading: "Objetivos", text: "Evaluar el estudio" },
      { id: "11111111-1111-4111-8111-111111111111", type: "text", heading: "Materiales y métodos", text: "Contenido" },
      { id: "22222222-2222-4222-8222-222222222222", type: "figure", heading: "Materiales y métodos", assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", caption: "Descripción" },
      { id: "33333333-3333-4333-8333-333333333333", type: "table", heading: "Materiales y métodos", caption: "Resultados", cells: [["A", "B"], ["1", "2"]] },
      { id: "44444444-4444-4444-8444-444444444444", type: "text", heading: "Resultados y discusión", text: "Resultados" },
      { id: "55555555-5555-4555-8555-555555555555", type: "text", heading: "Conclusiones", text: "Conclusión" },
      { id: "66666666-6666-4666-8666-666666666666", type: "text", heading: "Referencias bibliográficas", text: "Referencia" },
    ],
  };
  assert.equal(articleContentSchema.safeParse(content).success, true);
  assert.deepEqual(validateFinalContent(content), []);
});

test("rechaza tablas irregulares o con más de 10 columnas", () => {
  const base = { ...metadata(), introduction: "Intro" };
  const irregular = { ...base, blocks: [{ id: "33333333-3333-4333-8333-333333333333", type: "table", caption: "Resultados", cells: [["A", "B"], ["1"]] }] };
  const wide = { ...base, blocks: [{ id: "33333333-3333-4333-8333-333333333333", type: "table", caption: "Resultados", cells: [Array.from({ length: LIMITS.maxTableColumns + 1 }, () => "x")] }] };
  assert.equal(articleContentSchema.safeParse(irregular).success, false);
  assert.equal(articleContentSchema.safeParse(wide).success, false);
});

test("permite varias figuras por sección y solo dos juntas por fila", () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const figures = ids.map((id) => ({ id, type: "figure", assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", caption: "Gráfica" }));
  const base = { ...metadata(), introduction: "Intro" };
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: figures }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [{ ...figures[0], pairWithNext: true }, figures[1]] }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [{ ...figures[0], pairWithNext: true }, figures[1], { ...figures[2], heading: "Resultados y discusión" }] }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [
    { ...figures[0], pairWithNext: true }, figures[1],
    { ...figures[2], pairWithNext: true }, { ...figures[0], id: "44444444-4444-4444-8444-444444444444" },
    { ...figures[0], id: "55555555-5555-4555-8555-555555555555" },
  ] }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [{ ...figures[0], pairWithNext: true }, { ...figures[1], pairWithNext: true }, figures[2]] }).success, false);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [{ ...figures[0], pairWithNext: true }] }).success, false);
});

test("solo empareja tablas de hasta cuatro columnas y explica el límite de anchura", () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const tables = ids.map((id) => ({ id, type: "table", caption: "Resultados", cells: [["A", "B", "C", "D"], ["1", "2", "3", "4"]] }));
  const base = { ...metadata(), introduction: "Intro" };
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: tables }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [{ ...tables[0], pairWithNext: true }, tables[1], { ...tables[2], heading: "Resultados y discusión" }] }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [
    { ...tables[0], pairWithNext: true }, tables[1],
    { ...tables[2], pairWithNext: true }, { ...tables[0], id: "44444444-4444-4444-8444-444444444444" },
  ] }).success, true);
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [{ ...tables[0], pairWithNext: true }, { ...tables[1], pairWithNext: true }, tables[2]] }).success, false);
  const wide = { ...tables[1], cells: [["A", "B", "C", "D", "E"]] };
  const invalid = articleContentSchema.safeParse({ ...base, blocks: [{ ...tables[0], pairWithNext: true }, wide] });
  assert.equal(invalid.success, false);
  assert(invalid.error.issues.some(issue => issue.message.includes("anchura")));
  assert.equal(articleContentSchema.safeParse({ ...base, blocks: [tables[0], wide] }).success, true);
});

test("finalización exige objetivos y las demás secciones obligatorias", () => {
  const errors = validateFinalContent({ introduction: "", blocks: [{ type: "figure", caption: "" }] });
  assert.equal(errors.length, 9);
  assert(errors.includes("Selecciona una mesa para tu trabajo."));
  for (const section of REQUIRED_BODY_SECTIONS) assert(errors.some((message) => message.includes(section)));
  assert(errors.includes("Figura 1 de «Materiales y métodos» necesita una descripción."));
});

test("acepta la introducción escrita después de una figura o tabla", () => {
  const content = {
    mesa: "AG",
    keywords: ["prueba"],
    introduction: "",
    blocks: [
      { type: "table", heading: "Introducción", caption: "Datos de inicio", cells: [["A"]] },
      { type: "text", heading: "Introducción", text: "Texto de la introducción" },
      ...REQUIRED_BODY_SECTIONS.map((heading) => ({ type: "text", heading, text: "Contenido obligatorio" })),
    ],
  };
  assert.deepEqual(validateFinalContent(content), []);
});

test("una sección fija admite varios textos y agradecimientos opcionales", () => {
  const blocks = [
    { id: "11111111-1111-4111-8111-111111111111", type: "text", text: "Primera parte" },
    { id: "22222222-2222-4222-8222-222222222222", type: "text", text: "Segunda parte" },
  ];
  const content = { ...metadata(), introduction: "Intro", blocks };
  assert.equal(articleContentSchema.safeParse(content).success, true);
  for (const heading of ['Materiales y métodos', 'Resultados y discusión', 'Conclusiones', 'Referencias bibliográficas']) {
    const duplicate = articleContentSchema.safeParse({ ...content, blocks: blocks.map(block => ({ ...block, heading })) });
    assert.equal(duplicate.success, true);
    assert.equal(articleContentSchema.safeParse({ ...content, blocks: [{ ...blocks[0], heading }, blocks[1]] }).success, true);
  }
  const withAck = { ...content, blocks: [...blocks, { id: "33333333-3333-4333-8333-333333333333", type: "text", heading: "Agradecimientos", text: "" }] };
  assert(validateFinalContent(withAck).some((message) => message.includes("agradecimientos")));
});

test("los trabajos anteriores conservan su contenido en las secciones fijas", () => {
  const articleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const old = [
    { id: "11111111-1111-4111-8111-111111111111", type: "text", heading: "Resultados y discusión", text: "Hallazgos" },
    { id: "22222222-2222-4222-8222-222222222222", type: "figure", caption: "Gráfica", assetId: articleId },
  ];
  const first = normalizeSectionBlocks(old, articleId);
  assert.deepEqual(first, normalizeSectionBlocks(old, articleId));
  assert.equal(first.find((block) => block.type === "figure").heading, "Resultados y discusión");
  assert(REQUIRED_BODY_SECTIONS.every((section) => first.some((block) => block.heading === section && block.type === "text")));
});
