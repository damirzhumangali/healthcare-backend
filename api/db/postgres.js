const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { AI_EMBEDDING_DIMENSIONS } = require("../services/aiConfig");

const migrationsDir = path.join(__dirname, "postgres-migrations");

let pool = null;
let schemaPromise = null;

function isTrue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "require";
}

function isAiDatabaseConfigured() {
  return Boolean(process.env.AI_DATABASE_URL || process.env.DATABASE_URL || process.env.PGHOST);
}

function getPool() {
  if (!isAiDatabaseConfigured()) {
    const error = new Error(
      "AI PostgreSQL is not configured. Set AI_DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD."
    );
    error.statusCode = 503;
    throw error;
  }

  if (!pool) {
    const connectionString = process.env.AI_DATABASE_URL || process.env.DATABASE_URL || undefined;
    const sslRequired = isTrue(process.env.AI_DB_SSL) || isTrue(process.env.PGSSLMODE);

    pool = new Pool({
      connectionString,
      host: connectionString ? undefined : process.env.PGHOST,
      port: connectionString ? undefined : Number(process.env.PGPORT || 5432),
      database: connectionString ? undefined : process.env.PGDATABASE,
      user: connectionString ? undefined : process.env.PGUSER,
      password: connectionString ? undefined : process.env.PGPASSWORD,
      ssl: sslRequired ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

async function runAiMigrations() {
  const client = await getPool().connect();
  try {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of files) {
      const filePath = path.join(migrationsDir, name);
      const sql = fs
        .readFileSync(filePath, "utf8")
        .replaceAll("__EMBEDDING_DIMENSIONS__", String(AI_EMBEDDING_DIMENSIONS));
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

async function ensureAiSchema() {
  if (!schemaPromise) {
    schemaPromise = runAiMigrations().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function query(text, params) {
  await ensureAiSchema();
  return getPool().query(text, params);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  closePool,
  ensureAiSchema,
  getPool,
  isAiDatabaseConfigured,
  query,
};
