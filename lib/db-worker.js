// SQLite on this device. Runs in a worker: the official SQLite WASM build with the OPFS "sahpool" VFS, which keeps the
// database file in the browser's private file system and needs no special server headers (so GitHub Pages is fine).
import sqlite3InitModule from "./sqlite/index.mjs";

let db = null;
let backend = "";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS progress (
  id TEXT PRIMARY KEY,      -- case id
  box INTEGER NOT NULL,     -- spaced-repetition level
  due INTEGER NOT NULL,     -- ms since epoch
  n INTEGER NOT NULL,       -- attempts
  fails INTEGER NOT NULL,   -- misses
  last INTEGER NOT NULL,    -- last good time, ms
  avg INTEGER NOT NULL,     -- running average of good times, ms
  best INTEGER NOT NULL,
  ts INTEGER NOT NULL       -- last attempt, ms since epoch
);
CREATE TABLE IF NOT EXISTS attempts (
  ts INTEGER NOT NULL,
  id TEXT NOT NULL,
  result TEXT NOT NULL,     -- fast | slow | miss
  ms INTEGER NOT NULL,
  sol TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS attempts_ts ON attempts(ts);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

const rows = (sql, bind) => db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
const PCOLS = ["id", "box", "due", "n", "fails", "last", "avg", "best", "ts"];
const putProgress = (r) => db.exec({
  sql: "INSERT OR REPLACE INTO progress(id,box,due,n,fails,last,avg,best,ts) VALUES(?,?,?,?,?,?,?,?,?)",
  bind: PCOLS.map((c) => (c === "id" ? String(r.id) : Number(r[c]) || 0)),   // ms timestamps do not fit in 32 bits
});
const putAttempt = (a) => db.exec({ sql: "INSERT INTO attempts(ts,id,result,ms,sol) VALUES(?,?,?,?,?)", bind: [a.ts, String(a.id), a.result, a.ms | 0, a.sol || ""] });

const ops = {
  async open() {
    const sqlite3 = await sqlite3InitModule();
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "dr-memoriser", initialCapacity: 6 });
    db = new pool.OpfsSAHPoolDb("/dr-memoriser.sqlite3");
    backend = "opfs";
    db.exec(SCHEMA);
    const v = rows("select sqlite_version() as v")[0].v;
    return { backend, version: v };
  },
  all() { return { progress: rows("select * from progress"), settings: Object.fromEntries(rows("select k,v from settings").map((r) => [r.k, r.v])) }; },
  recent({ limit }) { return rows("select * from attempts order by ts desc limit ?", [limit | 0]); },
  record({ progress, attempt }) {
    db.exec("BEGIN");
    try { putProgress(progress); putAttempt(attempt); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  },
  forget({ ids }) {
    db.exec("BEGIN");
    try { for (const id of ids) db.exec({ sql: "DELETE FROM progress WHERE id=?", bind: [String(id)] }); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  },
  setting({ k, v }) { db.exec({ sql: "INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)", bind: [k, v] }); },
  dump() { return { progress: rows("select * from progress"), attempts: rows("select * from attempts order by ts") }; },
  restore({ progress, attempts }) {
    db.exec("BEGIN");
    try {
      for (const r of progress) putProgress(r);
      const seen = new Set(rows("select ts||':'||id as k from attempts").map((r) => r.k));
      for (const a of attempts) if (!seen.has(a.ts + ":" + a.id)) putAttempt(a);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  },
};

self.onmessage = async (ev) => {
  const { id, op, args } = ev.data;
  try { postMessage({ id, ok: true, v: await ops[op](args || {}) }); }
  catch (e) { postMessage({ id, ok: false, e: String((e && e.message) || e) }); }
};
