import assert from "node:assert/strict";
import test from "node:test";
import { joinAdjacentText, mergeAdjacentText, referenceText } from "../src/flow.js";

test("une textos consecutivos dentro de la misma sección y la introducción", () => {
  const blocks = [
    { id: "intro", type: "text", heading: "Introducción", text: "Después." },
    { id: "materials", type: "text", heading: "Materiales y métodos", text: "Una frase." },
    { id: "continuation", type: "text", heading: "Materiales y métodos", text: "Otra frase." },
  ];
  const result = mergeAdjacentText("Antes.", blocks);
  assert.equal(result.introduction, "Antes. Después.");
  assert.deepEqual(result.blocks, [{ ...blocks[1], text: "Una frase. Otra frase." }]);
  assert.equal(result.changed, true);
});

test("respeta espacios existentes y no une texto separado por una figura", () => {
  assert.equal(joinAdjacentText("Antes. ", "Después."), "Antes. Después.");
  assert.equal(joinAdjacentText("Antes.", " Después."), "Antes. Después.");
  const blocks = [
    { id: "a", type: "text", heading: "Introducción", text: "Primero." },
    { id: "figure", type: "figure", heading: "Introducción", caption: "Imagen" },
    { id: "b", type: "text", heading: "Introducción", text: "Segundo." },
  ];
  const result = mergeAdjacentText("", blocks);
  assert.equal(result.introduction, "Primero.");
  assert.deepEqual(result.blocks, blocks.slice(1));
});

test("conserva cada referencia añadida como bloque de texto independiente", () => {
  const blocks = [
    { id: "first", type: "text", heading: "Referencias bibliográficas", text: "Primera referencia." },
    { id: "second", type: "text", heading: "Referencias bibliográficas", text: "Segunda referencia." },
  ];
  const result = mergeAdjacentText("", blocks);
  assert.deepEqual(result.blocks, blocks);
  assert.equal(result.changed, false);
});

test("muestra referencias antiguas de dos campos en un solo texto", () => {
  assert.equal(referenceText({ referenceTitle: "Título anterior", text: "Autor (2020). Editorial." }), "Título anterior. Autor (2020). Editorial.");
  assert.equal(referenceText({ referenceTitle: "Título anterior.", text: "Autor (2020)." }), "Título anterior. Autor (2020).");
  assert.equal(referenceText({ text: "Referencia completa." }), "Referencia completa.");
});
