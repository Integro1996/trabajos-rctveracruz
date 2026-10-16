import { useState } from "react";
import { MESAS } from "../mesas.js";

const blankAuthor = () => ({
  firstName: "",
  lastName: "",
  email: "",
  institution: "",
  orcid: "",
  isCorresponding: false,
});

const words = (value) => value.trim() ? value.trim().split(/\s+/u).length : 0;

export default function MetadataForm({ metadata, setMetadata, limits, saveState, issues = [] }) {
  const [keywordInput, setKeywordInput] = useState("");
  const titleWords = words(metadata.title);
  const titleChars = [...metadata.title].length;
  const titleInvalid = titleWords > limits.titleWords || titleChars > limits.titleCharacters;
  const keywordIssue = issues.find((issue) => issue.target === "keywords-list");
  const otherIssues = issues.filter((issue) => issue.target !== "keywords-list");

  const updateAuthor = (index, field, value) => {
    setMetadata((current) => ({
      ...current,
      authors: current.authors.map((author, itemIndex) => {
        if (field === "isCorresponding" && value) return { ...author, isCorresponding: itemIndex === index };
        return itemIndex === index ? { ...author, [field]: value } : author;
      }),
    }));
  };

  const moveAuthor = (from, to) => {
    if (to < 0 || to >= metadata.authors.length) return;
    const authors = [...metadata.authors];
    const [moved] = authors.splice(from, 1);
    authors.splice(to, 0, moved);
    setMetadata((current) => ({ ...current, authors }));
  };

  const removeAuthor = (index) => {
    setMetadata((current) => {
      const authors = current.authors.filter((_, itemIndex) => itemIndex !== index);
      if (authors.length && !authors.some((author) => author.isCorresponding)) {
        authors[0] = { ...authors[0], isCorresponding: true };
      }
      return { ...current, authors };
    });
  };

  const addKeywords = () => {
    const incoming = keywordInput.split(",").map((item) => item.trim()).filter(Boolean);
    if (!incoming.length) return;
    const existing = new Set(metadata.keywords.map((item) => item.toLocaleLowerCase("es-MX")));
    const next = [...metadata.keywords];
    for (const item of incoming) {
      const key = item.toLocaleLowerCase("es-MX");
      if (!existing.has(key) && next.length < limits.keywords) {
        existing.add(key);
        next.push(item);
      }
    }
    setMetadata((current) => ({ ...current, keywords: next }));
    setKeywordInput("");
  };

  return (
    <section id="section-Información del trabajo" className={"metadata card" + (issues.length ? " has-issues" : "")} aria-labelledby="metadata-title" aria-describedby="metadata-help">
      <header className="section-intro">
        <div className="section-heading">
          <div className="section-identity"><div><span className="eyebrow">Datos del trabajo</span><h2 id="metadata-title">Información del trabajo</h2></div></div>
          <span className={`save-state save-indicator ${saveState.kind}`} role="status" aria-live="polite">Estado: {saveState.label}</span>
        </div>
        <p id="metadata-help" className="section-help">Elige una mesa y completa el título, los autores, las palabras clave y las secciones de tu trabajo.</p>
      </header>

      {otherIssues.length > 0 && <ul className="section-issues">{otherIssues.map((issue) => <li key={issue.id}>{issue.message}</li>)}</ul>}

      <fieldset
        id="article-mesa"
        className={"mesa-fieldset" + (issues.some((issue) => issue.target === "article-mesa") ? " invalid" : "")}
        aria-describedby="mesa-help"
        aria-invalid={issues.some((issue) => issue.target === "article-mesa")}
      >
        <legend>Mesa</legend>
        <div className="mesa-options">
          {MESAS.map(({ code, name }) => (
            <label className={"mesa-option" + (metadata.mesa === code ? " selected" : "")} key={code}>
              <input
                type="radio"
                name="article-mesa"
                value={code}
                checked={metadata.mesa === code}
                onChange={() => setMetadata((current) => ({ ...current, mesa: code }))}
              />
              <span><strong>{code}</strong> {name}</span>
            </label>
          ))}
        </div>
        <p className="mesa-help" id="mesa-help">Elige una sola mesa. Aparecerá en tu trabajo.</p>
      </fieldset>

      <label className="field-label" htmlFor="article-title">Título</label>
      <input
        id="article-title"
        className={titleInvalid || issues.some((issue) => issue.target === "article-title") ? "invalid" : ""}
        aria-invalid={titleInvalid || issues.some((issue) => issue.target === "article-title")}
        value={metadata.title}
        onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))}
        aria-describedby="title-counts"
      />
      <div id="title-counts" className="counter-row">
        <span className={titleWords > limits.titleWords ? "limit" : ""}>{titleWords} / {limits.titleWords} palabras</span>
        <span className={titleChars > limits.titleCharacters ? "limit" : ""}>{titleChars} / {limits.titleCharacters} caracteres</span>
      </div>
      {titleWords > limits.titleWords && <p className="field-error">El título supera las {limits.titleWords} palabras; no se truncó.</p>}
      {titleChars > limits.titleCharacters && <p className="field-error">El título supera los {limits.titleCharacters} caracteres; no se truncó.</p>}

      <div className="authors-section">
        <div className="subsection-title"><div><span className="eyebrow">Orden de aparición</span><h3>Autores</h3></div><button className="button ghost small" type="button" disabled={metadata.authors.length >= (limits.authorsMax ?? 30)} onClick={() => setMetadata((current) => ({ ...current, authors: [...current.authors, blankAuthor()] }))}>+ Agregar autor</button></div>
        <div className="authors-list" id="authors-list">
          {metadata.authors.map((author, index) => (
          <article
            className={"author-card" + (author.isCorresponding ? " is-corresponding" : "") + (issues.some((issue) => issue.target === `author-${index}`) ? " has-issues" : "")}
            id={`author-${index}`}
            key={author.id || `new-${index}`}
          >
            <div className="author-card-head">
              <div className="author-card-identity"><strong>Autor {index + 1}</strong>{author.isCorresponding && <span className="corresponding-badge">Correspondencia</span>}</div>
              <div className="author-actions">
                <button type="button" title="Subir autor" onClick={() => moveAuthor(index, index - 1)} disabled={index === 0}>↑</button>
                <button type="button" title="Bajar autor" onClick={() => moveAuthor(index, index + 1)} disabled={index === metadata.authors.length - 1}>↓</button>
                <button type="button" className="danger-link" onClick={() => removeAuthor(index)} disabled={metadata.authors.length === 1}>Eliminar</button>
              </div>
            </div>
            <div className={`author-grid${author.isCorresponding ? "" : " without-email"}`}>
              <label><span>Nombre</span><input value={author.firstName} onChange={(event) => updateAuthor(index, "firstName", event.target.value)} /></label>
              <label><span>Apellidos</span><input value={author.lastName} onChange={(event) => updateAuthor(index, "lastName", event.target.value)} /></label>
              {author.isCorresponding && <label><span>Correo</span><input type="email" value={author.email} onChange={(event) => updateAuthor(index, "email", event.target.value)} /></label>}
              <label className="wide"><span>Institución</span><input value={author.institution} onChange={(event) => updateAuthor(index, "institution", event.target.value)} /></label>
            </div>
            <label className="check-label"><input type="radio" name="corresponding-author" checked={author.isCorresponding} onChange={() => updateAuthor(index, "isCorresponding", true)} /> Autor por correspondencia</label>
          </article>
          ))}
        </div>
      </div>

      <div className={"subsection-title keyword-heading" + (keywordIssue ? " invalid" : "")}><div><span className="eyebrow">Separadas por coma</span><h3>Palabras clave</h3></div><span className={metadata.keywords.length >= limits.keywords || keywordIssue ? "limit" : ""}>{metadata.keywords.length} / {limits.keywords}</span></div>
      <div className="keyword-entry">
        <input
          className={keywordIssue ? "invalid" : ""}
          aria-label="Palabras clave"
          aria-invalid={Boolean(keywordIssue)}
          aria-describedby={keywordIssue ? "keywords-error" : "keywords-help"}
          placeholder="frutales, Algas verdes"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addKeywords();
            }
          }}
          onBlur={addKeywords}
          disabled={metadata.keywords.length >= limits.keywords}
        />
      </div>
      {keywordIssue && <p className="field-error" id="keywords-error" role="alert">{keywordIssue.message}</p>}
      <p className="keyword-help" id="keywords-help">Escribe una palabra y pulsa Enter, o separa varias con comas.</p>
      <div className="chips" id="keywords-list">
        {metadata.keywords.map((keyword, index) => (
          <button key={`${keyword}-${index}`} type="button" className="chip" onClick={() => setMetadata((current) => ({ ...current, keywords: current.keywords.filter((_, itemIndex) => itemIndex !== index) }))}>{keyword}<span aria-label="Eliminar">×</span></button>
        ))}
      </div>

    </section>
  );
}
