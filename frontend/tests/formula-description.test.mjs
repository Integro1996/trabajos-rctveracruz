import test from "node:test";
import assert from "node:assert/strict";
import { inlineMathSegments, symbolsFromFormula } from "../src/formula-description.js";

test("detecta los símbolos de la fórmula sin ofrecer operadores ni funciones", () => {
  assert.deepEqual(symbolsFromFormula(String.raw`\mu=\frac{\ln N_{t_1}-\ln N_{t_0}}{\Delta t}`), [
    String.raw`\mu`, String.raw`N_{t_1}`, String.raw`N_{t_0}`, String.raw`\Delta t`,
  ]);
});

test("reconoce símbolos escritos o pegados dentro de Donde", () => {
  const parts = inlineMathSegments(String.raw`$\mu$ es la tasa y $$ \Delta_{t} $$ es el intervalo.`);
  assert.deepEqual(parts.filter((part) => part.type === "math").map((part) => part.latex), [String.raw`\mu`, String.raw`\Delta_{t}`]);
});
