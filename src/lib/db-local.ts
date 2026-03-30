import Database from "better-sqlite3";
import path from "path";

// Load sqlite-vec dynamically — graceful if unavailable (e.g. cloud mode, missing native binary)
let sqliteVec: { load: (db: Database.Database) => void } | null = null;
try {
  sqliteVec = require("sqlite-vec");
} catch (e) {
  console.warn("[DB] sqlite-vec not available, vector search will be disabled:", (e as Error).message);
}

// Database file stored in project root
// Use test DB if TEST_DB_PATH is set, TEST_MODE is set, or NODE_ENV is 'test'
function getDbPath(): string {
  // Check TEST_DB_PATH first (most explicit and reliable)
  if (process.env.TEST_DB_PATH) {
    // Handle both relative and absolute paths
    return path.isAbsolute(process.env.TEST_DB_PATH)
      ? process.env.TEST_DB_PATH
      : path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.TEST_DB_PATH);
  }
  // Check TEST_MODE (reliable for E2E tests)
  if (process.env.TEST_MODE === 'true' || process.env.TEST_MODE === '1') {
    return path.join(/*turbopackIgnore: true*/ process.cwd(), "brain.test.db");
  }
  // Check NODE_ENV for test environment
  if (process.env.NODE_ENV === 'test') {
    return path.join(/*turbopackIgnore: true*/ process.cwd(), "brain.test.db");
  }
  // Default to production DB
  return process.env.DATABASE_URL?.replace('file:', '') || path.join(/*turbopackIgnore: true*/ process.cwd(), "brain.db");
}

// Singleton database connection
let db: Database.Database | null = null;
let dbPath: string | null = null;

function getDb(): Database.Database {
  const currentDbPath = getDbPath();
  // Normalize paths for comparison (resolve to absolute, remove trailing slashes)
  const normalizedCurrentPath = path.resolve(/*turbopackIgnore: true*/ currentDbPath);
  const normalizedCachedPath = dbPath ? path.resolve(/*turbopackIgnore: true*/ dbPath) : null;
  
  // If database is not initialized, or path changed (e.g., test vs prod), reinitialize
  if (!db || normalizedCachedPath !== normalizedCurrentPath) {
    if (db) {
      // Close existing connection if path changed
      db.close();
      db = null;
    }
    
    dbPath = normalizedCurrentPath;
    db = new Database(dbPath);
    if (sqliteVec) {
      try {
        sqliteVec.load(db);
      } catch (e) {
        console.error("[DB] Failed to load sqlite-vec into DB:", (e as Error).message);
      }
    }
    const isTestMode = process.env.TEST_MODE === 'true' || process.env.TEST_MODE === '1' || process.env.NODE_ENV === 'test';
    db.pragma(isTestMode ? "journal_mode = DELETE" : "journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

// Reset database connection (useful for testing)
export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
  dbPath = null; // Clear cached path to force re-evaluation
}

// Wrapper to make it async-compatible for the common interface
export const dbWrapper = {
  prepare: (sql: string) => ({
    all: async (...params: any[]) => {
      const database = getDb();
      return database.prepare(sql).all(...params);
    },
    get: async (...params: any[]) => {
      const database = getDb();
      return database.prepare(sql).get(...params);
    },
    run: async (...params: any[]) => {
      const database = getDb();
      const result = database.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    },
  }),
  exec: async (sql: string) => {
    getDb().exec(sql);
  },
  transaction: <T>(fn: () => Promise<T>) => {
    return async () => {
      // For better-sqlite3, transactions execute synchronously
      // However, since our db-service methods are async, we need to handle this
      return await fn();
    };
  },
};

// Export the database instance directly for backward compatibility
export default getDb();

