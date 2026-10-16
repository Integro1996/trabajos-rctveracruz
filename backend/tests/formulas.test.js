import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFormulaLatex } from '../src/formulas.js';

test('exporta el contenido de recuadros completados, incluidos los anidados', () => {
  const parsed = parseFormulaLatex(String.raw`\frac{\placeholder[numerador][correct][locked]{x_1}}{\placeholder{\sqrt{y}}}`);
  assert.equal(parsed[0].type, 'fraction');
  assert.equal(parsed[0].numerator[0].children[0].type, 'script');
  assert.equal(parsed[0].denominator[0].children[0].type, 'radical');
  assert.deepEqual(parseFormulaLatex(String.raw`\placeholder{\placeholder{x}}`), [
    { type: 'group', children: [{ type: 'group', children: [{ type: 'text', value: 'x' }] }] },
  ]);
});

test('los recuadros vacíos piden completar la fórmula sin acusar incompatibilidad', () => {
  for (const value of [String.raw`\placeholder{}`, String.raw`\frac{x}{\placeholder{}}`, String.raw`\placeholder[id][locked]{ }`, String.raw`\placeholder{{}}`, String.raw`\sqrt{\placeholder{\placeholder{}}}`]) {
    assert.throws(() => parseFormulaLatex(value), /Completa los recuadros vacíos/u);
  }
});

test('un recuadro mal formado no elimina contenido ni omite la validación', () => {
  assert.throws(() => parseFormulaLatex(String.raw`\placeholder[x{y}`), /Falta cerrar la etiqueta/u);
  assert.throws(() => parseFormulaLatex(String.raw`\placeholder{x`), /Falta cerrar una llave/u);
  assert.throws(() => parseFormulaLatex(String.raw`\placeholder{\unknown{x}}`), /todavía no es compatible/u);
});

test('los colores se rechazan con una indicación específica', () => {
  for (const command of ['color', 'textcolor', 'colorbox', 'fcolorbox', 'bbox']) {
    assert.throws(() => parseFormulaLatex(`\\${command}{red}{x}`), /sin colores/u);
  }
});
