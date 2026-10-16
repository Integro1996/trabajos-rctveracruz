import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const template = await JSZip.loadAsync(await readFile(new URL('../templates/plantilla.docx', import.meta.url)));
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const serialize = (xml) => new XMLSerializer().serializeToString(xml);
const templateDocument = parse(await template.file('word/document.xml').async('string'));
const section = templateDocument.getElementsByTagNameNS(W, 'sectPr')[0];
export const PAGE_SIDE_MARGIN_TWIPS = 1134;
export const PAGE_BODY_WIDTH_TWIPS = Number(section.getElementsByTagNameNS(W, 'pgSz')[0].getAttributeNS(W, 'w')) - PAGE_SIDE_MARGIN_TWIPS * 2;

function setSideMargins(document) {
  let changed = false;
  for (const margins of Array.from(document.getElementsByTagNameNS(W, 'pgMar'))) {
    for (const side of ['left', 'right']) {
      if (margins.getAttributeNS(W, side) === String(PAGE_SIDE_MARGIN_TWIPS)) continue;
      margins.setAttributeNS(W, `w:${side}`, String(PAGE_SIDE_MARGIN_TWIPS));
      changed = true;
    }
  }
  return changed;
}

function neighboringElement(node, direction) {
  let neighbor = node[direction];
  while (neighbor && neighbor.nodeType !== 1) neighbor = neighbor[direction];
  return neighbor;
}

function neighboringLayoutCell(paragraph, direction) {
  const cell = paragraph.parentNode;
  const row = cell?.parentNode;
  if (cell?.namespaceURI !== W || cell.localName !== 'tc' || row?.localName !== 'tr') return null;
  const adjacentRow = neighboringElement(row, direction);
  if (adjacentRow?.namespaceURI !== W || adjacentRow.localName !== 'tr') return null;
  const cells = node => Array.from(node.childNodes).filter(child => child.namespaceURI === W && child.localName === 'tc');
  return cells(adjacentRow)[cells(row).indexOf(cell)] || null;
}

function alignMediaDescriptions(document) {
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const contains = (node, namespace, name) => Boolean(node?.getElementsByTagNameNS(namespace, name).length);
  let changed = false;
  for (const paragraph of Array.from(document.getElementsByTagNameNS(W, 'p'))) {
    const text = Array.from(paragraph.getElementsByTagNameNS(W, 't')).map(node => node.textContent).join('');
    const previous = neighboringElement(paragraph, 'previousSibling');
    const next = neighboringElement(paragraph, 'nextSibling');
    const isFigureCaption = /^Figura\s+\d+\.\s/u.test(text)
      && previous?.namespaceURI === W && previous.localName === 'p'
      && (contains(previous, W, 'drawing') || previous.textContent === '[Figura no disponible]');
    const isTableCaption = /^Cuadro\s+\d+\.\s/u.test(text)
      && ((next?.namespaceURI === W && next.localName === 'tbl')
        || contains(neighboringLayoutCell(paragraph, 'nextSibling'), W, 'tbl'));
    const isFormulaDescription = /^D[oó]nde:\s/iu.test(text)
      && (contains(previous, M, 'oMath')
        || contains(neighboringLayoutCell(paragraph, 'previousSibling'), M, 'oMath'));
    if (!isFigureCaption && !isTableCaption && !isFormulaDescription) continue;
    let properties = paragraph.getElementsByTagNameNS(W, 'pPr')[0];
    if (!properties) {
      properties = document.createElementNS(W, 'w:pPr');
      paragraph.insertBefore(properties, paragraph.firstChild);
    }
    let alignment = properties.getElementsByTagNameNS(W, 'jc')[0];
    if (alignment?.getAttributeNS(W, 'val') !== 'left') {
      if (!alignment) {
        alignment = document.createElementNS(W, 'w:jc');
        properties.appendChild(alignment);
      }
      alignment.setAttributeNS(W, 'w:val', 'left');
      changed = true;
    }
    if (isFormulaDescription) {
      for (const run of Array.from(paragraph.getElementsByTagNameNS(W, 'r'))) {
        let runProperties = run.getElementsByTagNameNS(W, 'rPr')[0];
        if (!runProperties) {
          runProperties = document.createElementNS(W, 'w:rPr');
          run.insertBefore(runProperties, run.firstChild);
        }
        for (const name of ['sz', 'szCs']) {
          let size = runProperties.getElementsByTagNameNS(W, name)[0];
          if (size?.getAttributeNS(W, 'val') === '18') continue;
          if (!size) {
            size = document.createElementNS(W, `w:${name}`);
            runProperties.appendChild(size);
          }
          size.setAttributeNS(W, 'w:val', '18');
          changed = true;
        }
      }
    }
  }
  return changed;
}

// The original artwork remains in its own header/footer parts, outside the body.
export async function applyPageTemplate(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  if (zip.file('word/rct-header.xml') && zip.file('word/rct-footer.xml')) {
    const document = parse(await zip.file('word/document.xml').async('string'));
    const marginsChanged = setSideMargins(document);
    const captionsChanged = alignMediaDescriptions(document);
    if (!marginsChanged && !captionsChanged) return { buffer, changed: false };
    zip.file('word/document.xml', serialize(document));
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), changed: true };
  }
  const document = parse(await zip.file('word/document.xml').async('string'));
  alignMediaDescriptions(document);
  const relationships = parse(await zip.file('word/_rels/document.xml.rels').async('string'));
  const types = parse(await zip.file('[Content_Types].xml').async('string'));
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  let drawingId = Math.max(1000, ...Array.from(document.getElementsByTagNameNS(WP, 'docPr')).map(n => Number(n.getAttribute('id')) || 0));

  for (const kind of ['header', 'footer']) {
    const name = `rct-${kind}.xml`;
    const part = parse(await template.file(`word/${kind}1.xml`).async('string'));
    for (const drawing of Array.from(part.getElementsByTagNameNS(WP, 'docPr'))) drawing.setAttribute('id', String(++drawingId));
    zip.file(`word/${name}`, serialize(part));
    const partRels = parse(await template.file(`word/_rels/${kind}1.xml.rels`).async('string'));
    for (const rel of Array.from(partRels.getElementsByTagNameNS(REL, 'Relationship'))) {
      const source = rel.getAttribute('Target');
      if (!/^media\/image\d+\.jpeg$/.test(source)) throw new Error('Recurso inesperado en la plantilla.');
      const target = source.replace('media/', 'media/rct-');
      zip.file(`word/${target}`, await template.file(`word/${source}`).async('nodebuffer'));
      rel.setAttribute('Target', target);
    }
    zip.file(`word/_rels/${name}.rels`, serialize(partRels));
    const relation = relationships.createElementNS(REL, 'Relationship');
    for (const old of Array.from(relationships.getElementsByTagNameNS(REL, 'Relationship'))) {
      if (old.getAttribute('Id') === `rct-${kind}`) old.parentNode.removeChild(old);
    }
    relation.setAttribute('Id', `rct-${kind}`);
    relation.setAttribute('Type', `${R}/${kind}`);
    relation.setAttribute('Target', name);
    relationships.documentElement.appendChild(relation);
    const type = types.createElementNS(CT, 'Override');
    for (const old of Array.from(types.getElementsByTagNameNS(CT, 'Override'))) {
      if (old.getAttribute('PartName') === `/word/${name}`) old.parentNode.removeChild(old);
    }
    type.setAttribute('PartName', `/word/${name}`);
    type.setAttribute('ContentType', `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`);
    types.documentElement.appendChild(type);
  }
  if (!Array.from(types.getElementsByTagNameNS(CT, 'Default')).some(n => n.getAttribute('Extension') === 'jpeg')) {
    const type = types.createElementNS(CT, 'Default');
    type.setAttribute('Extension', 'jpeg'); type.setAttribute('ContentType', 'image/jpeg');
    types.documentElement.appendChild(type);
  }
  for (const target of Array.from(document.getElementsByTagNameNS(W, 'sectPr'))) {
    for (const node of Array.from(target.childNodes)) {
      if (node.namespaceURI === W && ['headerReference', 'footerReference', 'pgSz', 'pgMar', 'titlePg'].includes(node.localName)) target.removeChild(node);
    }
    const additions = [];
    for (const kind of ['header', 'footer']) {
      const reference = document.createElementNS(W, `w:${kind}Reference`);
      reference.setAttributeNS(W, 'w:type', 'default');
      reference.setAttributeNS(R, 'r:id', `rct-${kind}`);
      additions.push(reference);
    }
    // References precede section properties; page size/margins follow section type.
    for (const node of additions.reverse()) target.insertBefore(node, target.firstChild);
    const next = Array.from(target.childNodes).find(n => n.namespaceURI === W && !['headerReference','footerReference','footnotePr','endnotePr','type'].includes(n.localName)) || null;
    for (const name of ['pgSz', 'pgMar']) target.insertBefore(document.importNode(section.getElementsByTagNameNS(W, name)[0], true), next);
  }
  setSideMargins(document);
  zip.file('word/document.xml', serialize(document));
  if (zip.file('word/settings.xml')) {
    const settings = parse(await zip.file('word/settings.xml').async('string'));
    for (const node of Array.from(settings.getElementsByTagNameNS(W, 'evenAndOddHeaders'))) node.parentNode.removeChild(node);
    zip.file('word/settings.xml', serialize(settings));
  }
  zip.file('word/_rels/document.xml.rels', serialize(relationships));
  zip.file('[Content_Types].xml', serialize(types));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), changed: true };
}
