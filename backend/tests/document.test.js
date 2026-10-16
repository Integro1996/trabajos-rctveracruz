import assert from "node:assert/strict";
import test from "node:test";
import mammoth from "mammoth";
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { applyPageTemplate } from '../src/page-template.js';
import { readFile } from 'node:fs/promises';
import { composePresentation, presentationKey } from '../src/presentation.js';
import { countBodyNarrativeWords, createBodyDocx } from "../src/document.js";
import { parseFormulaLatex } from "../src/formulas.js";

test('las fórmulas se guardan como ecuaciones nativas con fracciones y subíndices', async () => {
  const latex = String.raw`\mu=\frac{\ln N_{t_1}-\ln N_{t_0}}{\Delta t}`;
  assert(parseFormulaLatex(latex).length > 0);
  const buffer = await createBodyDocx({
    introduction: 'Antes de la fórmula',
    blocks: [
      { type: 'formula', heading: 'Introducción', latex, description: 'μ es la tasa de crecimiento específico.' },
      { type: 'text', heading: 'Introducción', text: 'Después de la fórmula' },
      { type: 'formula', heading: 'Resultados y discusión', latex: String.raw`T_d=\frac{\log 2}{\mu}`, description: 'Td es el tiempo de duplicación.' },
    ],
  });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  assert.equal((xml.match(/<m:oMath>/gu) || []).length, 2);
  assert.match(xml, /<m:f>/u);
  assert.match(xml, /<m:sSub>/u);
  assert(xml.indexOf('Antes de la fórmula') < xml.indexOf('<m:oMath>'));
  assert(xml.indexOf('<m:oMath>') < xml.indexOf('Después de la fórmula'));
  assert(!xml.includes('<w:drawing>'));
  assert(xml.includes('Donde: '));
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const descriptions = Array.from(document.getElementsByTagNameNS(W, 'p')).filter(node => node.textContent.startsWith('Donde:'));
  assert.equal(descriptions.length, 2);
  for (const paragraph of descriptions) {
    assert(Array.from(paragraph.getElementsByTagNameNS(W, 'sz')).every(size => size.getAttributeNS(W, 'val') === '18'));
  }
  assert.throws(() => parseFormulaLatex(String.raw`\begin{matrix}1\end{matrix}`), /todavía no es compatible/u);
});

test('Donde mezcla explicación y símbolos matemáticos pegados sin mostrar los signos de LaTeX', async () => {
  const buffer = await createBodyDocx({
    blocks: [{ type: 'formula', heading: 'Introducción', latex: String.raw`\mu=\frac{N_{t_1}}{\Delta t}`,
      description: String.raw`Donde: $\mu$ = tasa de crecimiento; $$ \Delta_{t} $$ = intervalo de tiempo; \(N_{t_1}\) = población.` }],
  });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const explanation = Array.from(document.getElementsByTagNameNS(W, 'p')).find(node => node.textContent.startsWith('Donde:'));
  assert(explanation);
  assert.equal(explanation.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val'), 'FormulaDescription');
  assert.equal(explanation.getElementsByTagNameNS(M, 'oMath').length, 3);
  assert(explanation.getElementsByTagNameNS(M, 'sSub').length >= 2);
  assert(!explanation.textContent.includes('\\Delta') && !explanation.textContent.includes('$$'));
  assert(explanation.textContent.includes('tasa de crecimiento'));
});

test('dos fórmulas comparten una fila y sus explicaciones comienzan a la misma altura', async () => {
  const buffer = await createBodyDocx({
    introduction: 'Se usaron las siguientes ecuaciones.',
    blocks: [
      { type: 'formula', heading: 'Introducción', latex: String.raw`\mu=\frac{\ln N_{t_1}-\ln N_{t_0}}{\Delta t}`, description: 'Donde: μ = tasa de crecimiento específico; Δt = intervalo de tiempo.', pairWithNext: true },
      { type: 'formula', heading: 'Introducción', latex: String.raw`T_d=\frac{\log 2}{\mu}`, description: 'Td = tiempo de duplicación; log2 = logaritmo natural de 2.' },
    ],
  });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(W, 'body')[0];
  const layout = Array.from(body.childNodes).find(node => node.namespaceURI === W && node.localName === 'tbl');
  assert(layout);
  const rows = Array.from(layout.getElementsByTagNameNS(W, 'tr'));
  assert.equal(rows.length, 2);
  const equationCells = Array.from(rows[0].getElementsByTagNameNS(W, 'tc'));
  const explanationCells = Array.from(rows[1].getElementsByTagNameNS(W, 'tc'));
  assert.equal(equationCells.length, 2);
  assert.equal(explanationCells.length, 2);
  assert(equationCells.every(cell => cell.getElementsByTagNameNS(M, 'oMath').length === 1));
  assert(explanationCells.every(cell => cell.textContent.startsWith('Donde: ')));
  assert(explanationCells.every(cell => cell.getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val') === 'left'));
  assert.equal((explanationCells[0].textContent.match(/Donde:/gu) || []).length, 1);
  assert(explanationCells[0].textContent.includes('crecimiento específico'));
  assert(explanationCells[1].textContent.includes('tiempo de duplicación'));
});

const content = {
  title: "METADATA TITULO NO DEBE APARECER",
  authors: [{ firstName: "METADATA", lastName: "AUTOR" }],
  keywords: ["METADATA_KEYWORD"],
  introduction: "Uno dos",
  blocks: [
    { type: "text", text: "Tres cuatro" },
    { type: "figure", assetId: "missing", caption: "PIE FIGURA EXCLUIDO" },
    { type: "table", caption: "PIE TABLA EXCLUIDO", cells: [["CELDA EXCLUIDA"]] },
  ],
};

test('presentación con título, autores, afiliaciones y correspondencia conserva el cuerpo separado', async () => {
  const article={...content,mesa:'AG',documentKey:'body-key',version:1,keywords:['algas verdes','Tetraselmis chuii'],authors:[
    {firstName:'Ana',lastName:'Pérez',institution:'Instituto A',email:'ana@example.test',isCorresponding:true},
    {firstName:'Luis',lastName:'Ruiz',institution:'Instituto A',email:'luis@example.test',isCorresponding:true},
    {firstName:'Elena',lastName:'Díaz',institution:'Instituto B',email:'elena@example.test',isCorresponding:false},
  ]};
  const body=await createBodyDocx(content), before=Buffer.from(body);
  const final=await composePresentation(body,article);
  const text=(await mammoth.extractRawText({buffer:final})).value;
  assert(text.includes('Mesa: Agrícola (AG)'));
  assert(text.indexOf('Mesa: Agrícola (AG)')>text.indexOf('Introducción'));
  assert(text.indexOf(article.title)<text.indexOf('Ana Pérez'));
  assert(text.indexOf('Ana Pérez')<text.indexOf('Introducción'));
  assert(text.includes('1 Instituto A')&&text.includes('2 Instituto B'));
  assert(text.includes('*Autor para correspondencia: ana@example.test'));
  assert(!text.includes('luis@example.test') && !text.includes('elena@example.test'));
  assert.equal(text.match(/Instituto A/g).length,1);
  assert(text.includes('Palabras clave: algas verdes, Tetraselmis chuii.'));
  const packageZip=await JSZip.loadAsync(final);
  const xml=await packageZip.file('word/document.xml').async('string');
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document=new DOMParser().parseFromString(xml,'application/xml');
  const bodyElement=document.getElementsByTagNameNS(W,'body')[0];
  const mesaParagraph=Array.from(bodyElement.childNodes).find(node=>node.localName==='p'&&node.textContent.includes('Mesa: Agrícola (AG)'));
  assert(mesaParagraph);
  const frame=mesaParagraph.getElementsByTagNameNS(W,'framePr')[0];
  assert.equal(frame.getAttributeNS(W,'vAnchor'),'page');
  assert.equal(frame.getAttributeNS(W,'xAlign'),'center');
  assert.equal(mesaParagraph.getElementsByTagNameNS(W,'jc')[0].getAttributeNS(W,'val'),'center');
  assert.equal(bodyElement.getElementsByTagNameNS(W,'sectPr').length,1);
  assert.match(xml,/w:vertAlign w:val="superscript"/);
  assert.match(xml,/w:sz w:val="28"/);
  const keywordParagraph=Array.from(document.getElementsByTagNameNS(W,'p')).find(paragraph=>paragraph.textContent.includes('Palabras clave:'));
  const keywordRuns=Array.from(keywordParagraph.getElementsByTagNameNS(W,'r'));
  assert.equal(keywordRuns[0].getElementsByTagNameNS(W,'i').length,0);
  for(const keywordRun of keywordRuns.slice(1)) assert(keywordRun.getElementsByTagNameNS(W,'i').length>0);
  assert.deepEqual(body,before);
  assert(!(await mammoth.extractRawText({buffer:body})).value.includes('Ana Pérez'));
  assert.notEqual(presentationKey(article),presentationKey({...article,title:'Otro título'}));
  assert.notEqual(presentationKey(article),presentationKey({...article,mesa:'PE'}));
});

test('el título conserva los nombres científicos en cursiva y con su capitalización original', async () => {
  const article = {
    ...content,
    title: 'Crecimiento de las microalgas Tetraselmis chuii e Isochrysis galbana con fertilizantes foliares como medio nutritivo',
    authors: [],
    keywords: ['Tetraselmis chuii'],
    introduction: 'Se evaluó T. chuii en el cultivo.',
  };
  const final = await composePresentation(await createBodyDocx(article), article);
  const text = (await mammoth.extractRawText({ buffer: final })).value;
  assert(text.startsWith('CRECIMIENTO DE LAS MICROALGAS Tetraselmis chuii E Isochrysis galbana CON FERTILIZANTES FOLIARES COMO MEDIO NUTRITIVO'));
  assert(text.includes('Palabras clave: Tetraselmis chuii.'));
  assert(text.includes('Se evaluó T. chuii en el cultivo.'));
  const xml = await (await JSZip.loadAsync(final)).file('word/document.xml').async('string');
  const runs = xml.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g);
  for (const name of ['Tetraselmis chuii', 'Isochrysis galbana', 'T. chuii']) {
    const scientificRuns = runs.filter(run => run.includes(`>${name}</w:t>`));
    assert(scientificRuns.length > 0, `Falta el nombre científico: ${name}`);
    for (const run of scientificRuns) assert.match(run, /<w:i\s*\/>/);
  }
});

test('la escala reduce proporcionalmente la foto dentro del DOCX', async () => {
  const template = await JSZip.loadAsync(await readFile(new URL('../templates/plantilla.docx', import.meta.url)));
  const asset = {mimeType:'image/jpeg',width:365,height:251,buffer:await template.file('word/media/image1.jpeg').async('nodebuffer')};
  const dimensions = async scale => {
    const file = await createBodyDocx({blocks:[{type:'figure',assetId:'photo',caption:'Foto',scale}],assets:new Map([['photo',asset]])});
    const xml = await (await JSZip.loadAsync(file)).file('word/document.xml').async('string');
    const match = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    assert(match);
    return match.slice(1).map(Number);
  };
  const full = await dimensions(100), reduced = await dimensions(50);
  assert.equal(reduced[0], Math.round(365 / 2) * 9525);
  assert.equal(reduced[1], Math.round(251 / 2) * 9525);
  assert(reduced[0] < full[0] && reduced[1] < full[1]);
});

test('la referencia de la tabla va arriba y la de la figura debajo de la imagen', async () => {
  const template = await JSZip.loadAsync(await readFile(new URL('../templates/plantilla.docx', import.meta.url)));
  const asset = { mimeType: 'image/jpeg', width: 365, height: 251, buffer: await template.file('word/media/image1.jpeg').async('nodebuffer') };
  const buffer = await createBodyDocx({
    blocks: [
      { type: 'figure', assetId: 'photo', caption: 'Microalga' },
      { type: 'table', caption: 'Resultados', cells: [['Variable'], ['Valor']] },
    ],
    assets: new Map([['photo', asset]]),
  });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(W, 'body')[0];
  const nodes = Array.from(body.childNodes).filter(node => node.namespaceURI === W && ['p', 'tbl'].includes(node.localName));
  const imageIndex = nodes.findIndex(node => node.getElementsByTagNameNS(W, 'drawing').length > 0);
  const figureCaptionIndex = nodes.findIndex(node => node.localName === 'p' && node.textContent.includes('Figura 1.'));
  const tableCaptionIndex = nodes.findIndex(node => node.localName === 'p' && node.textContent.includes('Cuadro 1.'));
  const tableIndex = nodes.findIndex(node => node.localName === 'tbl');
  assert(imageIndex >= 0 && tableIndex >= 0);
  assert.equal(figureCaptionIndex, imageIndex + 1);
  assert.equal(nodes[figureCaptionIndex].getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val'), 'left');
  assert.equal(nodes[imageIndex].getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val'), 'center');
  assert.equal(nodes[tableCaptionIndex].getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val'), 'left');
  assert.equal(tableIndex, tableCaptionIndex + 1);
  assert(nodes[imageIndex].getElementsByTagNameNS(W, 'keepNext').length > 0);
  assert(nodes[tableCaptionIndex].getElementsByTagNameNS(W, 'keepNext').length > 0);
});

test('regenerar alinea las descripciones de figuras, cuadros y fórmulas sin cambiar el contenido', async () => {
  const original = await createBodyDocx({ blocks: [
    { type: 'figure', assetId: 'missing', caption: 'Descripción conservada' },
    { type: 'table', caption: 'Cuadro individual', cells: [['Variable'], ['Valor']] },
    { type: 'table', caption: 'Cuadro izquierdo', cells: [['A']], pairWithNext: true },
    { type: 'table', caption: 'Cuadro derecho', cells: [['B']] },
    { type: 'formula', latex: 'x=1', description: 'x es el valor individual.' },
    { type: 'formula', latex: 'y=2', description: 'y es el valor izquierdo.', pairWithNext: true },
    { type: 'formula', latex: 'z=3', description: 'z es el valor derecho.' },
    { type: 'text', heading: 'Conclusiones', text: 'Figura 2. Esta es una referencia narrativa.' },
    { type: 'text', heading: 'Conclusiones', text: 'Cuadro 4. Esta es otra referencia narrativa.' },
    { type: 'text', heading: 'Conclusiones', text: 'Donde: esta oración pertenece al texto general.' },
  ] });
  const zip = await JSZip.loadAsync(original);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const paragraphs = Array.from(document.getElementsByTagNameNS(W, 'p'));
  const descriptions = paragraphs.filter(node => /^(Figura 1\.|Cuadro [123]\.|Donde: [xyz] )/u.test(node.textContent));
  assert.equal(descriptions.length, 7);
  for (const paragraph of descriptions) {
    const alignment = paragraph.getElementsByTagNameNS(W, 'jc')[0];
    assert.equal(alignment.getAttributeNS(W, 'val'), 'left');
    if (paragraph.textContent.startsWith('Donde:')) {
      for (const name of ['sz', 'szCs']) {
        for (const size of Array.from(paragraph.getElementsByTagNameNS(W, name))) size.setAttributeNS(W, 'w:val', '20');
      }
    } else {
      alignment.setAttributeNS(W, 'w:val', 'center');
    }
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  const updated = await applyPageTemplate(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(updated.changed, true);
  const result = new DOMParser().parseFromString(await (await JSZip.loadAsync(updated.buffer)).file('word/document.xml').async('string'), 'application/xml');
  const output = Array.from(result.getElementsByTagNameNS(W, 'p'));
  for (const paragraph of descriptions) {
    assert.equal(output.find(node => node.textContent === paragraph.textContent).getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val'), 'left');
  }
  for (const prefix of ['Figura 2.', 'Cuadro 4.', 'Donde: esta']) {
    assert.equal(output.find(node => node.textContent.startsWith(prefix)).getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val'), 'both');
  }
  assert.equal(result.documentElement.textContent, document.documentElement.textContent);
  for (const paragraph of output.filter(node => /^Donde: [xyz] /u.test(node.textContent))) {
    for (const name of ['sz', 'szCs']) {
      assert(Array.from(paragraph.getElementsByTagNameNS(W, name)).every(size => size.getAttributeNS(W, 'val') === '18'));
    }
  }
  const repeated = await applyPageTemplate(updated.buffer);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.buffer, updated.buffer);
});

test('dos figuras comparten una fila con pies independientes y la tercera queda sola', async () => {
  const template = await JSZip.loadAsync(await readFile(new URL('../templates/plantilla.docx', import.meta.url)));
  const asset = { mimeType: 'image/jpeg', width: 365, height: 251, buffer: await template.file('word/media/image1.jpeg').async('nodebuffer') };
  const buffer = await createBodyDocx({
    blocks: [
      { type: 'figure', assetId: 'one', caption: 'Primera gráfica', pairWithNext: true },
      { type: 'figure', assetId: 'two', caption: 'Segunda gráfica', scale: 50 },
      { type: 'figure', assetId: 'three', caption: 'Tercera gráfica' },
    ],
    assets: new Map([['one', asset], ['two', asset], ['three', asset]]),
  });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(W, 'body')[0];
  const topLevel = Array.from(body.childNodes).filter(node => node.namespaceURI === W);
  const layoutTables = topLevel.filter(node => node.localName === 'tbl');
  assert.equal(layoutTables.length, 1);
  const cells = Array.from(layoutTables[0].getElementsByTagNameNS(W, 'tc'));
  assert.equal(cells.length, 2);
  for (const [index, cell] of cells.entries()) {
    const paragraphs = Array.from(cell.getElementsByTagNameNS(W, 'p'));
    assert.equal(paragraphs.length, 2);
    assert.equal(paragraphs[0].getElementsByTagNameNS(W, 'drawing').length, 1);
    assert(paragraphs[1].textContent.includes(`Figura ${index + 1}.`));
    assert.equal(paragraphs[1].getElementsByTagNameNS(W, 'jc')[0].getAttributeNS(W, 'val'), 'left');
    assert(paragraphs[1].textContent.includes(index === 0 ? 'Primera gráfica' : 'Segunda gráfica'));
  }
  const captionOffsets = cells.map(cell => {
    const imageParagraph = cell.getElementsByTagNameNS(W, 'p')[0];
    const extent = imageParagraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
    const imageHeightTwips = Number(extent.getAttribute('cy')) / 635;
    const spacing = imageParagraph.getElementsByTagNameNS(W, 'spacing')[0];
    return imageHeightTwips + Number(spacing.getAttributeNS(W, 'after') || 0);
  });
  assert.equal(captionOffsets[0], captionOffsets[1]);
  assert.equal(layoutTables[0].getElementsByTagNameNS(W, 'cantSplit').length, 1);
  const widths = Array.from(layoutTables[0].getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent'));
  assert(widths.every(node => Number(node.getAttribute('cx')) <= 320 * 9525));
  const tableWidth = layoutTables[0].getElementsByTagNameNS(W, 'tblW')[0];
  assert.equal(tableWidth.getAttributeNS(W, 'w'), '9972');
  assert(topLevel.some(node => node.localName === 'p' && node.textContent.includes('Figura 3.')));
});

test('dos tablas pequeñas comparten fila con títulos arriba y tablas alineadas', async () => {
  const buffer = await createBodyDocx({
    blocks: [
      { type: 'table', caption: 'Resultados del primer ensayo', pairWithNext: true, cells: [['A', 'B', 'C', 'D'], ['1', '2', '3', '4']] },
      { type: 'table', caption: 'Resultados del segundo ensayo con una descripción más extensa', cells: [['E', 'F'], ['5', '6']] },
      { type: 'table', caption: 'Datos adicionales', cells: [['G'], ['7']] },
    ],
  });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(W, 'body')[0];
  const topLevel = Array.from(body.childNodes).filter(node => node.namespaceURI === W && ['p', 'tbl'].includes(node.localName));
  const tables = topLevel.filter(node => node.localName === 'tbl');
  assert.equal(tables.length, 2);
  const pairedRows = Array.from(tables[0].childNodes).filter(node => node.namespaceURI === W && node.localName === 'tr');
  assert.equal(pairedRows.length, 2);
  const titleCells = Array.from(pairedRows[0].childNodes).filter(node => node.namespaceURI === W && node.localName === 'tc');
  const dataCells = Array.from(pairedRows[1].childNodes).filter(node => node.namespaceURI === W && node.localName === 'tc');
  assert.equal(titleCells.length, 2);
  assert.equal(dataCells.length, 2);
  assert(titleCells[0].textContent.includes('Cuadro 1.'));
  assert(titleCells[1].textContent.includes('Cuadro 2.'));
  assert.equal(dataCells[0].getElementsByTagNameNS(W, 'tbl').length, 1);
  assert.equal(dataCells[1].getElementsByTagNameNS(W, 'tbl').length, 1);
  assert(dataCells[0].textContent.includes('D'));
  assert(dataCells[1].textContent.includes('F'));
  const thirdCaptionIndex = topLevel.findIndex(node => node.localName === 'p' && node.textContent.includes('Cuadro 3.'));
  assert.equal(topLevel[thirdCaptionIndex + 1], tables[1]);
});

test('la nota de cada cuadro aparece debajo de su tabla con letra de 8 puntos', async () => {
  const buffer = await createBodyDocx({ blocks: [
    { type: 'table', heading: 'Resultados y discusión', caption: 'Datos de cultivo', cells: [['Tratamiento', 'Valor'], ['A', '5 a']], footnote: 'a = diferencia significativa en Cucumis sativus.' },
    { type: 'table', heading: 'Resultados y discusión', caption: 'Primer ensayo', cells: [['A'], ['1 b']], footnote: 'b = tratamiento inicial.', pairWithNext: true },
    { type: 'table', heading: 'Resultados y discusión', caption: 'Segundo ensayo', cells: [['B'], ['2 c']], footnote: 'c = tratamiento final.' },
  ] });
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagNameNS(W, 'body')[0];
  const notes = Array.from(body.getElementsByTagNameNS(W, 'p')).filter(paragraph => paragraph.textContent.startsWith('Nota: '));
  assert.deepEqual(notes.map(paragraph => paragraph.textContent), [
    'Nota: a = diferencia significativa en Cucumis sativus.',
    'Nota: b = tratamiento inicial.',
    'Nota: c = tratamiento final.',
  ]);
  for (const paragraph of notes) {
    assert(Array.from(paragraph.getElementsByTagNameNS(W, 'sz')).every(size => size.getAttributeNS(W, 'val') === '16'));
  }
  const topLevel = Array.from(body.childNodes).filter(node => node.namespaceURI === W && ['p', 'tbl'].includes(node.localName));
  const firstTableIndex = topLevel.findIndex(node => node.localName === 'tbl');
  assert(topLevel[firstTableIndex + 1].textContent.startsWith('Nota: a ='));
  const paired = topLevel.filter(node => node.localName === 'tbl')[1];
  const outerRows = Array.from(paired.childNodes).filter(node => node.localName === 'tr');
  const cells = Array.from(outerRows[1].childNodes).filter(node => node.localName === 'tc');
  assert(cells[0].textContent.includes('Nota: b = tratamiento inicial.'));
  assert(cells[1].textContent.includes('Nota: c = tratamiento final.'));
  const italic = Array.from(notes[0].getElementsByTagNameNS(W, 'r')).filter(run => run.getElementsByTagNameNS(W, 'i').length);
  assert.deepEqual(italic.map(run => run.textContent), ['Cucumis sativus']);
});

test("el conteo estructurado incluye las secciones fijas y párrafos, no pies ni celdas", () => {
  assert.equal(countBodyNarrativeWords(content), 14);
});

test("omite los Enter finales sin borrar los párrafos internos", async () => {
  const buffer = await createBodyDocx({
    introduction: "Primer párrafo\n\nÚltimo párrafo\n\n",
    blocks: [{ type: "text", heading: "Objetivos", text: "Objetivo final\n\n" }],
  });
  const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml").async("string");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(W, "body")[0];
  const paragraphs = Array.from(body.childNodes).filter(node => node.namespaceURI === W && node.localName === "p");
  const lines = paragraphs.map(node => node.textContent);
  assert.deepEqual(lines.slice(0, 6), ["Introducción", "Primer párrafo", "", "Último párrafo", "Objetivos", "Objetivo final"]);
  assert.equal(lines[6], "Materiales y métodos");
});

test("el DOCX ordena los títulos fijos y solo incluye agradecimientos al activarlos", async () => {
  const blocks = [
    { type: "text", heading: "Referencias bibliográficas", text: "Fuente consultada" },
    { type: "text", heading: "Resultados y discusión", text: "Hallazgos del ensayo" },
    { type: "text", heading: "Conclusiones", text: "Cierre del trabajo" },
    { type: "text", heading: "Materiales y métodos", text: "Procedimiento seguido" },
  ];
  const without = (await mammoth.extractRawText({ buffer: await createBodyDocx({ introduction: "Contexto inicial", blocks }) })).value;
  const ordered = ["Introducción", "Objetivos", "Materiales y métodos", "Resultados y discusión", "Conclusiones", "Referencias bibliográficas"];
  assert(ordered.every((heading, index) => index === 0 || without.indexOf(ordered[index - 1]) < without.indexOf(heading)));
  assert(without.includes("Objetivos"));
  assert(!without.includes("Agradecimientos"));
  const withObjectives = (await mammoth.extractRawText({ buffer: await createBodyDocx({
    introduction: "Contexto inicial",
    blocks: [...blocks, { type: "text", heading: "Objetivos", text: "Evaluar el ensayo" }],
  }) })).value;
  assert(withObjectives.indexOf("Introducción") < withObjectives.indexOf("Objetivos"));
  assert(withObjectives.indexOf("Objetivos") < withObjectives.indexOf("Materiales y métodos"));
  assert(withObjectives.includes("Evaluar el ensayo"));
  const withAck = (await mammoth.extractRawText({ buffer: await createBodyDocx({
    introduction: "Contexto inicial",
    blocks: [...blocks, { type: "text", heading: "Agradecimientos", text: "Apoyo recibido" }],
  }) })).value;
  assert(withAck.indexOf("Conclusiones") < withAck.indexOf("Agradecimientos"));
  assert(withAck.indexOf("Agradecimientos") < withAck.indexOf("Referencias bibliográficas"));
});

test("las referencias son párrafos con sangría francesa y URL sin enlace activo", async () => {
  const references = [
    "Astudillo, L. (2020). Fertilización foliar en pepino.",
    "Montse, E. (2018). Bioecoactual. https://www.bioecoactual.com/2017/07/10/18154/",
    "Rodríguez, L. (2016). Cultivos Tropicales. http://dx.doi.org/10.13140/RG.2.1.1404.6967",
  ];
  const buffer = await createBodyDocx({ blocks: [{
    type: "text",
    heading: "Referencias bibliográficas",
    text: `${references[0]}\n\n${references[1]}\n${references[2]}`,
  }] });
  const archive = await JSZip.loadAsync(buffer);
  const xml = await archive.file("word/document.xml").async("string");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(W, "p"));
  const entries = paragraphs.filter(paragraph => references.some(reference => paragraph.textContent === reference));
  assert.deepEqual(entries.map(paragraph => paragraph.textContent), references);
  for (const paragraph of entries) {
    const indent = paragraph.getElementsByTagNameNS(W, "ind")[0];
    assert.equal(indent.getAttributeNS(W, "left"), "720");
    assert.equal(indent.getAttributeNS(W, "hanging"), "720");
    assert.equal(paragraph.getElementsByTagNameNS(W, "keepLines").length, 1);
    assert.equal(paragraph.getElementsByTagNameNS(W, "hyperlink").length, 0);
  }
  assert.equal(paragraphs.filter(paragraph => !paragraph.textContent && paragraph.getElementsByTagNameNS(W, "ind").length).length, 0);
  const relationships = await archive.file("word/_rels/document.xml.rels").async("string");
  assert(!relationships.includes("bioecoactual.com") && !relationships.includes("dx.doi.org"));
});

test("una referencia combina nombre y descripción, con cursiva solo en el nombre científico", async () => {
  const buffer = await createBodyDocx({ blocks: [{
    type: "text", heading: "Referencias bibliográficas",
    referenceTitle: "Estudio de pepino Cucumis sativus",
    text: "Astudillo, L. (2020). Editorial Agraria.",
  }] });
  const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml").async("string");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(W, "p"));
  const reference = paragraphs.find(paragraph => paragraph.textContent.includes("Estudio de pepino Cucumis sativus"));
  assert.equal(reference.textContent, "Estudio de pepino Cucumis sativus. Astudillo, L. (2020). Editorial Agraria.");
  const runs = Array.from(reference.getElementsByTagNameNS(W, "r"));
  assert.deepEqual(runs.filter(run => run.getElementsByTagNameNS(W, "i").length).map(run => run.textContent), ["Cucumis sativus"]);
});

test("cada referencia de un campo tiene sangría francesa y la vacía no aparece", async () => {
  const buffer = await createBodyDocx({ blocks: [
    { type: "text", heading: "Referencias bibliográficas", referenceTitle: "", text: "Autor, A. (2020).\nTítulo de la obra." },
    { type: "text", heading: "Referencias bibliográficas", referenceTitle: "", text: "  " },
  ] });
  const xml = await (await JSZip.loadAsync(buffer)).file("word/document.xml").async("string");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagNameNS(W, "p"));
  const entries = paragraphs.filter(paragraph => paragraph.textContent.includes("Autor, A."));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].textContent, "Autor, A. (2020). Título de la obra.");
  assert.equal(entries[0].getElementsByTagNameNS(W, "ind")[0].getAttributeNS(W, "hanging"), "720");
  assert.equal(paragraphs.filter(paragraph => paragraph.getElementsByTagNameNS(W, "ind").length).length, 1);
});

test("el DOCX conserva el texto antes y después de una tabla insertada dentro de la sección", async () => {
  const buffer = await createBodyDocx({
    introduction: "Párrafo anterior",
    blocks: [
      { type: "table", heading: "Introducción", caption: "Datos intermedios", cells: [["Columna"], ["Valor"]] },
      { type: "text", heading: "Introducción", text: "Párrafo posterior" },
    ],
  });
  const text = (await mammoth.extractRawText({ buffer })).value;
  assert(text.indexOf("Párrafo anterior") < text.indexOf("Cuadro 1. Datos intermedios"));
  assert(text.indexOf("Cuadro 1. Datos intermedios") < text.indexOf("Párrafo posterior"));
});

test('aplica el fondo institucional a un cuerpo existente sin perder su texto', async () => {
  const original = await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Edición previa que debe conservarse.')]}]}));
  const result = await applyPageTemplate(original);
  assert.equal(result.changed, true);
  assert.equal((await mammoth.extractRawText({buffer:result.buffer})).value, (await mammoth.extractRawText({buffer:original})).value);
  const archive = await JSZip.loadAsync(result.buffer);
  assert(archive.file('word/rct-header.xml'));
  assert(archive.file('word/rct-footer.xml'));
  for (let number=1;number<=4;number++) assert(archive.file(`word/media/rct-image${number}.jpeg`));
  const document = await archive.file('word/document.xml').async('string');
  assert.match(document, /w:w="12240" w:h="15840"/);
  assert.match(document, /w:top="1985"/);
  assert.match(document, /w:left="1134"/);
  assert.match(document, /w:right="1134"/);
  const second = await applyPageTemplate(result.buffer);
  assert.equal(second.changed, false);
  assert.deepEqual(second.buffer, result.buffer);

  const old = await JSZip.loadAsync(result.buffer);
  old.file('word/document.xml', document.replace('w:left="1134"', 'w:left="1304"').replace('w:right="1134"', 'w:right="1304"'));
  const adjusted = await applyPageTemplate(await old.generateAsync({ type: 'nodebuffer' }));
  assert.equal(adjusted.changed, true);
  const adjustedXml = await (await JSZip.loadAsync(adjusted.buffer)).file('word/document.xml').async('string');
  assert.match(adjustedXml, /w:left="1134"/);
  assert.match(adjustedXml, /w:right="1134"/);
});

test("el DOCX editable contiene únicamente el cuerpo, no la metadata", async () => {
  const buffer = await createBodyDocx(content);
  const text = (await mammoth.extractRawText({ buffer })).value;
  for (const bodyValue of ["Introducción", "Uno dos", "Tres cuatro", "Figura 1.", "Cuadro 1."]) {
    assert(text.includes(bodyValue), `Falta contenido del cuerpo: ${bodyValue}`);
  }
  for (const metadataValue of [content.title, "METADATA AUTOR", "METADATA_KEYWORD", "Palabras clave:"]) {
    assert(!text.includes(metadataValue), `Apareció metadata dentro del cuerpo: ${metadataValue}`);
  }
});
