import { useEffect, useState } from "react";
import { DocumentEditor } from "@onlyoffice/document-editor-react";
import { api } from "../api.js";

export default function DocumentWorkspace({ articleId, documentKey, onEditorState, configPath, configPayload, refreshBlocked = false, refreshSignal, refreshDelay = 0 }) {
  const [editor, setEditor] = useState({ state: "loading", payload: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (refreshBlocked) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoadError("");
      const request = configPayload ? Promise.resolve(configPayload) : api(configPath || `/api/lab/articles/${articleId}/editor-config`);
      request
      .then((payload) => {
        if (!active) return;
        onEditorState({ status: "checking", message: "Preparando vista previa" });
        setEditor({ state: "ready", payload, error: null });
      })
      .catch((error) => active && setEditor({ state: "error", payload: null, error: error.message }));
    }, refreshDelay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [articleId, documentKey, configPath, configPayload, attempt, refreshBlocked, refreshSignal, refreshDelay]);

  const reportError = (code, description) => {
    const message = `No se pudo cargar ONLYOFFICE (${code}). ${description || "Comprueba la conexión y vuelve a intentarlo."}`;
    setLoadError(message);
    onEditorState({ status: "error", message });
  };

  if (editor.state === "loading") {
    return <div className="editor-placeholder"><span className="spinner" /> Preparando vista previa…</div>;
  }
  if (editor.state === "error" || loadError) {
    return <div className="editor-error" role="alert"><strong>La vista previa no está disponible por el momento.</strong><span>{loadError || editor.error}</span><button className="button secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Reintentar vista previa</button></div>;
  }

  const serverUrl = new URL(editor.payload.documentServerUrl);
  const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (loopbackHosts.includes(serverUrl.hostname) && loopbackHosts.includes(window.location.hostname)) {
    serverUrl.hostname = window.location.hostname;
  }

  return (
    <DocumentEditor
      key={`${editor.payload.config.document.key}-${attempt}`}
      id={`onlyoffice-editor-${articleId}-${attempt}`}
      documentServerUrl={serverUrl.href}
      config={editor.payload.config}
      events_onDocumentReady={() => { setLoadError(""); onEditorState({ status: "connected", message: "Vista previa lista" }); }}
      events_onError={(event) => reportError(event?.data?.errorCode || "editor", event?.data?.errorDescription)}
      onLoadComponentError={reportError}
      height="100%"
      width="100%"
    />
  );
}
