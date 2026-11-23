/**
 * ============================================================================
 * KONFIGURASI KONEKSI DATABASE SUPABASE CLOUD POSTGRESQL (CONNECTION POOL)
 * File: backend/src/config/db.js
 * Mengacu pada: Bab 2.4, Bab 4.3, & Lampiran B SKPL-1000 Revisi C
 * ============================================================================
 */

import './loadEnv.js';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Muat environment baik saat dijalankan dari root maupun folder backend
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { Pool } = pg;

const rawDbUrl = process.env.DATABASE_URL?.trim();

if (!rawDbUrl) {
  console.error(
    '[Database Error]: Variabel DATABASE_URL (Supabase) belum diatur di file .env.local / .env!'
  );
}

export const pool = new Pool({
  connectionString: rawDbUrl,
  ssl: { rejectUnauthorized: false },
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.warn('[Supabase Pool Warning]:', err.message);
});

// Tes koneksi database Supabase di awal
pool
  .query('SELECT NOW()')
  .then(() => {
    console.log('[Database Connected]: Terhubung 100% ke PostgreSQL (Supabase Cloud)');
  })
  .catch((err) => {
    console.error(`[Database Error]: Gagal terhubung ke database Supabase: ${err.message}`);
  });

// ============================================================================
// SUPABASE EGRESS MONITOR PER TABEL & QUERY (IN-MEMORY)
// ============================================================================
const egressStartedAt = new Date().toISOString();
const egressStats = {
  totalQueries: 0,
  totalBytes: 0,
  byTable: new Map(),
  heavyQueries: [],
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseSqlMeta(sql = '') {
  const clean = String(sql).replace(/\s+/g, ' ').trim();
  const opMatch = clean.match(/^(SELECT|INSERT|UPDATE|DELETE)\b/i);
  const op = opMatch ? opMatch[1].toUpperCase() : 'OTHER';
  // Hapus subquery dalam kurung agar nama tabel utama (misal post_komunitas) terbaca akurat
  const withoutSubqueries = clean.replace(/\([^()]*\([^()]*\)[^()]*\)/g, ' ').replace(/\([^()]*\)/g, ' ');
  const tableMatch =
    withoutSubqueries.match(/\b(?:FROM|INTO|UPDATE)\s+([a-zA-Z0-9_."]+)/i) ||
    clean.match(/\b(?:FROM|INTO|UPDATE)\s+([a-zA-Z0-9_."]+)/i);
  const table = tableMatch ? tableMatch[1].replace(/"/g, '').toLowerCase() : 'unknown';
  return { op, table };
}

export function getDbEgressStats() {
  const tables = Array.from(egressStats.byTable.entries())
    .map(([table, info]) => ({
      table,
      queries: info.queries,
      rows: info.rows,
      bytes: info.bytes,
      egress: formatBytes(info.bytes),
      share:
        egressStats.totalBytes > 0
          ? `${((info.bytes / egressStats.totalBytes) * 100).toFixed(1)}%`
          : '0%',
      operations: info.operations,
      last_query_at: info.lastQueryAt,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return {
    since: egressStartedAt,
    total_queries: egressStats.totalQueries,
    total_bytes: egressStats.totalBytes,
    total_egress: formatBytes(egressStats.totalBytes),
    by_table: tables,
    heavy_queries: egressStats.heavyQueries,
  };
}

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const durationMs = Date.now() - start;

  try {
    const rows = result?.rows || [];
    const bytes = rows.length > 0 ? Buffer.byteLength(JSON.stringify(rows), 'utf8') : 0;
    const { op, table } = parseSqlMeta(text);

    egressStats.totalQueries += 1;
    egressStats.totalBytes += bytes;

    const current = egressStats.byTable.get(table) || {
      queries: 0,
      rows: 0,
      bytes: 0,
      operations: {},
      lastQueryAt: null,
    };
    current.queries += 1;
    current.rows += rows.length;
    current.bytes += bytes;
    current.operations[op] = (current.operations[op] || 0) + 1;
    current.lastQueryAt = new Date().toISOString();
    egressStats.byTable.set(table, current);

    if (bytes >= 20 * 1024) {
      egressStats.heavyQueries.unshift({
        time: current.lastQueryAt,
        op,
        table,
        rows: rows.length,
        egress: formatBytes(bytes),
        duration_ms: durationMs,
      });
      if (egressStats.heavyQueries.length > 15) {
        egressStats.heavyQueries.length = 15;
      }
      if (bytes >= 50 * 1024) {
        console.log(
          `\x1b[33m[Supabase Egress]\x1b[0m ${op} ${table} -> ${formatBytes(bytes)} (${rows.length} rows, ${durationMs}ms)`
        );
      }
    }
  } catch {
    // Jangan ganggu jalannya query utama jika pencatatan statistik gagal
  }

  return result;
}
