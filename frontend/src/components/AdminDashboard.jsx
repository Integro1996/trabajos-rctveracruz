import { useCallback, useEffect, useState } from "react";
import { api, downloadApi } from "../api.js";
import { MESAS, mesaName } from "../mesas.js";
import "./admin-preview.css";

const newAuthor = () => ({ firstName: "", lastName: "", email: "", institution: "", orcid: "", isCorresponding: true });
const labels = { draft: "Borrador", finalized: "Finalizado", requires_changes: "Requiere cambios" };
const auditLabels = {
  CREATE_ARTICLE: "Se creó un trabajo", UPDATE_ARTICLE: "Se editaron los datos", DELETE_ARTICLE: "Se eliminó un trabajo",
  VIEW_ARTICLE: "Se consultó un trabajo", OPEN_DOCUMENT: "Se abrió un documento", DOWNLOAD_DOCUMENT: "Se descargó un documento", RESTORE_VERSION: "Se restauró una versión",
  GENERATE_RECOVERY: "Se regeneró un acceso", EMERGENCY_ACCESS: "Se abrió edición de emergencia", ADMIN_LOGIN: "Inicio de sesión",
};

function shortDate(value) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function activityDate(value) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

function Status({ value }) {
  return <span className={`admin-preview-status admin-preview-status--${value === "requires_changes" ? "changes" : value}`}><span aria-hidden="true" />{labels[value] || value}</span>;
}

function Pager({ pageIndex, totalPages, total, busy, onPage }) {
  if (totalPages < 2) return null;
  const pages = [...new Set([0, 1, pageIndex - 1, pageIndex, pageIndex + 1, totalPages - 2, totalPages - 1])]
    .filter((page) => page >= 0 && page < totalPages).sort((a, b) => a - b);
  return <nav className="admin-preview-pagination" aria-label="Páginas de trabajos">
    <span>{total} trabajos · Página {pageIndex + 1} de {totalPages}</span>
    <div><button type="button" disabled={busy || pageIndex === 0} onClick={() => onPage(pageIndex - 1)}>Anterior</button>
      {pages.map((page, index) => <span className="admin-preview-page-slot" key={page}>{index > 0 && page > pages[index - 1] + 1 && <span aria-hidden="true">…</span>}<button type="button" className={page === pageIndex ? "is-current" : ""} aria-label={`Página ${page + 1}`} aria-current={page === pageIndex ? "page" : undefined} disabled={busy || page === pageIndex} onClick={() => onPage(page)}>{page + 1}</button></span>)}
      <button type="button" disabled={busy || pageIndex >= totalPages - 1} onClick={() => onPage(pageIndex + 1)}>Siguiente</button></div>
  </nav>;
}

function AdminSignIn({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api("/api/lab/admin/login", { method: "POST", body: JSON.stringify({ email, password }) });
      onLogin(result.admin);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <main className="admin-login-shell"><form className="card admin-login" onSubmit={submit}>
    <span className="admin-shield">A</span><span className="eyebrow">Acceso administrativo</span><h1>Administración</h1>
    <p>Inicia sesión para consultar y administrar los trabajos.</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    <label className="field-label" htmlFor="dashboard-email">Correo</label><input id="dashboard-email" type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
    <label className="field-label" htmlFor="dashboard-password">Contraseña</label><input id="dashboard-password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
    <button className="button primary wide-button" type="submit" disabled={busy}>{busy ? "Verificando…" : "Entrar"}</button>
  </form></main>;
}

function ArticleForm({ article, busy, error, onSave, onClose }) {
  const [title, setTitle] = useState(article?.title || "");
  const [mesa, setMesa] = useState(article?.mesa || "");
  const [authors, setAuthors] = useState(article?.authors?.map((author) => ({ ...author, orcid: author.orcid || "" })) || [newAuthor()]);
  const [keywords, setKeywords] = useState(article?.keywords?.join(", ") || "");
  const editing = Boolean(article);
  const updateAuthor = (index, field, value) => setAuthors((current) => current.map((author, position) => {
    if (field === "isCorresponding") return { ...author, isCorresponding: position === index };
    return position === index ? { ...author, [field]: value } : author;
  }));
  const removeAuthor = (index) => setAuthors((current) => {
    const next = current.filter((_, position) => position !== index);
    if (next.length && !next.some((author) => author.isCorresponding)) next[0] = { ...next[0], isCorresponding: true };
    return next;
  });
  const submit = (event) => {
    event.preventDefault();
    onSave({ title, mesa: mesa || null, authors, keywords: keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean), ...(editing ? { updatedAt: article.updatedAt } : {}) });
  };
  return <div className="admin-preview-modal-backdrop"><section className="admin-preview-modal" role="dialog" aria-modal="true" aria-labelledby="admin-article-form-title">
    <div className="admin-preview-modal-head"><div><span className="admin-preview-eyebrow">{editing ? article.publicReference || "Sin clave" : "Nuevo registro"}</span><h2 id="admin-article-form-title">{editing ? "Editar datos del trabajo" : "Crear trabajo"}</h2></div><button type="button" className="admin-preview-close" onClick={onClose} aria-label="Cerrar">×</button></div>
    <form onSubmit={submit} className="admin-preview-form">
      {error && <div className="alert error" role="alert">{error}</div>}
      <fieldset className="admin-preview-mesa"><legend>Mesa</legend><div className="admin-preview-mesa-options">
        {MESAS.map(({ code, name }) => <label className={"admin-preview-mesa-option" + (mesa === code ? " selected" : "")} key={code}>
          <input type="radio" name="admin-article-mesa" value={code} checked={mesa === code} onChange={() => setMesa(code)} />
          <span><strong>{code}</strong> {name}</span>
        </label>)}
      </div></fieldset>
      <label><span>Título del trabajo</span><input required maxLength="130" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <div className="admin-preview-form-section"><h3>Autores</h3><button type="button" className="admin-preview-text-button" onClick={() => setAuthors((current) => [...current, { ...newAuthor(), isCorresponding: false }])}>+ Agregar autor</button></div>
      {authors.map((author, index) => <div className="admin-preview-author" key={author.id || index}>
        <div className="admin-preview-author-head"><strong>Autor {index + 1}{index === 0 ? " · principal" : ""}</strong>{authors.length > 1 && <button type="button" className="admin-preview-text-button admin-preview-danger" onClick={() => removeAuthor(index)}>Quitar</button>}</div>
        <div className="admin-preview-form-grid"><label><span>Nombre</span><input required value={author.firstName} onChange={(event) => updateAuthor(index, "firstName", event.target.value)} /></label><label><span>Apellidos</span><input required value={author.lastName} onChange={(event) => updateAuthor(index, "lastName", event.target.value)} /></label></div>
        <label><span>Institución</span><input required value={author.institution} onChange={(event) => updateAuthor(index, "institution", event.target.value)} /></label>
        {author.isCorresponding && <label><span>Correo del autor correspondiente</span><input required type="email" value={author.email} onChange={(event) => updateAuthor(index, "email", event.target.value)} /></label>}
        <label className="admin-preview-radio"><input type="radio" name="admin-corresponding" checked={author.isCorresponding} onChange={() => updateAuthor(index, "isCorresponding", true)} /> Autor correspondiente</label>
      </div>)}
      <label><span>Palabras clave <small>(máximo 5, separadas por comas)</small></span><input value={keywords} onChange={(event) => setKeywords(event.target.value)} /></label>
      {editing && <p className="admin-preview-form-note">Esta edición conserva las secciones, figuras, cuadros y fórmulas. Si el documento estaba finalizado, tendrás que generarlo de nuevo para reflejar los cambios.</p>}
      <div className="admin-preview-modal-actions"><button className="admin-preview-button secondary" type="button" onClick={onClose}>Cancelar</button><button className="admin-preview-button primary" type="submit" disabled={busy}>{busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear trabajo"}</button></div>
    </form>
  </section></div>;
}

function DeleteDialog({ article, busy, error, onDelete, onClose }) {
  const [confirmation, setConfirmation] = useState("");
  const key = article.publicReference || article.id;
  return <div className="admin-preview-modal-backdrop"><section className="admin-preview-modal admin-preview-confirm" role="dialog" aria-modal="true" aria-labelledby="admin-delete-title">
    <div className="admin-preview-modal-head"><div><span className="admin-preview-eyebrow">Eliminar trabajo</span><h2 id="admin-delete-title">{article.publicReference || "Sin clave"}</h2></div><button type="button" className="admin-preview-close" onClick={onClose} aria-label="Cerrar">×</button></div>
    <p>Se eliminarán el trabajo, sus versiones y sus archivos. Escribe <strong>{key}</strong> para confirmar.</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    <label className="admin-preview-confirm-label"><span>{article.publicReference ? "Clave Proyecto" : "ID del trabajo"}</span><input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
    <div className="admin-preview-modal-actions"><button className="admin-preview-button secondary" type="button" onClick={onClose}>Cancelar</button><button className="admin-preview-button danger" type="button" disabled={busy || confirmation !== key} onClick={() => onDelete(confirmation)}>{busy ? "Eliminando…" : "Eliminar trabajo"}</button></div>
  </section></div>;
}

function ProjectKeyDialog({ value, onClose }) {
  return <div className="admin-preview-modal-backdrop"><section className="admin-preview-modal admin-preview-confirm" role="dialog" aria-modal="true" aria-labelledby="admin-project-key-title">
    <span className="admin-preview-eyebrow">Clave Proyecto</span><h2 id="admin-project-key-title">Trabajo {value.article.publicReference} creado</h2>
    <p>Comparte esta clave con el autor para que pueda abrir el trabajo.</p>
    <div className="admin-preview-secret"><span>Clave Proyecto</span><strong>{value.article.publicReference}</strong></div>
    <div className="admin-preview-modal-actions"><button className="admin-preview-button secondary" type="button" onClick={() => navigator.clipboard.writeText(value.article.publicReference)}>Copiar Clave Proyecto</button><button className="admin-preview-button primary" type="button" onClick={onClose}>Continuar</button></div>
  </section></div>;
}

export default function AdminDashboard() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [results, setResults] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({ total: 0, drafts: 0, finalized: 0, requiresChanges: 0 });
  const [auditRows, setAuditRows] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);

  const loadDashboard = useCallback(async (search = "", status = "", requestedPage = 0) => {
    const [summaryValue, articlePage, audit] = await Promise.all([
      api("/api/lab/admin/summary"),
      api(`/api/lab/admin/articles?q=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}&page=${requestedPage + 1}&pageSize=10`),
      api("/api/lab/admin/audit"),
    ]);
    setSummary(summaryValue); setResults(articlePage.items); setAuditRows(audit);
    setTotalResults(articlePage.total); setTotalPages(articlePage.totalPages); setPageIndex(articlePage.page - 1);
    return articlePage.items;
  }, []);
  const openDetail = useCallback(async (id) => {
    const value = await api(`/api/lab/admin/articles/${id}`);
    setDetail(value); return value;
  }, []);

  useEffect(() => {
    api("/api/lab/admin/session").then((value) => setSession(value.authenticated ? value.admin : null))
      .catch(() => setSession(null)).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    loadDashboard().then((rows) => rows[0] ? openDetail(rows[0].id) : null)
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, loadDashboard, openDetail]);

  const run = async (work) => {
    setBusy(true); setError("");
    try { await work(); }
    catch (failure) { if (failure.status === 401) setSession(null); else setError([failure.message, ...(failure.details || [])].join(" ")); }
    finally { setBusy(false); }
  };
  const search = (event) => { event.preventDefault(); run(async () => { const rows = await loadDashboard(query, statusFilter, 0); if (rows[0]) await openDetail(rows[0].id); else setDetail(null); }); };
  const changePage = (page) => run(async () => { const rows = await loadDashboard(query, statusFilter, page); if (rows[0]) await openDetail(rows[0].id); else setDetail(null); });
  const save = (data) => run(async () => {
    if (form?.article) {
      const updated = await api(`/api/lab/admin/articles/${form.article.id}`, { method: "PATCH", body: JSON.stringify(data) });
      setForm(null); await loadDashboard(query, statusFilter, pageIndex); await openDetail(updated.id);
    } else {
      const created = await api("/api/lab/admin/articles", { method: "POST", body: JSON.stringify(data) });
      setForm(null); setCreatedProject(created); setQuery(""); setStatusFilter(""); await loadDashboard("", "", 0); await openDetail(created.article.id);
    }
  });
  const remove = (confirmReference) => run(async () => {
    await api(`/api/lab/admin/articles/${detail.article.id}`, { method: "DELETE", body: JSON.stringify({ confirmReference }) });
    setDeleting(false); setDetail(null);
    const rows = await loadDashboard(query, statusFilter, pageIndex);
    if (rows[0]) await openDetail(rows[0].id);
  });
  const logout = () => run(async () => { await api("/api/lab/admin/logout", { method: "POST", body: "{}" }); setSession(null); setDetail(null); });

  if (checking) return <div className="page-loader"><span className="spinner" /> Verificando acceso administrativo…</div>;
  if (!session) return <AdminSignIn onLogin={setSession} />;

  const article = detail?.article;
  const stats = [
    ["Trabajos registrados", summary.total, "En el evento"], ["Borradores", summary.drafts, "Aún sin finalizar"],
    ["Finalizados", summary.finalized, "Documentos completos"], ["Requieren cambios", summary.requiresChanges, "Con observaciones"],
  ];
  return <main className="admin-preview">
    <aside className="admin-preview-sidebar" aria-label="Navegación administrativa">
      <div className="admin-preview-brand"><span className="admin-preview-brand-mark" aria-hidden="true">R</span><span><strong>RCT Veracruz</strong><small>Administración</small></span></div>
      <div className="admin-preview-sidebar-label">ESPACIO DE TRABAJO</div>
      <nav className="admin-preview-nav"><a className="admin-preview-nav-item is-current" href="#resumen"><span>▦</span> Resumen</a><a className="admin-preview-nav-item" href="#trabajos"><span>▤</span> Trabajos</a><a className="admin-preview-nav-item" href="#actividad"><span>◷</span> Actividad</a></nav>
      <div className="admin-preview-sidebar-foot"><span className="admin-preview-avatar">AD</span><span><strong>{session.name}</strong><small>{session.email}</small></span></div>
    </aside>
    <div className="admin-preview-content" id="resumen">
      <div className="admin-preview-topline"><span>Administración <span aria-hidden="true">/</span> Resumen</span><button type="button" className="admin-preview-logout" onClick={logout} disabled={busy}>Cerrar sesión</button></div>
      <header className="admin-preview-heading"><div><span className="admin-preview-eyebrow">Panel de administración</span><h1>Vista general</h1><p>Consulta y administra los trabajos registrados.</p></div><button type="button" className="admin-preview-button primary" onClick={() => { setError(""); setForm({ article: null }); }}>+ Crear trabajo</button></header>
      {error && !form && !deleting && <div className="alert error" role="alert">{error}</div>}
      <section className="admin-preview-stats" aria-label="Indicadores de trabajos">{stats.map(([label, value, hint]) => <div className="admin-preview-stat" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</section>
      <div className="admin-preview-main-grid">
        <section className="admin-preview-card admin-preview-work" id="trabajos">
          <div className="admin-preview-card-heading"><div><span className="admin-preview-eyebrow">Seguimiento</span><h2>Trabajos recientes</h2><p>Busca y abre un trabajo para revisar sus datos.</p></div><span className="admin-preview-count">{totalResults} resultados</span></div>
          <form className="admin-preview-search" onSubmit={search}><label className="visually-hidden" htmlFor="admin-dashboard-search">Buscar trabajo</label><input id="admin-dashboard-search" placeholder="Buscar por Clave Proyecto, título, autor o correo" value={query} onChange={(event) => setQuery(event.target.value)} /><label className="visually-hidden" htmlFor="admin-dashboard-status">Filtrar por estado</label><select id="admin-dashboard-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option><option value="draft">Borradores</option><option value="requires_changes">Requieren cambios</option><option value="finalized">Finalizados</option></select><button type="submit" disabled={busy}>Buscar</button></form>
          <Pager pageIndex={pageIndex} totalPages={totalPages} total={totalResults} busy={busy} onPage={changePage} />
          <div className="admin-preview-table-wrap"><table><thead><tr><th>Trabajo</th><th>Autor</th><th>Estado</th><th>Páginas</th><th>Actualización</th><th></th></tr></thead><tbody>{results.map((item) => <tr key={item.id} className={item.id === article?.id ? "is-selected" : ""}><td><span className="admin-preview-reference">{item.publicReference || "Sin clave"}</span><strong className="admin-preview-title">{item.title}</strong></td><td data-label="Autor">{item.primaryAuthor || "—"}</td><td data-label="Estado"><Status value={item.status} /></td><td data-label="Páginas" className="admin-preview-pages">{item.pageCount === null ? "—" : `${item.pageCount} (3 a 5)`}</td><td data-label="Actualización" className="admin-preview-updated">{shortDate(item.updatedAt)}</td><td data-label="Acción"><button type="button" className="admin-preview-text-button" onClick={() => run(() => openDetail(item.id))}>Ver</button></td></tr>)}</tbody></table>{!results.length && <p className="admin-preview-empty">{loading ? "Cargando trabajos…" : "No se encontraron trabajos."}</p>}</div>
          <Pager pageIndex={pageIndex} totalPages={totalPages} total={totalResults} busy={busy} onPage={changePage} />
        </section>
        <aside className="admin-preview-side-column">
          <section className="admin-preview-card admin-preview-detail" aria-label="Detalle del trabajo seleccionado">{article ? <>
            <span className="admin-preview-eyebrow">Detalle del trabajo</span><h2>{article.publicReference || "Sin clave"}</h2><Status value={article.status} />
            <p className="admin-preview-detail-title">{article.title}</p><dl><div><dt>Mesa</dt><dd>{article.mesa ? `${article.mesa} — ${mesaName(article.mesa)}` : "Sin seleccionar"}</dd></div><div><dt>Autor principal</dt><dd>{article.authors[0] ? `${article.authors[0].firstName} ${article.authors[0].lastName}` : "—"}</dd></div><div><dt>Autores</dt><dd>{article.authors.length}</dd></div><div><dt>Última versión</dt><dd>v{article.version}</dd></div><div><dt>Extensión</dt><dd>{article.pageCount === null ? "Pendiente" : `${article.pageCount} páginas (se requieren 3 a 5)`}</dd></div><div><dt>Figuras / cuadros</dt><dd>{article.figureCount} / {article.tableCount}</dd></div><div><dt>Palabras clave</dt><dd>{article.keywords.join(", ") || "—"}</dd></div></dl>
            <div className="admin-preview-detail-actions"><button className="admin-preview-button secondary" type="button" onClick={() => { setError(""); setForm({ article }); }}>Editar datos</button><button className="admin-preview-button secondary" type="button" onClick={() => run(() => downloadApi(`/api/lab/admin/articles/${article.id}/download`, `${article.publicReference || article.id}.docx`))}>Descargar DOCX</button><button className="admin-preview-button danger-outline" type="button" onClick={() => { setError(""); setDeleting(true); }}>Eliminar</button></div>
          </> : <><span className="admin-preview-eyebrow">Detalle del trabajo</span><h2>Selecciona un trabajo</h2><p className="admin-preview-detail-title">Abre uno de la lista para ver sus datos.</p></>}</section>
          <section className="admin-preview-card admin-preview-activity" id="actividad"><span className="admin-preview-eyebrow">Trazabilidad</span><h2>Actividad reciente</h2><div className="admin-preview-timeline">{auditRows.slice(0, 6).map((item) => <div className="admin-preview-timeline-item" key={item.id}><span className="admin-preview-timeline-mark">•</span><div><strong>{auditLabels[item.action] || item.action}</strong><span>{item.publicReference || "Administración"} · {activityDate(item.createdAt)}</span></div></div>)}{!auditRows.length && <p className="admin-preview-empty">Sin actividad reciente.</p>}</div></section>
        </aside>
      </div>
    </div>
    {form && <ArticleForm key={form.article?.id || "new"} article={form.article} busy={busy} error={error} onSave={save} onClose={() => { setForm(null); setError(""); }} />}
    {deleting && article && <DeleteDialog article={article} busy={busy} error={error} onDelete={remove} onClose={() => { setDeleting(false); setError(""); }} />}
    {createdProject && <ProjectKeyDialog value={createdProject} onClose={() => setCreatedProject(null)} />}
  </main>;
}
