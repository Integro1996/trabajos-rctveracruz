const GREEK = new Set(["alpha", "beta", "gamma", "delta", "Delta", "epsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega", "Gamma", "Sigma", "Omega"]);

function scriptEnd(value, from) {
  let index = from;
  while (value[index] === "_" || value[index] === "^") {
    index += 1;
    if (value[index] === "{") {
      let depth = 1;
      index += 1;
      while (index < value.length && depth) {
        if (value[index] === "{") depth += 1;
        if (value[index] === "}") depth -= 1;
        index += 1;
      }
    } else if (value[index] === "\\") {
      index += 1 + (/^[a-zA-Z]+/u.exec(value.slice(index + 1))?.[0].length || 0);
    } else {
      index += 1;
    }
  }
  return index;
}

export function symbolsFromFormula(latex) {
  const source = String(latex || "");
  const symbols = [];
  const seen = new Set();
  for (let index = 0; index < source.length && symbols.length < 12;) {
    const start = index;
    let isVariable = false;
    let command = "";
    if (source[index] === "\\") {
      command = /^[a-zA-Z]+/u.exec(source.slice(index + 1))?.[0] || "";
      index += command.length + 1;
      isVariable = GREEK.has(command);
    } else if (/[a-zA-Z]/u.test(source[index])) {
      const letters = /^[a-zA-Z]+/u.exec(source.slice(index))[0];
      index += letters.length;
      isVariable = letters.length === 1;
    } else {
      index += 1;
    }
    if (!isVariable) continue;
    if (command === "Delta" && /^\s+t(?![a-zA-Z])/u.test(source.slice(index))) {
      index += /^\s+t/u.exec(source.slice(index))[0].length;
    }
    index = scriptEnd(source, index);
    const symbol = source.slice(start, index);
    if (!seen.has(symbol)) { seen.add(symbol); symbols.push(symbol); }
  }
  return symbols;
}

export function inlineMathSegments(value) {
  const source = String(value || "");
  const marker = /\$\$([^$]*?)\$\$|(?<!\$)\$(?!\$)([^$\r\n]+?)\$(?!\$)|\\\(([\s\S]*?)\\\)/gu;
  const parts = [];
  let from = 0;
  for (const match of source.matchAll(marker)) {
    if (match.index > from) parts.push({ type: "text", text: source.slice(from, match.index) });
    parts.push({ type: "math", latex: (match[1] ?? match[2] ?? match[3]).trim() });
    from = match.index + match[0].length;
  }
  if (from < source.length) parts.push({ type: "text", text: source.slice(from) });
  return parts;
}
