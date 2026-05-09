const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const isVercel = process.env.VERCEL || process.env.NOW_REGION;
const dataDir = isVercel ? "/tmp" : path.join(__dirname, "..", "data");
const migrationsDir = path.join(__dirname, "migrations");
const dbPath = path.join(dataDir, "healthassist.sqlite");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(migrationsDir)) fs.mkdirSync(migrationsDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function runMigrations() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        db.exec(statement);
      } catch (error) {
        if (/duplicate column name/i.test(String(error?.message || ""))) continue;
        throw error;
      }
    }
  }
}
runMigrations();
module.exports = { db };
