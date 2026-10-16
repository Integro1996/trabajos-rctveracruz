import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { mergeAdjacentText, referenceText } from "../flow.js";
import { inlineMathSegments, symbolsFromFormula } from "../formula-description.js";
const FormulaField = lazy(() => import("./FormulaField.jsx"));
const InlineMath = lazy(() => import("./FormulaField.jsx").then(({ InlineMath: Component }) => ({ default: Component })));

const SECTIONS = ["Introducción", "Objetivos", "Materiales y métodos", "Resultados y discusión", "Conclusiones", "Agradecimientos", "Referencias bibliográficas"];
const OTHER_SECTIONS = SECTIONS.filter((section) => !["Introducción", "Objetivos", "Agradecimientos"].includes(section));
function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
const blankTable = (rows = 3, columns = 3) => Array.from({ length: rows }, () => Array.from({ length: columns }, () => ""));

function resizeTable(cells, rows, columns) {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => cells[row]?.[column] || ""));
}

function normalizePairs(items, maxColumns) {
  return items.map((block, index) => {
    if (!["figure", "table", "formula"].includes(block.type)) return block;
    const next = items[index + 1];
    const fits = block.type !== "table" || (block.cells[0].length <= maxColumns && next?.cells?.[0]?.length <= maxColumns);
    return { ...block, pairWithNext: Boolean(block.pairWithNext && next?.type === block.type && next.heading === block.heading && !items[index - 1]?.pairWithNext && fits) };
  });
}

function isPairedStart(items, index) {
  const block = items[index];
  const next = items[index + 1];
  return ["figure", "table", "formula"].includes(block?.type) && block.pairWithNext && next?.type === block.type && next.heading === block.heading;
}

function fileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No fue posible leer la figura."));
    reader.readAsDataURL(file);
  });
}

export default function BlockEditor({ articleId, introduction, onIntroductionChange, blocks, onChange, limits, disabled, issues = [] }) {
  const fileRef = useRef(null);
  const replaceFileRef = useRef(null);
  const uploadSectionRef = useRef(null);
  const replaceBlockRef = useRef(null);
  const editorRef = useRef(null);
  const blocksRef = useRef(blocks);
  const introductionRef = useRef(introduction);
  const lastTextSelectionRef = useRef(null);
  const descriptionRefs = useRef(new Map());
  blocksRef.current = blocks;
  introductionRef.current = introduction;
  const [openMenu, setOpenMenu] = useState(null);
  const [pendingFigure, setPendingFigure] = useState(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [focusBlock, setFocusBlock] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [replacingBlockId, setReplacingBlockId] = useState(null);
  const [error, setError] = useState(null);
  const [replaceError, setReplaceError] = useState(null);
  const [tableError, setTableError] = useState(null);
  const [openFootnotes, setOpenFootnotes] = useState({});
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const busy = disabled || uploading;
  const cannotAdd = busy || blocks.length >= limits.maxBlocks;
  const maxPairedTableColumns = limits.maxPairedTableColumns ?? 4;

  useEffect(() => {
    const close = (event) => { if (!event.target.closest(".section-add-wrap")) setOpenMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (!pendingFigure) return;
    editorRef.current?.querySelector('[id="section-' + pendingFigure.section + '"] .figure-upload-panel')?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pendingFigure]);
  useEffect(() => {
    if (!focusBlock || busy) return;
    const element = editorRef.current?.querySelector('[data-block-id="' + focusBlock + '"]');
    element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const field = element?.querySelector("math-field, .fixed-caption input, textarea, input");
    field?.focus({ preventScroll: true });
    if (element?.closest('[id="section-Referencias bibliográficas"]') && field?.tagName === "TEXTAREA") {
      field.setSelectionRange(field.value.length, field.value.length);
    }
    setFocusBlock(null);
  }, [blocks, focusBlock, busy]);
  useEffect(() => {
    if (mergeAdjacentText(introductionRef.current, blocksRef.current).changed) changeBlocks(blocksRef.current);
  }, [articleId]);

  const changeIntroduction = (value) => { introductionRef.current = value; onIntroductionChange(value); };
  const changeBlocks = (items, { mergeText = true } = {}) => {
    const merged = mergeText ? mergeAdjacentText(introductionRef.current, items) : { introduction: introductionRef.current, blocks: items };
    const normalized = normalizePairs(merged.blocks, maxPairedTableColumns);
    blocksRef.current = normalized;
    if (merged.introduction !== introductionRef.current) changeIntroduction(merged.introduction);
    onChange(normalized);
  };
  const update = (id, changes) => changeBlocks(blocksRef.current.map((block) => block.id === id ? { ...block, ...changes } : block), { mergeText: false });
  const insertDescriptionSymbol = (id, latex) => {
    const block = blocksRef.current.find((item) => item.id === id);
    if (!block) return;
    const field = descriptionRefs.current.get(id);
    const current = block.description || "";
    const start = field?.selectionStart ?? current.length;
    const end = field?.selectionEnd ?? start;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const prefix = before && !/\s$/u.test(before) ? " " : "";
    const suffix = after && !/^[\s.,;:!?]/u.test(after) ? " " : "";
    const insertion = `${prefix}$${latex}$${suffix}`;
    update(id, { description: before + insertion + after });
    window.requestAnimationFrame(() => {
      const updated = descriptionRefs.current.get(id);
      updated?.focus();
      updated?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  };
  const updateSectionText = (section, base, value) => {
    if (base) { update(base.id, { text: value, ...(section === "Referencias bibliográficas" ? { referenceTitle: "" } : {}) }); return; }
    const current = blocksRef.current;
    if (current.length >= limits.maxBlocks) { setError({ section, message: "Alcanzaste el máximo de elementos permitido." }); return; }
    const first = current.findIndex((item) => item.heading === section);
    const next = current.findIndex((item) => SECTIONS.indexOf(item.heading) > SECTIONS.indexOf(section));
    const at = first >= 0 ? first : next >= 0 ? next : current.length;
    changeBlocks([...current.slice(0, at), { id: newId(), type: "text", heading: section, text: value, ...(section === "Referencias bibliográficas" ? { referenceTitle: "" } : {}) }, ...current.slice(at)], { mergeText: false });
  };
  const remove = (id) => changeBlocks(blocksRef.current.filter((block) => block.id !== id));
  const rememberCaret = (section, blockId, event) => {
    lastTextSelectionRef.current = { section, blockId, start: event.target.selectionStart };
  };
  const placementFor = (section) => lastTextSelectionRef.current?.section === section ? { ...lastTextSelectionRef.current } : null;
  const insert = (section, block) => {
    const current = blocksRef.current;
    if (current.length >= limits.maxBlocks) { setError({ section, message: "Alcanzaste el máximo de elementos permitido." }); return; }
    const last = current.findLastIndex((item) => item.heading === section);
    const index = last >= 0 ? last + 1 : current.findIndex((item) => SECTIONS.indexOf(item.heading) > SECTIONS.indexOf(section));
    const at = index < 0 ? current.length : index;
    changeBlocks([...current.slice(0, at), block, ...current.slice(at)]);
    setOpenMenu(null);
    setError(null);
    setFocusBlock(block.id);
  };
  const insertAtCaret = (section, block, placement = placementFor(section)) => {
    const current = blocksRef.current;
    const sourceIndex = placement?.blockId === null ? -1 : current.findIndex((item) => item.id === placement?.blockId && item.heading === section && item.type === "text");
    const source = section === "Introducción" && placement?.blockId === null ? introductionRef.current : current[sourceIndex]?.text;
    if (!placement || source === undefined) {
      const needsBase = section === "Objetivos" && !current.some((item) => item.heading === section && item.type === "text");
      if (current.length + 2 + Number(needsBase) > limits.maxBlocks) {
        setError({ section, message: "No hay espacio para agregar el elemento y continuar el texto. Elimina algún elemento e inténtalo de nuevo." });
        return;
      }
      const last = current.findLastIndex((item) => item.heading === section);
      const index = last >= 0 ? last + 1 : current.findIndex((item) => SECTIONS.indexOf(item.heading) > SECTIONS.indexOf(section));
      const at = index < 0 ? current.length : index;
      const trailing = { id: newId(), type: "text", heading: section, text: "" };
      const base = needsBase ? [{ id: newId(), type: "text", heading: section, text: "" }] : [];
      changeBlocks([...current.slice(0, at), ...base, block, trailing, ...current.slice(at)], { mergeText: false });
      setOpenMenu(null);
      setError(null);
      setFocusBlock(block.id);
      return;
    }
    const caret = Math.max(0, Math.min(source.length, placement.start));
    const before = source.slice(0, caret);
    const after = source.slice(caret);
    const baseId = section === "Introducción" ? null : current.find((item) => item.heading === section && item.type === "text")?.id;
    const replaceEmptyStart = sourceIndex >= 0 && placement.blockId !== baseId && !before;
    if (current.length + (replaceEmptyStart ? 1 : 2) > limits.maxBlocks) {
      setError({ section, message: "No hay espacio para insertar este elemento dentro del texto. Elimina algún elemento e inténtalo de nuevo." });
      return;
    }
    const trailing = { id: newId(), type: "text", heading: section, text: after };
    let updated = current;
    let at;
    if (sourceIndex < 0) {
      changeIntroduction(before);
      at = current.findIndex((item) => item.heading === section);
      if (at < 0) at = 0;
    } else if (replaceEmptyStart) {
      updated = current.filter((item) => item.id !== placement.blockId);
      at = sourceIndex;
    } else {
      updated = current.map((item) => item.id === placement.blockId ? { ...item, text: before } : item);
      at = sourceIndex + 1;
    }
    changeBlocks([...updated.slice(0, at), block, trailing, ...updated.slice(at)], { mergeText: false });
    lastTextSelectionRef.current = { section, blockId: trailing.id, start: 0 };
    setOpenMenu(null);
    setError(null);
    setFocusBlock(trailing.id);
  };
  const move = (section, id, direction) => {
    const current = [...blocksRef.current];
    const sectionItems = current.filter((block) => block.heading === section);
    const base = section === "Introducción" ? null : sectionItems.find((block) => block.type === "text");
    const extras = sectionItems.filter((block) => block.id !== base?.id);
    const visible = extras.filter((block, index) => !(index > 0 && isPairedStart(extras, index - 1)));
    const from = visible.findIndex((block) => block.id === id);
    if (from < 0) return;
    const other = visible[from + direction];
    if (!other) return;
    const firstIndex = current.findIndex((block) => block.id === id);
    const paired = isPairedStart(current, firstIndex);
    const group = current.splice(firstIndex, paired ? 2 : 1);
    const otherIndex = current.findIndex((block) => block.id === other.id);
    const otherPaired = isPairedStart(current, otherIndex);
    current.splice(otherIndex + (direction > 0 ? (otherPaired ? 2 : 1) : 0), 0, ...group);
    changeBlocks(current);
  };
  const addReference = (text) => insert("Referencias bibliográficas", {
    id: newId(), type: "text", heading: "Referencias bibliográficas", referenceTitle: "", text,
  });
  const addTable = (section) => insertAtCaret(section, { id: newId(), type: "table", heading: section, caption: "", footnote: "", cells: blankTable(), pairWithNext: false });
  const addFormula = (section) => insertAtCaret(section, { id: newId(), type: "formula", heading: section, latex: "", description: "", pairWithNext: false });
  const addSecondFormula = (section, firstId) => {
    const current = blocksRef.current;
    const index = current.findIndex((block) => block.id === firstId && block.heading === section && block.type === "formula");
    if (index < 0) return;
    if (current.length >= limits.maxBlocks) { setError({ section, message: "Se alcanzó el límite técnico de elementos del trabajo." }); return; }
    const second = { id: newId(), type: "formula", heading: section, latex: "", description: "", pairWithNext: false };
    changeBlocks([...current.slice(0, index), { ...current[index], pairWithNext: true }, second, ...current.slice(index + 1)]);
    setFocusBlock(second.id);
  };
  const addSecondTable = (section, firstId) => {
    const current = blocksRef.current;
    const index = current.findIndex((block) => block.id === firstId && block.heading === section && block.type === "table");
    if (index < 0) return;
    if (current.length >= limits.maxBlocks) {
      setError({ section, message: "Se alcanzó el límite técnico de elementos del trabajo." });
      return;
    }
    if (current[index].cells[0].length > maxPairedTableColumns) {
      setTableError({ blockId: firstId, message: "No se puede agregar otro cuadro debido a la anchura: reduce el primero a " + maxPairedTableColumns + " columnas." });
      return;
    }
    const second = { id: newId(), type: "table", heading: section, caption: "", footnote: "", cells: blankTable(3, Math.min(3, maxPairedTableColumns)), pairWithNext: false };
    changeBlocks([...current.slice(0, index), { ...current[index], pairWithNext: true }, second, ...current.slice(index + 1)]);
    setTableError(null);
    setFocusBlock(second.id);
  };
  const moveByDrag = (section, sourceId, targetId, after) => {
    if (!sourceId || sourceId === targetId) return;
    const current = [...blocksRef.current];
    const sourceIndex = current.findIndex((item) => item.id === sourceId && item.heading === section);
    const targetIndex = current.findIndex((item) => item.id === targetId && item.heading === section);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const base = section === "Introducción" ? null : current.find((item) => item.heading === section && item.type === "text");
    if (sourceId === base?.id || targetId === base?.id) return;
    const paired = isPairedStart(current, sourceIndex);
    const group = current.splice(sourceIndex, paired ? 2 : 1);
    const newTargetIndex = current.findIndex((block) => block.id === targetId);
    if (newTargetIndex < 0) return;
    const targetPaired = isPairedStart(current, newTargetIndex);
    current.splice(newTargetIndex + (after ? (targetPaired ? 2 : 1) : 0), 0, ...group);
    changeBlocks(current);
  };

  const uploadImage = async (file) => {
    if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Selecciona una figura en formato PNG o JPEG.");
    if (file.size > limits.maxImageBytes) throw new Error("La figura debe pesar menos de 8 MB.");
    return api("/api/lab/articles/" + articleId + "/assets", {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, dataUrl: await fileDataUrl(file) }),
    });
  };
  const startFigure = (section, options = {}) => {
    const pending = { section, ...options };
    uploadSectionRef.current = pending;
    setPendingFigure(pending);
    setDraggingFile(false);
    setError(null);
    setOpenMenu(null);
  };
  const uploadFigure = async (file) => {
    const pending = uploadSectionRef.current;
    const section = pending?.section;
    if (!file || !section || busy) return;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadImage(file);
      const figure = { id: newId(), type: "figure", heading: section, assetId: asset.id, asset, caption: "", pairWithNext: false };
      if (pending.afterId) {
        const current = blocksRef.current;
        const index = current.findIndex((block) => block.id === pending.afterId && block.heading === section && block.type === "figure");
        if (index < 0) throw new Error("La primera figura ya no está disponible.");
        changeBlocks([...current.slice(0, index), { ...current[index], pairWithNext: true }, figure, ...current.slice(index + 1)]);
        setFocusBlock(figure.id);
      } else {
        insertAtCaret(section, figure, pending.placement);
      }
      setPendingFigure(null);
      uploadSectionRef.current = null;
    } catch (uploadError) {
      setError({ section, message: uploadError.message });
    } finally {
      setUploading(false);
    }
  };
  const addFigure = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    uploadFigure(file);
  };
  const renderFigureUpload = () => <div className="figure-upload-panel" role="group" aria-label="Agregar figura">
    <div className="figure-upload-heading"><strong>Agregar figura</strong><button type="button" className="figure-upload-cancel" disabled={uploading} onClick={() => { setPendingFigure(null); uploadSectionRef.current = null; setError(null); }}>Cancelar</button></div>
    <div className={"figure-drop-zone" + (draggingFile ? " dragging" : "")}
      role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-label="Arrastra una foto aquí o haz clic para elegirla"
      onClick={() => { if (!busy) fileRef.current?.click(); }}
      onKeyDown={(event) => { if (!busy && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); fileRef.current?.click(); } }}
      onDragEnter={(event) => { event.preventDefault(); setDraggingFile(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingFile(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingFile(false); }}
      onDrop={(event) => { event.preventDefault(); setDraggingFile(false); uploadFigure(event.dataTransfer.files?.[0]); }}>
      <span className="figure-upload-icon" aria-hidden="true">↥</span>
      <strong>{uploading ? "Subiendo foto…" : "Arrastra una foto aquí"}</strong>
      <span>o</span>
      <span className="button secondary" aria-hidden="true">Elegir foto</span>
      <small>PNG o JPEG · máximo 8 MB</small>
    </div>
    {error?.section === pendingFigure?.section && <p className="field-error" role="alert">{error.message}</p>}
  </div>;
  const replaceFigure = async (event) => {
    const file = event.target.files?.[0];
    const blockId = replaceBlockRef.current;
    event.target.value = "";
    if (!file || !blockId) return;
    setReplaceError(null);
    setReplacingBlockId(blockId);
    setUploading(true);
    try {
      const asset = await uploadImage(file);
      if (!blocksRef.current.some((block) => block.id === blockId && block.type === "figure")) throw new Error("La figura ya no está disponible.");
      changeBlocks(blocksRef.current.map((block) => block.id === blockId ? { ...block, assetId: asset.id, asset } : block));
    } catch (uploadError) {
      setReplaceError({ blockId, message: uploadError.message });
    } finally {
      setUploading(false);
      setReplacingBlockId(null);
      replaceBlockRef.current = null;
    }
  };
  const tableColumnLimit = (id) => {
    const current = blocksRef.current;
    const index = current.findIndex((block) => block.id === id && block.type === "table");
    return isPairedStart(current, index) || isPairedStart(current, index - 1) ? maxPairedTableColumns : limits.maxTableColumns;
  };
  const pasteTableCells = (event, block, startRow, startColumn) => {
    const clipboardText = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/u.test(clipboardText)) return;
    event.preventDefault();
    const pastedRows = clipboardText.replace(/(?:\r\n|\r|\n)$/u, "").split(/\r\n|\r|\n/u).map((row) => row.split("\t"));
    const requiredRows = startRow + pastedRows.length;
    const requiredColumns = startColumn + Math.max(...pastedRows.map((row) => row.length));
    const maxColumns = tableColumnLimit(block.id);
    if (requiredRows > limits.maxTableRows || requiredColumns > maxColumns) {
      setTableError({ blockId: block.id, message: requiredColumns > maxColumns && maxColumns === maxPairedTableColumns
        ? "No se puede pegar debido a la anchura: los cuadros juntos admiten máximo " + maxPairedTableColumns + " columnas cada uno."
        : "El rango supera el límite de " + limits.maxTableRows + " filas o " + maxColumns + " columnas." });
      return;
    }
    const cells = resizeTable(block.cells, Math.max(block.cells.length, requiredRows), Math.max(block.cells[0]?.length || 1, requiredColumns));
    pastedRows.forEach((row, rowOffset) => row.forEach((value, columnOffset) => { cells[startRow + rowOffset][startColumn + columnOffset] = value; }));
    setTableError(null);
    update(block.id, { cells });
  };

  const renderFigureFields = (figure, number) => { const captionMissing = !figure.caption.trim(); return <div className="figure-editor">
    <div className="figure-preview"><img draggable="false" style={{ transform: "scale(" + (figure.scale ?? 100) / 100 + ")" }} src={figure.asset?.url} alt={figure.caption || "Vista previa de la figura " + number} /></div>
    <div className="figure-file-actions"><button className="button secondary" type="button" onClick={() => { replaceBlockRef.current = figure.id; setReplaceError(null); replaceFileRef.current?.click(); }}>{replacingBlockId === figure.id ? "Reemplazando…" : "Reemplazar figura"}</button><small>PNG o JPEG, hasta 8 MB.</small></div>
    {replaceError?.blockId === figure.id && <p className="field-error" role="alert">{replaceError.message}</p>}
    <label className="figure-scale"><span>Escala de la foto</span><div><span>Más pequeña</span><input type="range" min="25" max="100" step="5" value={figure.scale ?? 100} aria-label={"Escala de la figura " + number} disabled={busy} onChange={(event) => update(figure.id, { scale: Number(event.target.value) })} /><span>Más grande</span></div></label>
    <label className={"block-field caption-field" + (captionMissing ? " missing" : "")}><span>Título de la figura (obligatorio)</span><div className="fixed-caption"><strong>Figura {number}.</strong><input className={captionMissing ? "invalid" : ""} aria-invalid={captionMissing} value={figure.caption} onChange={(event) => update(figure.id, { caption: event.target.value })} placeholder="Escribe el título de la figura" maxLength="500" /></div>{captionMissing && <small className="caption-required-message">Falta el título de la figura.</small>}</label>
    <small>La referencia se coloca debajo de la figura.</small>
  </div>; };

  const renderTableFields = (table, number, paired) => {
    const maxColumns = paired ? maxPairedTableColumns : limits.maxTableColumns;
    const captionMissing = !table.caption.trim();
    const footnoteEnabled = openFootnotes[table.id] ?? Boolean(table.footnote?.trim());
    return <div className="table-editor">
      <label className={"block-field caption-field" + (captionMissing ? " missing" : "")}><span>Título del cuadro (obligatorio)</span><div className="fixed-caption"><strong>Cuadro {number}.</strong><input className={captionMissing ? "invalid" : ""} aria-invalid={captionMissing} value={table.caption} onChange={(event) => update(table.id, { caption: event.target.value })} placeholder="Escribe el título del cuadro" maxLength="500" /></div>{captionMissing && <small className="caption-required-message">Falta el título del cuadro.</small>}</label>
      <div className="table-size-controls">
        <label>Filas <input type="number" min="1" max={limits.maxTableRows} value={table.cells.length} onChange={(event) => update(table.id, { cells: resizeTable(table.cells, Math.max(1, Math.min(limits.maxTableRows, Number(event.target.value) || 1)), table.cells[0]?.length || 1) })} /></label>
        <label>Columnas <input type="number" min="1" max={maxColumns} value={table.cells[0]?.length || 1} onChange={(event) => {
          const requested = Number(event.target.value) || 1;
          if (requested > maxColumns) {
            setTableError({ blockId: table.id, message: paired ? "No se puede ampliar debido a la anchura: los cuadros juntos admiten máximo " + maxPairedTableColumns + " columnas cada uno." : "Este cuadro admite máximo " + limits.maxTableColumns + " columnas." });
            return;
          }
          setTableError(null);
          update(table.id, { cells: resizeTable(table.cells, table.cells.length, Math.max(1, requested)) });
        }} /></label>
      </div>
      <div className="table-grid-wrap"><table className="editable-grid"><tbody>{table.cells.map((row, rowIndex) => <tr key={table.id + "-r" + rowIndex}>{row.map((cell, columnIndex) => <td key={table.id + "-" + rowIndex + "-" + columnIndex}><input aria-label={"Fila " + (rowIndex + 1) + ", columna " + (columnIndex + 1)} value={cell} onPaste={(event) => pasteTableCells(event, table, rowIndex, columnIndex)} onChange={(event) => { const cells = table.cells.map((currentRow) => [...currentRow]); cells[rowIndex][columnIndex] = event.target.value; update(table.id, { cells }); }} /></td>)}</tr>)}</tbody></table></div>
      <label className="table-footnote-toggle"><input type="checkbox" checked={footnoteEnabled} onChange={(event) => { setOpenFootnotes((current) => ({ ...current, [table.id]: event.target.checked })); if (!event.target.checked) update(table.id, { footnote: "" }); }} /><span>Pie de página</span></label>
      {footnoteEnabled && <><label className="block-field table-footnote-field"><span>Explica las letras o símbolos del cuadro</span><textarea rows="2" value={table.footnote || ""} onChange={(event) => update(table.id, { footnote: event.target.value })} placeholder="Ejemplo: a y b indican diferencias significativas entre tratamientos." maxLength="2000" /></label><small>La nota aparecerá debajo del cuadro con letra más pequeña en el trabajo.</small></>}
      <small className="table-paste-help">Puedes pegar celdas desde Excel. Máximo {limits.maxTableRows} filas y {maxColumns} columnas.</small>
      {tableError?.blockId === table.id && <p className="field-error" role="alert">{tableError.message}</p>}
      <small>La referencia se coloca encima del cuadro.</small>
    </div>;
  };

  const renderFormulaFields = (formula, number) => {
    const symbols = symbolsFromFormula(formula.latex);
    const preview = inlineMathSegments(String(formula.description || "").replace(/^\s*D[oó]nde:\s*/iu, ""));
    return <div className="formula-editor">
    <span className="block-field-label">Escribe con el teclado matemático o pega una expresión LaTeX</span>
    <Suspense fallback={<span>Cargando editor matemático…</span>}><FormulaField latex={formula.latex} disabled={busy} onChange={(latex) => update(formula.id, { latex })} /></Suspense>
    <small>Completa los recuadros de la fórmula. Las fórmulas se guardan sin colores.</small>
    <div className="formula-examples">
      <button type="button" className="button secondary" onClick={() => update(formula.id, { latex: String.raw`\mu=\frac{\ln N_{t_1}-\ln N_{t_0}}{\Delta t}` })}>Ejemplo: tasa de crecimiento</button>
      <button type="button" className="button secondary" onClick={() => update(formula.id, { latex: String.raw`T_d=\frac{\log 2}{\mu}` })}>Ejemplo: tiempo de duplicación</button>
    </div>
    {symbols.length > 0 && <div className="formula-symbol-tools" role="group" aria-label="Símbolos detectados en la fórmula"><span>Inserta un símbolo en «Donde:»</span><div>{symbols.map((symbol) => <button key={symbol} type="button" className="formula-symbol-button" title="Insertar este símbolo en Donde" aria-label={`Insertar ${symbol} en Donde`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertDescriptionSymbol(formula.id, symbol)}><Suspense fallback={<span>{symbol}</span>}><InlineMath latex={symbol} /></Suspense></button>)}</div></div>}
    <label className="block-field formula-description-field"><span>Donde:</span><textarea ref={(field) => { if (field) descriptionRefs.current.set(formula.id, field); else descriptionRefs.current.delete(formula.id); }} rows="3" aria-label={"Donde de la fórmula " + number} aria-invalid={issues.some((issue) => issue.blockId === formula.id && issue.id.startsWith("description-"))} value={formula.description || ""} onChange={(event) => update(formula.id, { description: event.target.value })} placeholder="Explica el significado de los símbolos y variables…" maxLength="2000" /></label>
    {preview.some((part) => part.type === "math") && <div className="formula-description-preview"><strong>Así se verá en el trabajo:</strong><p>Donde: {preview.map((part, index) => part.type === "math" ? <Suspense key={index} fallback={<span>{part.latex}</span>}><InlineMath latex={part.latex} /></Suspense> : <span key={index}>{part.text}</span>)}</p></div>}
    <small>La fórmula irá centrada y el texto «Donde:» aparecerá debajo en el trabajo.</small>
    {issues.filter((issue) => issue.blockId === formula.id).map((issue) => <p className="field-error" role="alert" key={issue.id}>{issue.message}</p>)}
  </div>;
  };

  const renderBlock = (block, section, extraIndex, extraCount) => {
    const index = blocks.findIndex((item) => item.id === block.id);
    const number = blocks.slice(0, index + 1).filter((item) => item.type === block.type).length;
    const next = blocks[index + 1]?.heading === section ? blocks[index + 1] : null;
    const pairedFigure = block.type === "figure" && block.pairWithNext && next?.type === "figure";
    const pairedTable = block.type === "table" && block.pairWithNext && next?.type === "table";
    const pairedFormula = block.type === "formula" && block.pairWithNext && next?.type === "formula";
    const pairTooWide = block.type === "table" && next?.type === "table"
      && (block.cells[0].length > maxPairedTableColumns || next.cells[0].length > maxPairedTableColumns);
    return <article id={"block-" + block.id} className={"content-block " + block.type + (dropTargetId === block.id ? " drop-target" : "") + (issues.some((issue) => issue.blockId === block.id || issue.blockId === next?.id) ? " has-issues" : "")} data-block-id={block.id} key={block.id}
      onDragOver={(event) => { if (draggedId && blocksRef.current.some((item) => item.id === draggedId && item.heading === section)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetId(block.id); } }}
      onDrop={(event) => { event.preventDefault(); moveByDrag(section, event.dataTransfer.getData("text/plain"), block.id, event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2); setDraggedId(null); setDropTargetId(null); }}>
      <fieldset className="block-edit-fields" disabled={busy}>
        <header className="block-header">
          <strong>{block.type === "text" ? section === "Referencias bibliográficas" ? "Referencia adicional" : "Continuación del texto" : block.type === "formula" ? pairedFormula ? "Fórmulas en este punto · Fórmulas " + number + " y " + (number + 1) : "Fórmula en este punto" : block.type === "figure" ? pairedFigure ? "Figuras en este punto · Figuras " + number + " y " + (number + 1) : "Figura en este punto · Figura " + number : pairedTable ? "Cuadros en este punto · Cuadros " + number + " y " + (number + 1) : "Cuadro en este punto · Cuadro " + number}</strong>
          <div className="block-actions">
            {block.type !== "text" && <span className="drag-handle" draggable={!busy} aria-hidden="true" title="Arrastra arriba o abajo para cambiar la posición"
              onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", block.id); setDraggedId(block.id); }} onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}>↕</span>}
            <button type="button" aria-label="Subir elemento" onClick={() => move(section, block.id, -1)} disabled={extraIndex === 0}>↑</button>
            <button type="button" aria-label="Bajar elemento" onClick={() => move(section, block.id, 1)} disabled={extraIndex === extraCount - 1}>↓</button>
            <button type="button" className="danger-link" onClick={() => remove(block.id)}>{pairedFigure ? "Eliminar figura " + number : pairedTable ? "Eliminar cuadro " + number : pairedFormula ? "Eliminar fórmula " + number : "Eliminar"}</button>
          </div>
        </header>
        {block.type === "text" && (section === "Referencias bibliográficas"
          ? <div className="reference-fields"><label className="block-field"><span>Referencia bibliográfica</span><textarea rows="3" value={referenceText(block)} onChange={(event) => update(block.id, { text: event.target.value, referenceTitle: "" })} placeholder="Escribe la referencia completa…" /></label></div>
          : <label className="block-field flow-text-field"><span>Continuar texto</span><textarea rows="7" aria-label={"Continuar texto de " + section} value={block.text} onSelect={(event) => rememberCaret(section, block.id, event)} onClick={(event) => rememberCaret(section, block.id, event)} onKeyUp={(event) => rememberCaret(section, block.id, event)} onChange={(event) => { rememberCaret(section, block.id, event); update(block.id, { text: event.target.value }); }} placeholder="Sigue escribiendo esta sección aquí…" /></label>)}
        {block.type === "formula" && <div className="formula-group-editor">
          <div className={"formula-pair-layout" + (pairedFormula ? " paired" : "")}>
            <div className="formula-unit">{pairedFormula && <strong className="formula-unit-title">Fórmula {number}</strong>}{renderFormulaFields(block, number)}</div>
            {pairedFormula && <div id={"block-" + next.id} className="formula-unit second-formula" data-block-id={next.id}>
              <div className="formula-unit-header"><strong className="formula-unit-title">Fórmula {number + 1}</strong><button type="button" className="danger-link" onClick={() => remove(next.id)}>Eliminar segunda fórmula</button></div>
              {renderFormulaFields(next, number + 1)}
            </div>}
          </div>
          {next?.type === "formula"
            ? <label className="formula-pair-option"><input type="checkbox" checked={Boolean(block.pairWithNext)} onChange={(event) => update(block.id, { pairWithNext: event.target.checked })} /><span>Mostrar las dos fórmulas juntas en el trabajo</span></label>
            : section !== "Conclusiones" && <button className="button secondary add-second-formula" type="button" disabled={cannotAdd} onClick={() => addSecondFormula(section, block.id)}>+ Agregar segunda fórmula</button>}
        </div>}
        {block.type === "figure" && <div className="figure-group-editor">
          <div className={"figure-pair-layout" + (pairedFigure ? " paired" : "")}>
            <div className="figure-unit">{pairedFigure && <strong className="figure-unit-title">Figura {number}</strong>}{renderFigureFields(block, number)}</div>
            {pairedFigure && <div id={"block-" + next.id} className="figure-unit second-figure" data-block-id={next.id}>
              <div className="figure-unit-header"><strong className="figure-unit-title">Figura {number + 1}</strong><button type="button" className="danger-link" onClick={() => remove(next.id)}>Eliminar segunda figura</button></div>
              {renderFigureFields(next, number + 1)}
            </div>}
          </div>
          {next?.type === "figure"
            ? <label className="figure-pair-option"><input type="checkbox" checked={Boolean(block.pairWithNext)} onChange={(event) => update(block.id, { pairWithNext: event.target.checked })} /><span>Mostrar las dos figuras juntas en el trabajo</span></label>
            : section !== "Conclusiones" && <button className="button secondary add-second-figure" type="button" disabled={cannotAdd} onClick={() => startFigure(section, { afterId: block.id })}>+ Agregar segunda figura</button>}
        </div>}
        {block.type === "table" && <div className="table-group-editor">
          <div className={"table-pair-layout" + (pairedTable ? " paired" : "")}>
            <div className="table-unit">{pairedTable && <strong className="table-unit-title">Cuadro {number}</strong>}{renderTableFields(block, number, pairedTable)}</div>
            {pairedTable && <div id={"block-" + next.id} className="table-unit second-table" data-block-id={next.id}>
              <div className="table-unit-header"><strong className="table-unit-title">Cuadro {number + 1}</strong><button type="button" className="danger-link" onClick={() => remove(next.id)}>Eliminar segundo cuadro</button></div>
              {renderTableFields(next, number + 1, true)}
            </div>}
          </div>
          {pairTooWide
            ? <p className="field-error" role="status">No se pueden mostrar juntos debido a la anchura: cada cuadro puede tener como máximo {maxPairedTableColumns} columnas.</p>
            : next?.type === "table"
              ? <label className="table-pair-option"><input type="checkbox" checked={Boolean(block.pairWithNext)} onChange={(event) => update(block.id, { pairWithNext: event.target.checked })} /><span>Mostrar los dos cuadros juntos en el trabajo</span></label>
              : section === "Conclusiones" ? null : block.cells[0].length > maxPairedTableColumns
                  ? <p className="field-error" role="status">No se puede agregar un segundo cuadro debido a la anchura: reduce este cuadro a {maxPairedTableColumns} columnas como máximo.</p>
                  : <button className="button secondary add-second-table" type="button" disabled={cannotAdd} onClick={() => addSecondTable(section, block.id)}>+ Agregar segundo cuadro</button>}
        </div>}
      </fieldset>
    </article>;
  };

  const renderSection = (section) => {
    const items = blocks.filter((block) => block.heading === section);
    const base = section === "Introducción" ? null : items.find((block) => block.type === "text");
    const extras = items.filter((block) => block.id !== base?.id);
    const visibleExtras = extras.filter((block, index) => !(index > 0 && isPairedStart(extras, index - 1)));
    const pendingHere = pendingFigure?.section === section && !pendingFigure.afterId;
    const placement = pendingHere ? pendingFigure.placement : null;
    const source = placement?.blockId === null && section === "Introducción"
      ? { id: null }
      : items.find((block) => block.id === placement?.blockId && block.type === "text");
    const sourceIsExtra = source && source.id !== base?.id && source.id !== null;
    const uploadBeforeId = sourceIsExtra && placement.start === 0 ? source.id : null;
    const uploadAfterId = sourceIsExtra && placement.start !== 0 ? source.id : null;
    const open = openMenu === section;
    const sectionIndex = SECTIONS.indexOf(section);
    const sectionIssues = issues.filter((issue) => issue.section === section);
    return <section id={"section-" + section} className={"fixed-section" + (sectionIssues.length ? " has-issues" : "")} aria-labelledby={"section-title-" + sectionIndex} key={section}>
      <header className="fixed-section-header">
        <div><span className="eyebrow">Sección obligatoria</span><h3 id={"section-title-" + sectionIndex}>{section === "Objetivos" ? "Objetivos (final de la introducción)" : section}</h3></div>
        {section !== "Conclusiones" && section !== "Referencias bibliográficas" && <div className="section-add-wrap" onKeyDown={(event) => { if (event.key === "Escape") { setOpenMenu(null); event.currentTarget.querySelector("button")?.focus(); } }}>
          <button className="section-add-button" type="button" aria-label={"Agregar contenido a " + section} aria-expanded={open} aria-controls={"section-menu-" + sectionIndex} disabled={cannotAdd} onClick={() => setOpenMenu(open ? null : section)} />
          {open && <div className="section-add-menu" id={"section-menu-" + sectionIndex} role="group" aria-label={"Agregar a " + section}>
            <>
                <span>Agregar contenido</span>
                <button type="button" onClick={() => startFigure(section, { placement: placementFor(section) })} disabled={cannotAdd}>Figura</button>
                <button type="button" onClick={() => addTable(section)} disabled={cannotAdd}>Cuadro</button>
                <button type="button" onClick={() => addFormula(section)} disabled={cannotAdd}>Fórmula</button>
              </>
          </div>}
        </div>}
      </header>
      {section !== "Conclusiones" && <p className="placement-help">{section === "Referencias bibliográficas"
        ? "Escribe una referencia completa en cada campo. El siguiente aparecerá automáticamente. Solo los nombres científicos se mostrarán en cursiva."
        : "Sitúa el cursor donde quieras insertar una figura, cuadro o fórmula y pulsa +. Después puedes mover el elemento arriba o abajo."}</p>}
      {sectionIssues.length > 0 && <ul className="section-issues">{sectionIssues.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul>}
      <div className="section-content-surface">
        {section === "Introducción"
          ? <label className="block-field required-section-text"><span>Contenido obligatorio</span><textarea id="article-introduction" rows="2" aria-invalid={sectionIssues.some((issue) => issue.id === "section-Introducción")} value={introduction} disabled={busy} onSelect={(event) => rememberCaret(section, null, event)} onClick={(event) => rememberCaret(section, null, event)} onKeyUp={(event) => rememberCaret(section, null, event)} onChange={(event) => { rememberCaret(section, null, event); changeIntroduction(event.target.value); }} placeholder="Escribe la introducción del trabajo…" /></label>
          : section === "Referencias bibliográficas"
            ? <div className="reference-fields required-section-text" data-block-id={base?.id}><label className="block-field"><span>Referencia bibliográfica</span><textarea rows="3" value={referenceText(base)} disabled={busy} aria-invalid={sectionIssues.some((issue) => issue.id === `section-${section}`)} onChange={(event) => updateSectionText(section, base, event.target.value)} placeholder="Escribe la referencia completa…" /></label></div>
            : <label className="block-field required-section-text" data-block-id={base?.id}><span>Contenido obligatorio</span><textarea rows="2" aria-invalid={sectionIssues.some((issue) => issue.id === `section-${section}`)} value={base?.text || ""} disabled={busy} onSelect={(event) => rememberCaret(section, base?.id, event)} onClick={(event) => rememberCaret(section, base?.id, event)} onKeyUp={(event) => rememberCaret(section, base?.id, event)} onChange={(event) => { rememberCaret(section, base?.id, event); updateSectionText(section, base, event.target.value); }} placeholder={"Escribe " + section.toLocaleLowerCase("es-MX") + "…"} /></label>}
        {pendingHere && source && !sourceIsExtra && renderFigureUpload()}
        {visibleExtras.length > 0 && <div className="section-elements">{visibleExtras.map((block, index) => <Fragment key={block.id}>
          {uploadBeforeId === block.id && renderFigureUpload()}
          {renderBlock(block, section, index, visibleExtras.length)}
          {(uploadAfterId === block.id || pendingFigure?.section === section && pendingFigure.afterId === block.id) && renderFigureUpload()}
        </Fragment>)}</div>}
        {pendingHere && !source && renderFigureUpload()}
        {section === "Referencias bibliográficas" && referenceText(items.at(-1)).trim() && !cannotAdd && <div className="reference-fields reference-next"><label className="block-field"><span>Nueva referencia</span><textarea rows="3" value="" disabled={busy} onChange={(event) => { if (event.target.value.trim()) addReference(event.target.value); }} placeholder="Escribe otra referencia…" /></label></div>}
      </div>
      {error?.section === section && pendingFigure?.section !== section && <p className="field-error" role="alert">{error.message}</p>}
    </section>;
  };

  const acknowledgment = blocks.find((block) => block.heading === "Agradecimientos" && block.type === "text");
  return <section className="card blocks-card" ref={editorRef} aria-labelledby="blocks-title">
    <header className="section-intro"><div className="section-heading"><div><span className="eyebrow">Contenido del trabajo</span><h2 id="blocks-title">Secciones del trabajo</h2></div></div><p className="section-help">Completa las secciones obligatorias escribiendo en sus campos. Los objetivos van al final de la introducción. En las secciones que lo permiten, usa el + para añadir figuras, cuadros o fórmulas. El espacio para continuar el texto aparece automáticamente.</p></header>
    <input ref={fileRef} className="visually-hidden" type="file" accept="image/png,image/jpeg" onChange={addFigure} disabled={busy} aria-label="Seleccionar figura" />
    <input ref={replaceFileRef} className="visually-hidden" type="file" accept="image/png,image/jpeg" onChange={replaceFigure} disabled={busy} aria-label="Seleccionar figura de reemplazo" />
    <div className="fixed-sections">
      {renderSection("Introducción")}
      {renderSection("Objetivos")}
      {OTHER_SECTIONS.slice(0, -1).map(renderSection)}
      <section id="section-Agradecimientos" className={"acknowledgments-section" + (issues.some((issue) => issue.section === "Agradecimientos") ? " has-issues" : "")} aria-labelledby="acknowledgments-title">
        <label className="acknowledgments-toggle"><input type="checkbox" checked={Boolean(acknowledgment)} disabled={busy} onChange={(event) => {
          if (event.target.checked) insert("Agradecimientos", { id: newId(), type: "text", heading: "Agradecimientos", text: "" });
          else changeBlocks(blocksRef.current.filter((block) => block.heading !== "Agradecimientos"));
        }} /><span id="acknowledgments-title">Incluir agradecimientos</span></label>
        {issues.some((issue) => issue.section === "Agradecimientos") && <ul className="section-issues"><li>Escribe los agradecimientos o desactiva la opción.</li></ul>}
        {acknowledgment && <label className="block-field required-section-text" data-block-id={acknowledgment.id}><span>Agradecimientos</span><textarea rows="5" aria-invalid={issues.some((issue) => issue.section === "Agradecimientos")} value={acknowledgment.text} disabled={busy} onChange={(event) => update(acknowledgment.id, { text: event.target.value })} placeholder="Escribe aquí los agradecimientos…" /></label>}
      </section>
      {renderSection("Referencias bibliográficas")}
    </div>
  </section>;
}
