import { useCallback, useEffect, useState } from "react";
import { api, downloadApi } from "../api.js";
import DocumentWorkspace from "./DocumentWorkspace.jsx";
import { mesaName } from "../mesas.js";

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api("/api/lab/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }); onLogin(result.admin); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };
  return (
    <main className="admin-login-shell">
      <form className="card admin-login" onSubmit={submit}>
        <span className="admin-shield">A</span><span className="eyebrow">Acceso separado</span><h1>Administración</h1>
        <p>Autenticación exclusiva del laboratorio.</p>
        {error && <div className="alert error">{error}</div>}
        <label className="field-label" htmlFor="admin-email">Correo</label><input id="admin-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
        <label className="field-label" htmlFor="admin-password">Contraseña</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        <button className="button primary wide-button" type="submit" disabled={busy}>{busy ? "Verificando…" : "Entrar"}</button>
      </form>
    </main>
  );
}

function AdminPager({ pageIndex, totalPages, total, busy, onPage }) {
  if (totalPages < 2) return null;
  const pages = [...new Set([0, 1, pageIndex - 1, pageIndex, pageIndex + 1, totalPages - 2, totalPages - 1])]
    .filter((page) => page >= 0 && page < totalPages).sort((a, b) => a - b);
  return <nav className="admin-pager" aria-label="Páginas de trabajos"><span>{total} trabajos · Página {pageIndex + 1} de {totalPages}</span><div>
    <button type="button" disabled={busy || pageIndex === 0} onClick={() => onPage(pageIndex - 1)}>Anterior</button>
    {pages.map((page, index) => <span key={page}>{index > 0 && page > pages[index - 1] + 1 && <span aria-hidden="true">…</span>}<button type="button" className={page === pageIndex ? "is-current" : ""} aria-label={`Página ${page + 1}`} aria-current={page === pageIndex ? "page" : undefined} disabled={busy || page === pageIndex} onClick={() => onPage(page)}>{page + 1}</button></span>)}
    <button type="button" disabled={busy || pageIndex >= totalPages - 1} onClick={() => onPage(pageIndex + 1)}>Siguiente</button>
  </div></nav>;
}

export default function AdminPanel() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [results, setResults] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [query, setQuery] = useState("");
  const [searchDate, setSearchDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);

  const loadSearch = useCallback(async (q = "", date = "", status = "", page = 0) => {
    const result = await api(`/api/lab/admin/articles?q=${encodeURIComponent(q)}&date=${encodeURIComponent(date)}&status=${encodeURIComponent(status)}&page=${page + 1}&pageSize=10`);
    setResults(result.items); setPageIndex(result.page - 1); setTotalPages(result.totalPages); setTotalResults(result.total);
    return result.items;
  }, []);
  const loadAudit = useCallback(async () => setAuditRows(await api("/api/lab/admin/audit")), []);
  const loadDetail = useCallback(async (id) => { const value = await api(`/api/lab/admin/articles/${id}`); setDetail(value); return value; }, []);

  useEffect(() => { api("/api/lab/admin/session").then((value) => { setSession(value.authenticated ? value.admin : null); if (value.authenticated) return Promise.all([loadSearch(), loadAudit()]); return null; }).catch(() => setSession(null)).finally(() => setChecking(false)); }, [loadAudit, loadSearch]);
  const run = async (work) => { setBusy(true); setError(""); try { return await work(); } catch (requestError) { setError(requestError.message); return null; } finally { setBusy(false); } };
  const refresh = async () => { if (detail) await loadDetail(detail.article.id); await Promise.all([loadSearch(query, searchDate, statusFilter, pageIndex), loadAudit()]); };

  if (checking) return <div className="page-loader"><span className="spinner" /> Verificando sesión administrativa…</div>;
  if (!session) return <AdminLogin onLogin={(admin) => { setSession(admin); Promise.all([loadSearch(), loadAudit()]); }} />;

  const logout = () => run(async () => { await api("/api/lab/admin/logout", { method: "POST", body: "{}" }); setSession(null); setDetail(null); });
  const search = (event) => { event.preventDefault(); run(async () => { await loadSearch(query, searchDate, statusFilter, 0); setDetail(null); }); };
  const changePage = (page) => run(async () => { await loadSearch(query, searchDate, statusFilter, page); setDetail(null); });
  const revoke = () => run(async () => {
    if (!window.confirm("Todas las sesiones anónimas activas para este trabajo perderán acceso. ¿Continuar?")) return;
    await api(`/api/lab/admin/articles/${detail.article.id}/revoke-sessions`, { method: "POST", body: JSON.stringify({ reason: "Revocación administrativa confirmada" }) }); await refresh();
  });
  const restore = (version) => run(async () => {
    const reason = window.prompt(`Restaurar v${version} como una versión nueva. Motivo obligatorio:`);
    if (!reason) return;
    await api(`/api/lab/admin/articles/${detail.article.id}/versions/${version}/restore`, { method: "POST", body: JSON.stringify({ reason }) }); await refresh();
  });
  const emergency = () => run(async () => {
    const reason = window.prompt("Motivo obligatorio para habilitar edición administrativa:");
    if (!reason) return;
    const payload = await api(`/api/lab/admin/articles/${detail.article.id}/emergency-access`, { method: "POST", body: JSON.stringify({ reason }) });
    setEditor({ mode: "edit", payload });
  });

  if (editor && detail) return <main className="shell admin-shell">
    <header className="hero admin-hero"><div><button className="back-link" onClick={() => { setEditor(null); loadDetail(detail.article.id); }}>← Volver al detalle</button><span className="admin-badge">VISTA ADMINISTRATIVA</span><h1>{detail.article.publicReference || "Sin clave"}</h1><p>{editor.mode === "edit" ? "Edición excepcional auditada" : "Documento en modo de solo lectura"}</p></div></header>
    <section className="document-card card"><div className="editor-frame"><DocumentWorkspace articleId={detail.article.id} documentKey={detail.article.documentKey} configPath={editor.path} configPayload={editor.payload} onEditorState={() => undefined} /></div></section>
  </main>;

  return <main className="shell admin-shell">
    <header className="hero admin-hero"><div><span className="admin-badge">ADMINISTRACIÓN TOTAL · LAB</span><h1>Administración</h1><p>{session.name} · {session.email}</p></div><button className="button secondary" onClick={logout}>Cerrar sesión</button></header>
    {error && <div className="alert error">{error}</div>}
    <section className="card admin-search">
      <form className="search-form" onSubmit={search}><input aria-label="Buscar trabajo" placeholder="Título / referencia / autor / email / ID" value={query} onChange={(event) => setQuery(event.target.value)} /><input aria-label="Fecha" type="date" value={searchDate} onChange={(event) => setSearchDate(event.target.value)} /><select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option><option value="draft">Borradores</option><option value="requires_changes">Requieren cambios</option><option value="finalized">Finalizados</option></select><button className="button primary" disabled={busy}>Buscar</button></form>
      <AdminPager pageIndex={pageIndex} totalPages={totalPages} total={totalResults} busy={busy} onPage={changePage} />
      <div className="admin-results">{results.map((item) => <button className="admin-result" key={item.id} onClick={() => run(() => loadDetail(item.id))}><span><strong>{item.publicReference || "Sin clave"}</strong><b>{item.title}</b><small>{item.primaryAuthor || "Sin autor"} · {formatDate(item.updatedAt)}</small></span><span>v{item.version} →</span></button>)}</div>
      {!results.length && <p className="admin-no-results">No se encontraron trabajos.</p>}
      <AdminPager pageIndex={pageIndex} totalPages={totalPages} total={totalResults} busy={busy} onPage={changePage} />
    </section>

    {detail && <section className="card admin-detail">
      <div className="section-heading"><div><span className="eyebrow">Trabajo</span><h2>{detail.article.publicReference || "Sin clave"}</h2></div><span className={`status ${detail.article.status}`}>{detail.article.status}</span></div>
      <div className="admin-info-grid">
        <dl><dt>Título</dt><dd>{detail.article.title}</dd><dt>Mesa</dt><dd>{detail.article.mesa ? `${detail.article.mesa} — ${mesaName(detail.article.mesa)}` : "Sin seleccionar"}</dd><dt>Autor principal</dt><dd>{detail.article.authors[0]?.firstName} {detail.article.authors[0]?.lastName}</dd><dt>Autores</dt><dd>{detail.article.authors.map((author) => `${author.firstName} ${author.lastName}`).join(", ")}</dd><dt>Keywords</dt><dd>{detail.article.keywords.join(", ") || "—"}</dd><dt>ID interno</dt><dd>{detail.article.id}</dd></dl>
        <dl><dt>Documento / storage</dt><dd className={detail.document.available ? "ok" : "bad"}>{detail.document.available ? `Disponible ✓ · ${detail.document.bytes} bytes` : "No disponible"}</dd><dt>ONLYOFFICE</dt><dd className={detail.onlyofficeAvailable ? "ok" : "bad"}>{detail.onlyofficeAvailable ? "Disponible ✓" : "No disponible"}</dd><dt>Páginas</dt><dd className={detail.article.pageCount !== null && (detail.article.pageCount < 3 || detail.article.pageCount > 5) ? "bad" : ""}>{detail.article.pageCount ?? "Pendiente"} (3 a 5)</dd><dt>Figuras / cuadros</dt><dd>{detail.article.figureCount} / {detail.article.tableCount}</dd><dt>Última versión</dt><dd>v{detail.article.version}</dd><dt>Último guardado</dt><dd>{formatDate(detail.article.lastDocumentSavedAt)}</dd><dt>Sesiones activas</dt><dd>{detail.activeSessions}</dd><dt>Clave Proyecto</dt><dd>{detail.article.publicReference || "Sin clave"}</dd></dl>
      </div>
      <div className="admin-actions"><button className="button secondary" onClick={() => setEditor({ mode: "view", path: `/api/lab/admin/articles/${detail.article.id}/editor-config` })}>Abrir documento</button><button className="button secondary" onClick={emergency}>ACCESO DE EMERGENCIA</button><button className="button secondary" onClick={() => downloadApi(`/api/lab/admin/articles/${detail.article.id}/download`, `${detail.article.publicReference || detail.article.id}.docx`)}>Descargar DOCX</button><button className="button secondary danger-outline" onClick={revoke}>Revocar sesiones</button></div>
      <h3 className="admin-subtitle">Historial de versiones</h3><div className="version-list">{detail.versions.map((version, index) => <div key={version.version}><span><strong>v{version.version}</strong>{index === 0 && <em>Actual</em>}<small>{formatDate(version.createdAt)} · {version.wordCount} palabras · {version.pageCount ?? "?"} páginas</small></span><span><button onClick={() => downloadApi(`/api/lab/admin/articles/${detail.article.id}/versions/${version.version}/download`, `${detail.article.publicReference || detail.article.id}-v${version.version}.docx`)}>Descargar</button><button disabled={!version.restorable} title={version.restorable ? "" : "Versión antigua sin contenido estructurado"} onClick={() => restore(version.version)}>Restaurar</button></span></div>)}</div>
    </section>}

    <section className="card audit-card"><div className="section-heading"><div><span className="eyebrow">Trazabilidad</span><h2>Auditoría reciente</h2></div><button className="button ghost small" onClick={loadAudit}>Actualizar</button></div><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Administrador</th><th>Acción</th><th>Trabajo</th><th>Motivo</th></tr></thead><tbody>{auditRows.map((row) => <tr key={row.id}><td>{formatDate(row.createdAt)}</td><td>{row.admin.email}</td><td><code>{row.action}</code></td><td>{row.publicReference || "—"}</td><td>{row.reason || "—"}</td></tr>)}</tbody></table></div></section>
  </main>;
}
