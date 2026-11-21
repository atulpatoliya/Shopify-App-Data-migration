// App data (import history, undo backups, export schedules) in a local SQLite file.
// Each app process has its own file (APP_DB), next to its sessions database.
import sqlite3 from "sqlite3";

const db = new sqlite3.Database(process.env.APP_DB || "app-data.sqlite");

const run = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    }),
  );
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));

const ready = (async () => {
  await run(`CREATE TABLE IF NOT EXISTS import_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop TEXT NOT NULL,
    file_name TEXT,
    user_name TEXT,
    created_at TEXT NOT NULL,
    updated INTEGER DEFAULT 0,
    created INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    undone_at TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS import_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    product_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_backups_job ON import_backups(job_id)`);
  await run(`CREATE TABLE IF NOT EXISTS export_schedules (
    shop TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    frequency TEXT DEFAULT 'weekly',
    weekday INTEGER DEFAULT 1,
    hour INTEGER DEFAULT 8,
    email TEXT,
    format TEXT DEFAULT 'xlsx',
    query TEXT,
    last_run_at TEXT,
    last_status TEXT
  )`);
})();

const now = () => new Date().toISOString();

// ── Import jobs ─────────────────────────────────────────────────────────────
export async function createImportJob({ shop, fileName, userName }) {
  await ready;
  const r = await run(
    "INSERT INTO import_jobs (shop, file_name, user_name, created_at) VALUES (?, ?, ?, ?)",
    [shop, fileName ?? null, userName ?? null, now()],
  );
  return r.lastID;
}

export async function getImportJob(shop, id) {
  await ready;
  return get("SELECT * FROM import_jobs WHERE shop = ? AND id = ?", [shop, id]);
}

export async function addJobCounts(id, { updated = 0, created = 0, failed = 0 }) {
  await ready;
  await run("UPDATE import_jobs SET updated = updated + ?, created = created + ?, failed = failed + ? WHERE id = ?", [
    updated, created, failed, id,
  ]);
}

export async function setJobStatus(id, status) {
  await ready;
  await run(
    `UPDATE import_jobs SET status = ?${status === "undone" ? ", undone_at = ?" : ""} WHERE id = ?`,
    status === "undone" ? [status, now(), id] : [status, id],
  );
}

export async function listImportJobs(shop, limit = 50) {
  await ready;
  return all("SELECT * FROM import_jobs WHERE shop = ? ORDER BY id DESC LIMIT ?", [shop, limit]);
}

export async function saveBackup(jobId, productId, action, before) {
  await ready;
  await run("INSERT INTO import_backups (job_id, product_id, action, before_json) VALUES (?, ?, ?, ?)", [
    jobId, productId, action, before ? JSON.stringify(before) : null,
  ]);
}

export async function getBackups(jobId) {
  await ready;
  const rows = await all("SELECT * FROM import_backups WHERE job_id = ? ORDER BY id", [jobId]);
  return rows.map((r) => ({ ...r, before: r.before_json ? JSON.parse(r.before_json) : null }));
}

// ── Export schedules ────────────────────────────────────────────────────────
export async function getSchedule(shop) {
  await ready;
  return get("SELECT * FROM export_schedules WHERE shop = ?", [shop]);
}

export async function saveSchedule(shop, s) {
  await ready;
  await run(
    `INSERT INTO export_schedules (shop, enabled, frequency, weekday, hour, email, format, query)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop) DO UPDATE SET enabled = excluded.enabled, frequency = excluded.frequency,
       weekday = excluded.weekday, hour = excluded.hour, email = excluded.email,
       format = excluded.format, query = excluded.query`,
    [shop, s.enabled ? 1 : 0, s.frequency, s.weekday, s.hour, s.email, s.format, s.query || null],
  );
}

export async function listEnabledSchedules() {
  await ready;
  return all("SELECT * FROM export_schedules WHERE enabled = 1");
}

export async function markScheduleRun(shop, status) {
  await ready;
  await run("UPDATE export_schedules SET last_run_at = ?, last_status = ? WHERE shop = ?", [now(), status, shop]);
}

/** Uninstall / shop redact: remove everything stored for the shop. */
export async function deleteShopData(shop) {
  await ready;
  await run("DELETE FROM import_backups WHERE job_id IN (SELECT id FROM import_jobs WHERE shop = ?)", [shop]);
  await run("DELETE FROM import_jobs WHERE shop = ?", [shop]);
  await run("DELETE FROM export_schedules WHERE shop = ?", [shop]);
}
