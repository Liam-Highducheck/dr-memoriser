// Progress storage. SQLite (in a worker, OPFS) when the browser can do it, localStorage when it cannot, and a
// memory-only mode when the database is locked by another open tab (so two tabs never write different histories).
const Store = (() => {
  let worker = null, seq = 0, mode = "starting", detail = "";
  const waiting = new Map();
  const LS = { progress: "drm-progress", attempts: "drm-attempts", settings: "drm-settings" };
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function call(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ id, op, args });
    });
  }

  async function open() {
    try {
      if (!("Worker" in window) || !navigator.storage || !navigator.storage.getDirectory) throw new Error("no OPFS");
      worker = new Worker("lib/db-worker.js", { type: "module" });
      worker.onmessage = (ev) => {
        const w = waiting.get(ev.data.id);
        if (!w) return;
        waiting.delete(ev.data.id);
        ev.data.ok ? w.resolve(ev.data.v) : w.reject(new Error(ev.data.e));
      };
      worker.onerror = (ev) => { for (const w of waiting.values()) w.reject(new Error(ev.message || "worker error")); waiting.clear(); };
      const info = await Promise.race([call("open"), new Promise((_, rej) => setTimeout(() => rej(new Error("SQLite start timed out")), 15000))]);
      mode = "sqlite"; detail = `SQLite ${info.version}`;
    } catch (e) {
      try { worker && worker.terminate(); } catch {}
      worker = null;
      const msg = String((e && e.message) || e);
      if (/lock|access handle|NoModificationAllowed/i.test(msg)) { mode = "locked"; detail = "The database is open in another tab"; }
      else { mode = "local"; detail = msg; }
    }
    if (mode === "sqlite" && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return { mode, detail };
  }

  const api = {
    open,
    get mode() { return mode; },
    get detail() { return detail; },
    async load() {
      if (mode === "sqlite") {
        const { progress, settings } = await call("all");
        const p = {}; for (const r of progress) p[r.id] = r;
        const s = {}; for (const [k, v] of Object.entries(settings)) { try { s[k] = JSON.parse(v); } catch {} }
        return { progress: p, settings: s };
      }
      if (mode === "local") return { progress: lsGet(LS.progress, {}), settings: lsGet(LS.settings, {}) };
      return { progress: {}, settings: {} };
    },
    async recent(limit = 60) {
      if (mode === "sqlite") return call("recent", { limit });
      if (mode === "local") return lsGet(LS.attempts, []).slice(-limit).reverse();
      return [];
    },
    async record(progress, attempt) {
      if (mode === "sqlite") return call("record", { progress, attempt });
      if (mode === "local") {
        const p = lsGet(LS.progress, {}); p[progress.id] = progress; lsSet(LS.progress, p);
        const a = lsGet(LS.attempts, []); a.push(attempt); lsSet(LS.attempts, a.slice(-500));
      }
    },
    async forget(ids) {
      if (mode === "sqlite") return call("forget", { ids });
      if (mode === "local") { const p = lsGet(LS.progress, {}); for (const id of ids) delete p[id]; lsSet(LS.progress, p); }
    },
    async setting(k, v) {
      if (mode === "sqlite") return call("setting", { k, v: JSON.stringify(v) });
      if (mode === "local") { const s = lsGet(LS.settings, {}); s[k] = v; lsSet(LS.settings, s); }
    },
    async dump() {
      if (mode === "sqlite") return call("dump");
      if (mode === "local") return { progress: Object.values(lsGet(LS.progress, {})), attempts: lsGet(LS.attempts, []) };
      return { progress: [], attempts: [] };
    },
    async restore(data) {
      if (mode === "sqlite") return call("restore", data);
      if (mode === "local") {
        const p = lsGet(LS.progress, {}); for (const r of data.progress) p[r.id] = r; lsSet(LS.progress, p);
        const a = lsGet(LS.attempts, []); lsSet(LS.attempts, a.concat(data.attempts).sort((x, y) => x.ts - y.ts).slice(-500));
      }
    },
  };
  return api;
})();
