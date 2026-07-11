const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const Database = require("better-sqlite3");

// Store the DB in the OS-appropriate user data folder so it survives
// app updates and reinstalls, and is included in Backup & Restore.
const dbDir = app.getPath("userData");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, "nexora.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// Columns added after the initial release: add them to any pre-existing
// database file so upgrading doesn't require deleting local data.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so we check pragma table_info first.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate() {
  ensureColumn("products", "updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn("customers", "credit_limit", "REAL NOT NULL DEFAULT 0");
  ensureColumn("customers", "balance", "REAL NOT NULL DEFAULT 0");
  ensureColumn("customers", "updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn("suppliers", "balance", "REAL NOT NULL DEFAULT 0");
  ensureColumn("suppliers", "updated_at", "TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumn("purchases", "invoice_no", "TEXT");
  ensureColumn("expenses", "receipt_path", "TEXT");
}
migrate();

module.exports = { db, dbPath };
