import assert from "node:assert/strict";
import test from "node:test";
import { generationIssues } from "../src/content-validation.js";

const limits = { titleWords: 20, titleCharacters: 130, keywords: 5, authorsMax: 30 };
const valid = () => ({
  mesa: "AG",
  title: "Crecimiento de microalgas",
  authors: [{ firstName: "Ana", lastName: "Pérez", institution: "Instituto", email: "ana@example.test", isCorresponding: true }],
  keywords: ["microalgas"],
  introduction: "Introducción completa",
  blocks: [
    { id: "objectives", type: "text", heading: "Objetivos", text: "Evaluar el crecimiento" },
    { id: "methods", type: "text", heading: "Materiales y métodos", text: "Métodos" },
    { id: "results", type: "text", heading: "Resultados y discusión", text: "Resultados" },
    { id: "conclusions", type: "text", heading: "Conclusiones", text: "Conclusiones" },
    { id: "references", type: "text", heading: "Referencias bibliográficas", text: "Referencia" },
  ],
});

test("exige objetivos al final de la introducción", () => {
  const article = valid();
  article.blocks[0].text = "  ";
  assert(generationIssues(article, limits).some((issue) => issue.section === "Objetivos" && issue.target === "section-Objetivos"));
  article.blocks[0].text = "Evaluar el crecimiento";
  assert.deepEqual(generationIssues(article, limits), []);
});

test("exige una sola mesa antes de generar", () => {
  const article = valid();
  article.mesa = null;
  assert(generationIssues(article, limits).some((issue) => issue.id === "mesa-required"));
  article.mesa = "AG";
  assert.deepEqual(generationIssues(article, limits), []);
});

test("exige una palabra clave y admite hasta cinco", () => {
  const article = valid();
  article.keywords = [];
  assert(generationIssues(article, limits).some((issue) => issue.id === "keywords-required"));
  article.keywords = ["uno", "dos", "tres", "cuatro", "cinco"];
  assert.deepEqual(generationIssues(article, limits), []);
  article.keywords.push("seis");
  assert(generationIssues(article, limits).some((issue) => issue.id === "keywords-limit"));
});

test("identifica la sección y figura que requieren corrección y deja de marcarlas al editar", () => {
  const article = valid();
  article.blocks.splice(1, 0, { id: "photo", type: "figure", heading: "Materiales y métodos", caption: "" });
  const issues = generationIssues(article, limits);
  assert.deepEqual(issues.filter(issue => issue.blockId === "photo"), [{
    id: "caption-photo", section: "Materiales y métodos", target: "block-photo", blockId: "photo", message: "Escribe la descripción de la Figura 1.",
  }]);
  article.blocks[1].caption = "Cultivo de microalgas";
  assert.deepEqual(generationIssues(article, limits), []);
});

test("ubica el contenido obligatorio y los datos del autor en su lugar", () => {
  const article = valid();
  article.introduction = "";
  article.authors[0].email = "";
  const issues = generationIssues(article, limits);
  assert(issues.some(issue => issue.section === "Introducción" && issue.target === "section-Introducción"));
  assert(issues.some(issue => issue.section === "Información del trabajo" && issue.target === "author-0"));
  article.authors[0].email = "correo-inválido";
  assert(generationIssues(article, limits).some(issue => issue.id === "author-email-format-0"));
});

test("señala la fórmula vacía o con comandos todavía incompatibles", () => {
  const article = valid();
  article.blocks.splice(1, 0, { id: "growth", type: "formula", heading: "Materiales y métodos", latex: "", description: "" });
  assert(generationIssues(article, limits).some(issue => issue.blockId === "growth" && issue.section === "Materiales y métodos"));
  article.blocks[1].latex = String.raw`\begin{matrix}1\end{matrix}`;
  assert(generationIssues(article, limits).some(issue => issue.blockId === "growth" && issue.message.includes("compatible")));
  article.blocks[1].latex = String.raw`\mu=\frac{\ln N_{t_1}-\ln N_{t_0}}{\Delta t}`;
  article.blocks[1].description = "μ es la tasa de crecimiento específico.";
  assert.deepEqual(generationIssues(article, limits), []);
});

test('distingue recuadros incompletos, recuadros completados y colores', () => {
  const article = valid();
  const formula = { id: 'formula', type: 'formula', heading: 'Materiales y métodos', latex: '', description: 'x es la variable.' };
  article.blocks.push(formula);
  for (const latex of [String.raw`\frac{x}{\placeholder{}}`, String.raw`\placeholder[id][locked]{ }`, String.raw`\placeholder{{}}`, String.raw`\placeholder`, String.raw`\sqrt{\placeholder{\placeholder{}}}`]) {
    formula.latex = latex;
    const issue = generationIssues(article, limits).find(item => item.id === 'formula-formula');
    assert(issue.message.includes('Completa los recuadros vacíos'));
    assert(!issue.message.includes('compatible'));
  }
  formula.latex = String.raw`\frac{\placeholder[id]{x_1}}{\placeholder{2}}`;
  assert.deepEqual(generationIssues(article, limits), []);
  formula.latex = String.raw`\placeholder[label{x}`;
  assert(generationIssues(article, limits).some(issue => issue.message.includes('Falta cerrar la etiqueta')));
  formula.latex = String.raw`\textcolor{red}{x}`;
  assert(generationIssues(article, limits).some(issue => issue.message.includes('sin colores')));
});
