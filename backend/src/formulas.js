// Parse the small LaTeX vocabulary supported by the DOCX equation exporter.
// Keeping this explicit prevents an unsupported command from silently appearing
// as literal text in the generated document.
const SYMBOLS = Object.freeze({
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", phi: "φ", omega: "ω", Gamma: "Γ", Sigma: "Σ", Omega: "Ω",
  cdot: "·", times: "×", pm: "±", mp: "∓", leq: "≤", geq: "≥",
  neq: "≠", approx: "≈", infty: "∞", partial: "∂", nabla: "∇",
  to: "→", rightarrow: "→", leftarrow: "←", div: "÷",
});
const FUNCTIONS = new Set(["ln", "log", "sin", "cos", "tan", "exp", "lim", "max", "min"]);
const EMPTY_PLACEHOLDER = "Completa los recuadros vacíos de la fórmula antes de generar el documento.";

// Math between $...$, $$...$$ or \(...\) can be mixed with normal prose in “Donde:”.
export function splitInlineMath(value) {
  const source = String(value || "");
  const marker = /\$\$([^$]*?)\$\$|(?<!\$)\$(?!\$)([^$\r\n]+?)\$(?!\$)|\\\(([\s\S]*?)\\\)/gu;
  const parts = [];
  let from = 0;
  for (const match of source.matchAll(marker)) {
    if (match.index > from) parts.push({ type: "text", text: source.slice(from, match.index) });
    const latex = (match[1] ?? match[2] ?? match[3]).trim();
    if (!latex) throw new Error("Escribe un símbolo entre los signos de la notación matemática de «Donde:».");
    parts.push({ type: "math", latex, nodes: parseFormulaLatex(latex) });
    from = match.index + match[0].length;
  }
  if (from < source.length) parts.push({ type: "text", text: source.slice(from) });
  if (parts.some((part) => part.type === "text" && (part.text.includes("$$") || part.text.includes("\\(")))) {
    throw new Error("Cierra la notación matemática de «Donde:» con los signos correspondientes.");
  }
  return parts;
}

export function parseFormulaLatex(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Escribe la fórmula antes de generar el documento.");
  if (input.length > 2000) throw new Error("La fórmula supera el límite de 2,000 caracteres.");
  let offset = 0;
  let nodes = 0;
  const fail = (message) => { throw new Error(message); };
  const spaces = () => { while (/\s/u.test(input[offset] || "") && offset < input.length) offset += 1; };
  const sequence = (closing = null, depth = 0) => {
    if (depth > 24) fail("La fórmula tiene demasiados niveles de agrupación.");
    const result = [];
    while (offset < input.length) {
      spaces();
      if (offset >= input.length) break;
      if (input[offset] === "}") {
        if (!closing) fail("Hay una llave de cierre sin pareja en la fórmula.");
        offset += 1;
        return result;
      }
      if (++nodes > 1000) fail("La fórmula contiene demasiados elementos.");
      let atom = readAtom(depth);
      let sub = null;
      let sup = null;
      while (input[offset] === "_" || input[offset] === "^") {
        const kind = input[offset++];
        spaces();
        const argument = readArgument(depth + 1);
        if (kind === "_") {
          if (sub) fail("Un elemento tiene dos subíndices.");
          sub = argument;
        } else {
          if (sup) fail("Un elemento tiene dos superíndices.");
          sup = argument;
        }
      }
      if (sub || sup) atom = { type: "script", base: [atom], sub, sup };
      result.push(atom);
    }
    if (closing) fail("Falta cerrar una llave en la fórmula.");
    return result;
  };
  const readArgument = (depth) => {
    spaces();
    if (offset >= input.length) fail("Falta un argumento en la fórmula.");
    if (input[offset] === "{") {
      offset += 1;
      const argument = sequence("}", depth);
      if (!argument.length) fail("La fórmula tiene un argumento vacío.");
      return argument;
    }
    return [readAtom(depth)];
  };
  const readAtom = (depth) => {
    const char = input[offset++];
    if (char === "{") return { type: "group", children: sequence("}", depth + 1) };
    if (char === "^" || char === "_") fail("Hay un subíndice o superíndice sin elemento anterior.");
    if (char !== "\\") return { type: "text", value: char };
    const match = /^[a-zA-Z]+/u.exec(input.slice(offset));
    if (!match) {
      if (offset < input.length && /[{}_$%&#,;!]/u.test(input[offset])) return { type: "text", value: input[offset++] };
      fail("Hay una barra invertida incompleta en la fórmula.");
    }
    const command = match[0];
    offset += command.length;
    if (command === "placeholder") {
      spaces();
      while (input[offset] === "[") {
        const end = input.indexOf("]", offset + 1);
        if (end === -1) fail("Falta cerrar la etiqueta de un recuadro de la fórmula.");
        offset = end + 1;
        spaces();
      }
      if (input[offset] !== "{") fail(EMPTY_PLACEHOLDER);
      offset += 1;
      const children = sequence("}", depth + 1);
      const hasContent = items => items.some(node => node.type === "group" ? hasContent(node.children) : node.type !== "text" || node.value.trim());
      if (!hasContent(children)) fail(EMPTY_PLACEHOLDER);
      return { type: "group", children };
    }
    if (["color", "textcolor", "colorbox", "fcolorbox", "bbox"].includes(command)) {
      fail("Las fórmulas se presentan sin colores. Retira el color antes de generar el documento.");
    }
    if (["frac", "dfrac", "tfrac"].includes(command)) {
      return { type: "fraction", numerator: readArgument(depth + 1), denominator: readArgument(depth + 1) };
    }
    if (command === "sqrt") return { type: "radical", children: readArgument(depth + 1) };
    if (command === "left" || command === "right") { spaces(); return readAtom(depth); }
    if (command === "operatorname" || command === "mathrm" || command === "text") {
      const argument = readArgument(depth + 1);
      return { type: "group", children: argument };
    }
    if (command === "quad" || command === "qquad" || command === "thinspace") return { type: "text", value: " " };
    if (FUNCTIONS.has(command)) return { type: "text", value: command };
    if (Object.hasOwn(SYMBOLS, command)) return { type: "text", value: SYMBOLS[command] };
    fail(`El comando \\${command} todavía no es compatible con el documento.`);
  };
  const parsed = sequence();
  if (!parsed.length) fail("Escribe la fórmula antes de generar el documento.");
  return parsed;
}
