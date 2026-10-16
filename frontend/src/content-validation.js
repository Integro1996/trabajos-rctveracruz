const REQUIRED_SECTIONS = [
  "Introducción",
  "Objetivos",
  "Materiales y métodos",
  "Resultados y discusión",
  "Conclusiones",
  "Referencias bibliográficas",
];

const words = (value) => String(value || "").trim().split(/\s+/u).filter(Boolean).length;
const filled = (value) => Boolean(String(value || "").trim());
const formulaCommands = new Set([
  "frac", "dfrac", "tfrac", "sqrt", "left", "right", "operatorname", "mathrm", "text", "quad", "qquad", "thinspace", "placeholder",
  "ln", "log", "sin", "cos", "tan", "exp", "lim", "max", "min",
  "alpha", "beta", "gamma", "delta", "Delta", "epsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega", "Gamma", "Sigma", "Omega",
  "cdot", "times", "pm", "mp", "leq", "geq", "neq", "approx", "infty", "partial", "nabla", "to", "rightarrow", "leftarrow", "div",
]);

function formulaIssue(latex) {
  if (!filled(latex)) return "Escribe la fórmula antes de generar el trabajo.";
  if (latex.length > 2000) return "La fórmula supera el límite de 2,000 caracteres.";
  for (const match of latex.matchAll(/\\placeholder\b/gu)) {
    let at = match.index + match[0].length;
    while (/\s/u.test(latex[at] || "") && at < latex.length) at += 1;
    while (latex[at] === "[") {
      const end = latex.indexOf("]", at + 1);
      if (end < 0) return "Falta cerrar la etiqueta de un recuadro de la fórmula.";
      at = end + 1;
      while (/\s/u.test(latex[at] || "") && at < latex.length) at += 1;
    }
    if (latex[at] !== "{") return "Completa los recuadros vacíos de la fórmula antes de generar el trabajo.";
    const start = ++at;
    let depth = 1;
    while (at < latex.length && depth > 0) {
      if (latex[at] === "{" && latex[at - 1] !== "\\") depth += 1;
      if (latex[at] === "}" && latex[at - 1] !== "\\") depth -= 1;
      at += 1;
    }
    if (depth) return "Falta cerrar una llave en la fórmula.";
    if (!latex.slice(start, at - 1).replace(/[\s{}]/gu, "")) {
      return "Completa los recuadros vacíos de la fórmula antes de generar el trabajo.";
    }
  }
  if (/\\(?:color|textcolor|colorbox|fcolorbox|bbox)\b/u.test(latex)) {
    return "Las fórmulas se presentan sin colores. Retira el color antes de generar el trabajo.";
  }
  const unknown = [...latex.matchAll(/\\([a-zA-Z]+)/gu)].find((match) => !formulaCommands.has(match[1]));
  if (unknown) return `El comando \\${unknown[1]} todavía no es compatible con el trabajo.`;
  let braces = 0;
  for (const char of latex) {
    if (char === "{") braces += 1;
    if (char === "}") braces -= 1;
    if (braces < 0) return "Hay una llave de cierre sin pareja en la fórmula.";
  }
  return braces ? "Falta cerrar una llave en la fórmula." : null;
}

export function generationIssues(metadata, limits) {
  if (!metadata) return [];
  const issues = [];
  const blocks = metadata.blocks || [];
  const title = metadata.title || "";
  if (!metadata.mesa) issues.push({ id: "mesa-required", section: "Información del trabajo", target: "article-mesa", message: "Selecciona una mesa para tu trabajo." });
  if (!filled(title)) issues.push({ id: "title-required", section: "Información del trabajo", target: "article-title", message: "Escribe el título." });
  if (words(title) > limits.titleWords) issues.push({ id: "title-words", section: "Información del trabajo", target: "article-title", message: `Reduce el título a ${limits.titleWords} palabras como máximo.` });
  if ([...title].length > limits.titleCharacters) issues.push({ id: "title-length", section: "Información del trabajo", target: "article-title", message: `Reduce el título a ${limits.titleCharacters} caracteres como máximo.` });

  const authors = metadata.authors || [];
  if (!authors.length) issues.push({ id: "authors-required", section: "Información del trabajo", target: "authors-list", message: "Agrega al menos un autor." });
  if (authors.length > (limits.authorsMax ?? 30)) issues.push({ id: "authors-limit", section: "Información del trabajo", target: "authors-list", message: `Usa como máximo ${limits.authorsMax ?? 30} autores.` });
  authors.forEach((author, index) => {
    if (!filled(author.firstName) || !filled(author.lastName) || !filled(author.institution)) {
      issues.push({ id: `author-${index}`, section: "Información del trabajo", target: `author-${index}`, message: `Completa el nombre, apellidos e institución del autor ${index + 1}.` });
    }
    if (author.isCorresponding && !filled(author.email)) {
      issues.push({ id: `author-email-${index}`, section: "Información del trabajo", target: `author-${index}`, message: `Escribe el correo del autor correspondiente ${index + 1}.` });
    } else if (author.isCorresponding && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(author.email)) {
      issues.push({ id: `author-email-format-${index}`, section: "Información del trabajo", target: `author-${index}`, message: `Corrige el correo del autor correspondiente ${index + 1}.` });
    }
  });
  if (!(metadata.keywords || []).length) {
    issues.push({ id: "keywords-required", section: "Información del trabajo", target: "keywords-list", message: "Agrega al menos una palabra clave." });
  }
  if ((metadata.keywords || []).length > limits.keywords) {
    issues.push({ id: "keywords-limit", section: "Información del trabajo", target: "keywords-list", message: `Usa como máximo ${limits.keywords} palabras clave.` });
  }

  for (const section of REQUIRED_SECTIONS) {
    const content = section === "Introducción" && filled(metadata.introduction)
      || blocks.some((block) => block.type === "text" && block.heading === section && filled(block.text));
    if (!content) issues.push({ id: `section-${section}`, section, target: `section-${section}`, message: "Escribe el contenido obligatorio." });
  }
  if (blocks.some((block) => block.heading === "Agradecimientos")
    && !blocks.some((block) => block.type === "text" && block.heading === "Agradecimientos" && filled(block.text))) {
    issues.push({ id: "acknowledgments", section: "Agradecimientos", target: "section-Agradecimientos", message: "Escribe los agradecimientos o desactiva la opción." });
  }

  let currentSection = "Materiales y métodos";
  let figureNumber = 0;
  let tableNumber = 0;
  let formulaNumber = 0;
  for (const block of blocks) {
    if (block.heading) currentSection = block.heading;
    if (block.type === "figure") figureNumber += 1;
    if (block.type === "table") tableNumber += 1;
    if (block.type === "formula") {
      formulaNumber += 1;
      const message = formulaIssue(block.latex || "");
      if (message) issues.push({ id: `formula-${block.id}`, section: currentSection, target: `block-${block.id}`, blockId: block.id, message: `Fórmula ${formulaNumber}: ${message}` });
      if (!filled(block.description)) issues.push({ id: `description-${block.id}`, section: currentSection, target: `block-${block.id}`, blockId: block.id, message: `Fórmula ${formulaNumber}: escribe la explicación de «Donde:».` });
    }
    if ((block.type === "figure" || block.type === "table") && !filled(block.caption)) {
      const label = block.type === "figure" ? `Figura ${figureNumber}` : `Cuadro ${tableNumber}`;
      issues.push({ id: `caption-${block.id}`, section: currentSection, target: `block-${block.id}`, blockId: block.id, message: `Escribe la descripción de ${block.type === "figure" ? "la" : "el"} ${label}.` });
    }
  }
  return issues;
}
