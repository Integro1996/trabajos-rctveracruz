import { referenceText } from "../flow.js";

const SECTIONS = ["Introducción", "Objetivos", "Materiales y métodos", "Resultados y discusión", "Conclusiones", "Referencias bibliográficas"];

function saveSummary(saveState) {
  if (saveState.kind === "saving") return { label: "Guardando…", className: "saving" };
  if (saveState.kind === "error") return { label: "Error", className: "error" };
  return { label: "Guardado", className: "saved" };
}

export default function DiagnosticPanel({ article, metadata, limits, saveState, requirements = [], attentionKey = 0, operationError = "", onIssueClick, onGenerate, onFinalize, canFinalize, busy }) {
  const saved = saveSummary(saveState);
  const pageCount = article.pageCount;
  const underLimit = pageCount !== null && pageCount < limits.minPages;
  const overLimit = pageCount !== null && pageCount > limits.maxPages;
  const outsideRange = underLimit || overLimit;
  const authors = metadata.authors || [];
  const keywords = metadata.keywords || [];
  const references = (metadata.blocks || []).filter((block) => block.type === "text" && block.heading === "Referencias bibliográficas" && referenceText(block).trim()).length;
  const metadataIssue = (target) => requirements.some((issue) => issue.section === "Información del trabajo" && issue.target?.startsWith(target));
  const rows = [
    { label: "Mesa", target: "article-mesa", complete: Boolean(metadata.mesa) && !metadataIssue("article-mesa") },
    { label: "Título", target: "article-title", complete: Boolean(metadata.title?.trim()) && !metadataIssue("article-title") },
    { label: "Autores", target: "authors-list", value: authors.length, complete: authors.length >= limits.authorsMin && authors.length <= (limits.authorsMax ?? 30) && !requirements.some((issue) => issue.id.startsWith("author")) },
    { label: "Palabras clave", target: "keywords-list", value: `${keywords.length} de ${limits.keywords}`, complete: keywords.length > 0 && keywords.length <= limits.keywords && !requirements.some((issue) => issue.id.startsWith("keywords")) },
    ...SECTIONS.map((section) => {
      const issue = requirements.find((item) => item.section === section);
      return { label: section, target: issue?.target || `section-${section}`, value: section === "Referencias bibliográficas" ? references : null, complete: !issue };
    }),
  ];

  return (
    <aside className="document-summary card">
      <div className="section-heading"><div><span className="eyebrow">Avance del trabajo</span><h2>Estado General del Trabajo</h2></div></div>
      <p className="summary-intro">Consulta tu avance. Completa lo marcado en rojo para poder generar el trabajo.</p>

      {operationError && <div className="summary-operation-error" role="alert"><strong>No se pudo completar la operación.</strong><p>{operationError}</p></div>}

      <div className="summary-save-row"><span>Estado de guardado</span><strong className={`save-indicator ${saved.className}`} role="status" aria-live="polite">{saved.label}</strong></div>
      <div className="summary-checklist" aria-label="Requisitos del trabajo">
        {rows.map((row) => <button key={`${row.label}-${attentionKey}`} type="button" className={`summary-check-row ${row.complete ? "complete" : "incomplete"}${!row.complete && attentionKey ? " attention" : ""}`} onClick={() => onIssueClick({ target: row.target })}>
          <span className="summary-check-label">{row.label}</span>
          <span className="summary-check-result">{row.value !== null && row.value !== undefined && <span>{row.value}</span>}<span className="summary-check-icon" aria-label={row.complete ? "Completo" : "Pendiente"}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{row.complete ? <path d="m4 10 4 4 8-8" /> : <path d="M5 5 15 15M15 5 5 15" />}</svg></span></span>
        </button>)}
      </div>

      <div className="word-progress-heading">
        <span>Número de páginas</span>
        <strong className={outsideRange ? "bad" : pageCount === null ? "" : "ok"}>{pageCount === null ? "Pendiente" : `${pageCount} ${pageCount === 1 ? "página" : "páginas"}`}</strong>
      </div>
      <div className="page-meter" aria-label={`Entre ${limits.minPages} y ${limits.maxPages} páginas`}>
        {Array.from({ length: limits.maxPages }, (_, index) => index + 1).map((page) => <span key={page} className={pageCount !== null && page <= pageCount ? outsideRange ? "over-limit" : "filled" : ""}>{page}</span>)}
      </div>
      <p className={outsideRange ? "summary-guidance bad" : "summary-guidance"}>
        {pageCount === null
          ? `El trabajo debe tener entre ${limits.minPages} y ${limits.maxPages} páginas para poder finalizar. Genera el trabajo para comprobarlo.`
          : underLimit
            ? `El trabajo debe tener al menos ${limits.minPages} páginas para poder finalizar.`
            : overLimit
              ? `El trabajo debe tener como máximo ${limits.maxPages} páginas para poder finalizar.`
              : `El trabajo cumple con el requisito de ${limits.minPages} a ${limits.maxPages} páginas.`}
      </p>
      <div className="summary-actions">
        <button className="button generate-work" type="button" disabled={busy} onClick={onGenerate}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h4M8 12h6M8 16h7" /></svg>Generar</button>
        <button className="button finalize-work" type="button" disabled={!canFinalize || busy} onClick={onFinalize}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12.5 9 17l11-11" /></svg>Finalizar</button>
      </div>
    </aside>
  );
}
