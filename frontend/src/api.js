export async function api(path, options = {}) {
  const cookies = Object.fromEntries(document.cookie.split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
  }));
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(cookies.trabajos_csrf ? { "x-trabajos-csrf": cookies.trabajos_csrf } : {}),
      ...(cookies.trabajos_admin_csrf ? { "x-admin-csrf": cookies.trabajos_admin_csrf } : {}),
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `La API respondió ${response.status}.`);
    error.details = payload.details || [];
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function downloadApi(path, filename) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "No fue posible descargar el documento.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
