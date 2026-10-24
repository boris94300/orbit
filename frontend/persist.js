/* Render gratuit efface la base à chaque redémarrage : on garde une copie chiffrée du compte dans le navigateur et on la restaure en silence. */
(() => {
  const K = "orbit-backup", f0 = window.fetch.bind(window), J = { "Content-Type": "application/json" };
  const restore = () => {
    const b = localStorage.getItem(K);
    if (!b) return Promise.resolve({});
    return f0("/api/auth/restore", { method: "POST", headers: J, body: JSON.stringify({ backup: b }) }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  };
  const save = () => f0("/api/auth/backup").then((r) => (r.ok ? r.json() : null)).then((d) => d && d.backup && localStorage.setItem(K, d.backup)).catch(() => {});
  let ready = restore();
  window.fetch = async (u, o = {}) => {
    const url = typeof u === "string" ? u : u.url || "";
    if (!url.startsWith("/api/") || url.startsWith("/api/auth/restore") || url.startsWith("/api/auth/backup")) return f0(u, o);
    await ready;
    let r = await f0(u, o);
    if (r.status === 401 && !url.startsWith("/api/auth/")) {
      const d = await (ready = restore());
      if (d.status === "restored") r = await f0(u, o);
    }
    if (r.ok && (o.method || "GET").toUpperCase() !== "GET") save();
    return r;
  };
  ready.then((d) => {
    const nx = new URLSearchParams(location.search).get("next") || "/";
    if (d.status === "restored" && location.pathname === "/login") location.replace(/^\/(?!\/)/.test(nx) ? nx : "/");
    else save();
  });
})();
