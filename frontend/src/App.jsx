import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import MetadataForm from "./components/MetadataForm.jsx";
import DiagnosticPanel from "./components/DiagnosticPanel.jsx";
import BlockEditor from "./components/BlockEditor.jsx";
import { generationIssues } from "./content-validation.js";

const AdminPanel = lazy(() => import("./components/AdminPanel.jsx"));
const AdminDashboard = lazy(() => import("./components/AdminDashboard.jsx"));
const defaultLimits = { titleWords: 20, titleCharacters: 130, keywords: 5, authorsMin: 1, authorsMax: 30, minPages: 3, maxPages: 5, maxBlocks: 100, maxImageBytes: 8 * 1024 * 1024, maxTableRows: 50, maxTableColumns: 10 };

function date(value) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status) {
  return { draft: "Borrador", requires_changes: "Requiere cambios", finalized: "Finalizado" }[status] || status;
}

function AccessIcon({ kind }) {
  return <svg className="access-action-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "home" ? <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" />
      : kind === "copy" ? <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>
        : kind === "delete" ? <path d="M4 7h16m-10 4v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          : kind === "document" ? <><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h4M8 12h6M8 16h7" /></>
            : kind === "check" ? <path d="M4 12.5 9 17l11-11" />
              : kind === "back" ? <path d="M20 12H4m6-6-6 6 6 6" />
          : <path d="M4 12h16m-6-6 6 6-6 6" />}
  </svg>;
}

function RecentReference({ value }) {
  if (!value?.startsWith("RCT-")) return <span className="reference-label">{value || "Sin clave"}</span>;
  const editableKey = value.slice(4);
  return <span className="reference-label" onCopy={(event) => { event.preventDefault(); event.clipboardData.setData("text/plain", editableKey); }}><span className="reference-prefix">RCT-</span><span>{editableKey}</span></span>;
}

function RecoveryAccess({ payload, onContinue, onClose }) {
  const [, firstPart, lastPart] = payload.article.publicReference.split("-");
  const editableKey = `${firstPart}${lastPart}`;
  const copy = async () => navigator.clipboard.writeText(editableKey);
  return (
    <main className="shell access-shell">
      <section className="card recovery-card">
        <span className="success-mark">✓</span>
        <span className="eyebrow">¡LISTO!</span>
        <h1>Tu trabajo fue creado</h1>
        <p className="project-key-intro">Guarda esta clave. La necesitarás para abrir tu trabajo después.</p>
        <div className="credential-grid">
          <div className="credential public-credential"><span>CLAVE DE TU TRABAJO</span><div className="credential-code" onCopy={(event) => { event.preventDefault(); event.clipboardData.setData("text/plain", editableKey); }}><span className="credential-code-prefix">RCT</span><span className="credential-code-divider" aria-hidden="true" /><strong>{firstPart}</strong><span className="credential-code-hyphen">-</span><strong>{lastPart}</strong></div><p>Cuando vuelvas a abrir la plataforma, escribe el código de recuperación: los 6 caracteres rojos.</p></div>
        </div>
        <div className="action-row">
          <button className="button secondary" type="button" onClick={copy}><AccessIcon kind="copy" />Copiar mi clave</button>
          <button className="button primary" type="button" onClick={() => onContinue(payload.article.id)}><AccessIcon kind="continue" />Continuar mi trabajo</button>
        </div>
        {onClose && <button className="button ghost recovery-home-button" type="button" onClick={onClose}><AccessIcon kind="home" />Volver al inicio</button>}
      </section>
    </main>
  );
}

function PublicHome({ articles, limits, busy, onCreate, onOpen, onDelete, onRecover, error }) {
  const [firstPart, setFirstPart] = useState("");
  const [lastPart, setLastPart] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const deleteDialogRef = useRef(null);
  const lastPartRef = useRef(null);
  const firstPartRef = useRef(null);
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (deleteTarget && !dialog?.open) dialog?.showModal();
    if (!deleteTarget && dialog?.open) dialog.close();
  }, [deleteTarget]);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const result = await onDelete(deleteTarget);
    if (result.ok) setDeleteTarget(null);
    else setDeleteError(result.error);
  };
  const focusProjectKey = () => { firstPartRef.current?.focus({ preventScroll: true }); firstPartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const cleanPart = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const pasteKey = (event, part) => {
    const pasted = cleanPart(event.clipboardData.getData("text"));
    const value = pasted.startsWith("RCT") ? pasted.slice(3) : pasted;
    if (value.length > 6) { event.preventDefault(); return; }
    if (value.length >= 5) {
      event.preventDefault(); setFirstPart(value.slice(0, 4)); setLastPart(value.slice(4, 6)); lastPartRef.current?.focus(); return;
    }
    if (part === "first") {
      event.preventDefault(); setFirstPart(value.slice(0, 4));
      if (value.length >= 4) lastPartRef.current?.focus();
    }
  };
  return (
    <main className="shell list-shell">
      <header className="hero"><div><span className="lab-badge">PLATAFORMA DE TRABAJOS</span><h1>RCT-Veracruz</h1><p>Crea tu trabajo directamente desde nuestra plataforma</p></div><button className="button primary" type="button" disabled={busy} onClick={onCreate}>+ Crear trabajo</button></header>
      {error && <div className="alert error">{error}</div>}
      <div className="home-grid">
        <section className="card recovery-entry">
          <h2>Acceso a tu trabajo</h2>
          <p className="recovery-entry-intro">Ingresa tu clave para continuar.</p>
          <form onSubmit={(event) => { event.preventDefault(); if (firstPart.length === 4 && lastPart.length === 2) onRecover(`RCT-${firstPart}-${lastPart}`); }}>
            <label className="field-label" htmlFor="recovery-code">Clave de tu trabajo</label>
            <div className="project-key-input" role="group" aria-label="Clave de tu trabajo: RCT, cuatro caracteres y dos caracteres">
              <span className="project-key-prefix" aria-hidden="true">RCT</span>
              <span className="project-key-divider" aria-hidden="true" />
              <input id="recovery-code" ref={firstPartRef} value={firstPart} onChange={(event) => { const value = cleanPart(event.target.value).slice(0, 4); setFirstPart(value); if (value.length === 4) lastPartRef.current?.focus(); }} onPaste={(event) => pasteKey(event, "first")} maxLength={4} placeholder="XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label="Primeros cuatro caracteres de la clave de tu trabajo" />
              <span className="project-key-hyphen" aria-hidden="true">-</span>
              <input ref={lastPartRef} value={lastPart} onChange={(event) => setLastPart(cleanPart(event.target.value).slice(0, 2))} onPaste={(event) => pasteKey(event, "last")} onKeyDown={(event) => { if (event.key === "Backspace" && !lastPart) firstPartRef.current?.focus(); }} maxLength={2} placeholder="XX" autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-label="Últimos dos caracteres de la clave de tu trabajo" />
            </div>
            <button className="button primary wide-button" disabled={firstPart.length !== 4 || lastPart.length !== 2 || busy} type="submit">Abrir trabajo</button>
          </form>
          <p className="privacy-note">Puedes escribir la clave con letras mayúsculas o minúsculas.</p>
        </section>
        <section className="card articles-card recent-card">
          <div className="section-heading"><div><span className="eyebrow">Continúa tus trabajos</span><h2>Todos mis trabajos</h2></div><span>{articles.length}</span></div>
          {articles.length === 0 ? <div className="empty recent-empty"><strong>No hay trabajos creados.</strong><p>Crea uno desde aquí.</p><button className="button primary" type="button" disabled={busy} onClick={onCreate}>+ Crear trabajo</button><p>O <button className="empty-code-link" type="button" onClick={focusProjectKey}>introduce un código</button> para continuarlo.</p></div> : <div className="recent-list">{articles.map((article) => <article className="recent-item" key={article.id}>
            <div><RecentReference value={article.publicReference} /><h3>{article.title || "Trabajo sin título"}</h3><small>Última edición: {date(article.updatedAt)} · {article.pageCount === null ? "Vista pendiente de generar" : `${article.pageCount} páginas (se requieren ${limits.minPages} a ${limits.maxPages})`} · {article.figureCount} figuras · {article.tableCount} cuadros</small></div>
            <div className="row-actions"><button className="recent-action continue" type="button" onClick={() => onOpen(article.id)}><AccessIcon kind="continue" />Continuar</button><button className="recent-action delete" type="button" onClick={() => { setDeleteError(""); setDeleteTarget(article); }}><AccessIcon kind="delete" />Eliminar</button></div>
          </article>)}</div>}
        </section>
      </div>
      <p className="isolation-note">Derechos reservados, 2026. Reunión Científica-Tecnológica, Veracruz XXXVIII. Versión 0.10.1.</p>
      <dialog ref={deleteDialogRef} className="delete-work-dialog" aria-labelledby="delete-work-title" aria-describedby="delete-work-description" onCancel={(event) => { if (busy) event.preventDefault(); else setDeleteTarget(null); }} onClose={() => setDeleteTarget(null)} onClick={(event) => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}>
        {deleteTarget && <div className="delete-work-content">
          <div className="delete-work-heading"><span className="delete-work-symbol"><AccessIcon kind="delete" /></span><div><span className="eyebrow">Confirmar eliminación</span><h2 id="delete-work-title">¿Eliminar este trabajo?</h2></div></div>
          <div className="delete-work-details"><strong>{deleteTarget.title}</strong><RecentReference value={deleteTarget.publicReference} /></div>
          <p id="delete-work-description">Se borrarán este trabajo y todas sus versiones. <strong>No podrás recuperarlos después.</strong></p>
          {deleteError && <div className="alert error" role="alert">{deleteError}</div>}
          <div className="delete-work-actions"><button className="button delete-work-cancel" type="button" autoFocus disabled={busy} onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="button delete-work-confirm" type="button" disabled={busy} onClick={confirmDelete}><AccessIcon kind="delete" />{busy ? "Eliminando…" : "Sí, eliminar trabajo"}</button></div>
        </div>}
      </dialog>
    </main>
  );
}

function PublicApp() {
  const [articles, setArticles] = useState([]);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get("article"));
  const [article, setArticle] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [limits, setLimits] = useState(defaultLimits);
  const [saveState, setSaveState] = useState({ kind: "saved", label: "Guardado ✓" });
  const [editorState, setEditorState] = useState({ status: "checking", message: "Preparando vista previa" });
  const [accessPayload, setAccessPayload] = useState(null);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get("recovery") === "failed" ? "No fue posible recuperar el trabajo." : "");
  const [busy, setBusy] = useState(false);
  const [validationRequested, setValidationRequested] = useState(false);
  const [attentionKey, setAttentionKey] = useState(0);
  const firstMetadata = useRef(true);
  const saveTimer = useRef(null);
  const saveInFlight = useRef(null);
  const jumpTimer = useRef(null);
  const jumpField = useRef(null);
  const refreshList = useCallback(() => api("/api/lab/articles").then(setArticles), []);
  const openArticle = useCallback((id) => { const url = new URL(window.location.href); url.searchParams.set("article", id); url.searchParams.delete("recovery"); window.history.pushState({}, "", url); setSelectedId(id); setAccessPayload(null); }, []);
  const goHome = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    try {
      if (saveInFlight.current) await saveInFlight.current;
      if (selectedId && metadata && saveState.kind !== "saved") await api(`/api/lab/articles/${selectedId}`, { method: "PATCH", body: JSON.stringify(metadata) });
      const url = new URL(window.location.href); url.search = ""; window.history.pushState({}, "", url);
      setSelectedId(null); setArticle(null); setMetadata(null); setError(""); refreshList();
    } catch (requestError) { setError(requestError.message); }
  }, [refreshList, selectedId, metadata, saveState.kind]);
  useEffect(() => {
    const warn = (event) => { if (saveState.kind !== "saved") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState.kind]);

  useEffect(() => { Promise.all([refreshList(), api("/api/lab/config").then((value) => setLimits(value.limits))]).catch((requestError) => setError(requestError.message)); }, [refreshList]);
  useEffect(() => { const pop = () => setSelectedId(new URLSearchParams(window.location.search).get("article")); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true; setError(""); setArticle(null);
    api(`/api/lab/articles/${selectedId}`).then((value) => { if (!active) return; setArticle(value); setMetadata({ title: value.title, mesa: value.mesa || null, authors: value.authors, keywords: value.keywords, introduction: value.introduction || "", blocks: value.blocks || [] }); setValidationRequested(false); setAttentionKey(0); firstMetadata.current = true; setEditorState({ status: value.generatedAt ? "checking" : "pending", message: "" }); }).catch((requestError) => { if (active) setError(requestError.message); });
    return () => { active = false; };
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId) return undefined;
    const interval = window.setInterval(() => { api(`/api/lab/articles/${selectedId}`).then((value) => setArticle((current) => current ? { ...current, ...value, title: current.title, authors: current.authors, keywords: current.keywords } : value)).catch(() => undefined); }, 8000);
    return () => window.clearInterval(interval);
  }, [selectedId]);
  const metadataSignature = useMemo(() => metadata ? JSON.stringify(metadata) : "", [metadata]);
  const issues = useMemo(() => generationIssues(metadata, limits), [metadata, limits]);
  const visibleIssues = validationRequested ? issues : [];
  const goToIssue = (issue) => {
    const target = document.getElementById(issue.target);
    if (!target) return;
    let field = (issue.target === "keywords-list" ? document.querySelector(".keyword-entry input")
      : issue.target === "authors-list" ? target.querySelector(".author-card.has-issues input") || target.querySelector("input")
        : issue.target === "article-mesa" ? target.querySelector('input[type="radio"]:checked') || target.querySelector('input[type="radio"]')
          : target.matches("input, textarea, button, math-field") ? target
            : target.querySelector('input[aria-invalid="true"], textarea[aria-invalid="true"], math-field[aria-invalid="true"]')
              || target.querySelector('textarea, input:not([type="hidden"]), math-field')
              || target.querySelector("button")) || target;
    if (jumpTimer.current) window.clearTimeout(jumpTimer.current);
    jumpField.current?.classList.remove("jump-focus-highlight");
    if (field.disabled) field = target;
    if (!field.matches("input, textarea, button, math-field, [tabindex]")) field.tabIndex = -1;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    field.classList.add("jump-focus-highlight");
    jumpField.current = field;
    jumpTimer.current = window.setTimeout(() => { field.classList.remove("jump-focus-highlight"); jumpTimer.current = null; }, 1800);
  };
  useEffect(() => {
    if (!metadata || !selectedId || !article) return undefined;
    if (firstMetadata.current) { firstMetadata.current = false; return undefined; }
    setSaveState({ kind: "saving", label: "Guardando…" });
    let active = true;
    saveTimer.current = window.setTimeout(() => {
      const request = (saveInFlight.current || Promise.resolve()).catch(() => undefined).then(() => api(`/api/lab/articles/${selectedId}`, { method: "PATCH", body: metadataSignature }));
      saveInFlight.current = request;
      request.then((value) => { if (!active) return; setArticle((current) => ({ ...current, ...value })); setSaveState({ kind: "saved", label: "Guardado ✓" }); }).catch((requestError) => { if (active) setSaveState({ kind: "error", label: requestError.details?.[0] || "Error al guardar" }); }).finally(() => { if (saveInFlight.current === request) saveInFlight.current = null; });
    }, 800);
    return () => { active = false; window.clearTimeout(saveTimer.current); };
  }, [article?.id, metadata, metadataSignature, selectedId]);

  const create = async () => { setBusy(true); setError(""); try { const created = await api("/api/lab/articles", { method: "POST", body: "{}" }); setAccessPayload(created); await refreshList(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  const recover = async (code) => { setBusy(true); setError(""); try { const recovered = await api("/api/lab/recover/code", { method: "POST", body: JSON.stringify({ code }) }); await refreshList(); openArticle(recovered.article.id); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); } };
  const remove = async (item) => { setBusy(true); try { await api(`/api/lab/articles/${item.id}`, { method: "DELETE" }); setArticles((current) => current.filter((article) => article.id !== item.id)); refreshList().catch((requestError) => setError(requestError.message)); return { ok: true }; } catch (requestError) { return { ok: false, error: requestError.message }; } finally { setBusy(false); } };
  const finalize = async () => { setBusy(true); setError(""); try { window.clearTimeout(saveTimer.current); if (saveInFlight.current) await saveInFlight.current; await api(`/api/lab/articles/${selectedId}`, { method: "PATCH", body: metadataSignature }); const value = await api(`/api/lab/articles/${selectedId}/finalize`, { method: "POST", body: "{}" }); setArticle(value); } catch (requestError) { setError([requestError.message, ...(requestError.details || [])].join(" ")); } finally { setBusy(false); } };
  const generate = async () => {
    setValidationRequested(true);
    setError("");
    if (issues.length) {
      setAttentionKey((current) => current + 1);
      window.requestAnimationFrame(() => document.querySelector(".document-summary")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
      return;
    }
    setBusy(true); setSaveState({ kind: "saving", label: "Preparando trabajo…" });
    window.clearTimeout(saveTimer.current);
    let contentSaved = false;
    try {
      if (saveInFlight.current) await saveInFlight.current.catch(() => undefined);
      const saved = await api(`/api/lab/articles/${selectedId}`, { method: "PATCH", body: metadataSignature });
      contentSaved = true;
      setArticle(saved);
      const generated = await api(`/api/lab/articles/${selectedId}/generate`, { method: "POST", body: "{}" });
      setArticle(generated); setEditorState({ status: "checking", message: "Preparando vista previa" }); setSaveState({ kind: "saved", label: "Guardado ✓" }); setValidationRequested(false);
    } catch (requestError) {
      setError([requestError.message, ...(requestError.details || [])].join(" "));
      setSaveState(contentSaved ? { kind: "saved", label: "Guardado ✓" } : { kind: "error", label: "No se pudieron guardar los cambios" });
      window.requestAnimationFrame(() => document.querySelector(".summary-operation-error")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    } finally { setBusy(false); }
  };

  if (accessPayload) return <RecoveryAccess payload={accessPayload} onContinue={openArticle} onClose={() => setAccessPayload(null)} />;
  if (!selectedId) return <PublicHome articles={articles} limits={limits} busy={busy} onCreate={create} onOpen={openArticle} onDelete={remove} onRecover={recover} error={error} />;
  if (!article || !metadata) return <div className="page-loader"><span className="spinner" /> Cargando trabajo…{error && <><div className="alert error">{error}</div><button className="button secondary" onClick={goHome}>Volver al inicio</button></>}</div>;
  const canGenerate = issues.length === 0;
  const canFinalize = canGenerate && article.generatedAt && article.pageCount >= limits.minPages && article.pageCount <= limits.maxPages && saveState.kind === "saved";
  return (
    <main className="shell editor-shell">
      <header className="hero editor-hero">
        <div className="editor-hero-copy">
          <div className="editor-hero-context"><span className="lab-badge">EDITA TU TRABAJO</span><span className={`status ${article.status}`}>{statusLabel(article.status)}</span></div>
          <h1>Prepara tu resumen científico</h1>
          <p>Clave de tu trabajo: {article.publicReference?.startsWith("RCT-") ? (
            <strong className="editor-work-reference" onCopy={(event) => { event.preventDefault(); event.clipboardData.setData("text/plain", article.publicReference.slice(4).replace("-", "")); }}>
              <span className="reference-prefix">RCT-</span><span>{article.publicReference.slice(4, 8)}</span><span className="reference-separator">-</span><span>{article.publicReference.slice(9)}</span>
            </strong>
          ) : <strong>Sin clave</strong>}</p>
        </div>
        <div className="hero-actions">
          <button className="button ghost editor-return" type="button" disabled={busy} onClick={goHome}><AccessIcon kind="back" />Volver a todos mis trabajos</button>
          <button className="button generate-work" type="button" disabled={busy} onClick={generate}><AccessIcon kind="document" />{busy ? "Generando…" : "Generar trabajo"}</button>
          <button className="button finalize-work" type="button" disabled={!canFinalize || busy} onClick={finalize}><AccessIcon kind="check" />Finalizar Trabajo</button>
        </div>
      </header>
      <div className="workspace-grid"><div className="builder-column"><MetadataForm metadata={metadata} setMetadata={setMetadata} limits={limits} saveState={saveState} issues={visibleIssues.filter((issue) => issue.section === "Información del trabajo")} /><BlockEditor articleId={article.id} introduction={metadata.introduction} onIntroductionChange={(introduction) => setMetadata((current) => ({ ...current, introduction }))} blocks={metadata.blocks} onChange={(blocks) => setMetadata((current) => ({ ...current, blocks }))} limits={limits} disabled={busy} issues={visibleIssues} /></div><DiagnosticPanel article={article} metadata={metadata} limits={limits} saveState={saveState} requirements={issues} attentionKey={attentionKey} operationError={error || (saveState.kind === "error" ? saveState.label : "")} onIssueClick={goToIssue} onGenerate={generate} onFinalize={finalize} canFinalize={canFinalize} busy={busy} /></div>
      {article.generatedAt ? <section className="document-card card">
        <div className="document-heading"><div><span className="eyebrow">Vista previa sin edición</span><h2>Trabajo generado</h2></div><div className="word-counter"><strong className={article.pageCount !== null && (article.pageCount < limits.minPages || article.pageCount > limits.maxPages) ? "limit" : ""}>{article.pageCount ?? "…"} / {limits.minPages}–{limits.maxPages}</strong><span>páginas</span></div></div>
        <div className="count-notice">Puedes seleccionar y copiar el texto de esta vista. Para hacer cambios, modifica las secciones y vuelve a generar el trabajo.</div>
        <div className="editor-frame"><iframe key={article.previewKey || article.documentKey} title="Vista previa del trabajo con texto seleccionable" src={`/api/lab/articles/${article.id}/preview.pdf#view=FitH&navpanes=0`} onLoad={() => setEditorState({ status: "connected", message: "Vista previa lista" })} /></div>
        <footer className="editor-footer"><span className={editorState.status === "error" ? "bad" : "ok"}>●</span> Vista previa: {editorState.status === "connected" ? "Lista" : editorState.status === "error" ? "No disponible" : "Preparando…"}<span className="footer-divider" />{article.pageCount === null ? "Comprobando páginas…" : article.pageCount < limits.minPages ? `Agrega contenido hasta completar ${limits.minPages} páginas` : article.pageCount > limits.maxPages ? `Reduce el contenido a ${limits.maxPages} páginas` : `Cumple con la extensión de ${limits.minPages} a ${limits.maxPages} páginas`}</footer>
      </section> : <section className="card generation-placeholder"><span className="generation-icon">▤</span><div><span className="eyebrow">Trabajo pendiente de generar</span><h2>Genera la vista final cuando estés listo</h2><p>{canGenerate ? `Se aplicará el formato obligatorio y se comprobará que el trabajo tenga entre ${limits.minPages} y ${limits.maxPages} páginas.` : "Completa las secciones obligatorias y las descripciones para generar el trabajo."}</p></div><button className="button generate-work" type="button" disabled={busy} onClick={generate}>Generar trabajo</button></section>}
    </main>
  );
}

export default function App() {
  if (window.location.pathname === "/admin/vista" || window.location.pathname === "/admin/vista/") return <Suspense fallback={<div className="page-loader"><span className="spinner" /> Cargando…</div>}><AdminDashboard /></Suspense>;
  if (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) return <Suspense fallback={<div className="page-loader"><span className="spinner" /> Cargando…</div>}><AdminPanel /></Suspense>;
  return <PublicApp />;
}
