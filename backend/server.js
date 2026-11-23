/**
 * ============================================================================
 * SERVER UTAMA BACKEND EXPRESS.JS — POLUSEE WEB PLATFORM
 * File: backend/server.js
 * Arsitektur: JavaScript (ES6+), Express.js, PostgreSQL
 * Mengacu pada: Dokumen SKPL-1000 Revisi C
 * ============================================================================
 */

import './src/config/loadEnv.js';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from './src/modules/auth/auth.routes.js';
import aqiRoutes from './src/modules/aqi/aqi.routes.js';
import rekomendasiRoutes from './src/modules/rekomendasi/rekomendasi.routes.js';
import edukasiRoutes from './src/modules/edukasi/edukasi.routes.js';
import komunitasRoutes from './src/modules/komunitas/komunitas.routes.js';
import profilRoutes from './src/modules/profil/profil.routes.js';
import adminRoutes from './src/modules/admin/admin.routes.js';
import { startAqiPeriodicLogger } from './src/services/iqairService.js';
import { serverCache } from './src/utils/serverCache.js';
import { query, getDbEgressStats } from './src/config/db.js';
import { verifyDeveloperToken } from './src/middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist');

const app = express();
const PORT = parseInt(process.env.PORT || '5000', 10);

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ============================================================================
// HTTP REQUEST LOGGER MIDDLEWARE (Log Status API, Code 200, 404, 500, Response Time)
// ============================================================================
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    // Warna status code: 2xx Hijau, 3xx Biru, 4xx Kuning/Oranye, 5xx Merah
    let statusColor = '\x1b[32m'; // Hijau (2xx)
    if (statusCode >= 500) statusColor = '\x1b[31m'; // Merah (5xx)
    else if (statusCode >= 400) statusColor = '\x1b[33m'; // Kuning (4xx)
    else if (statusCode >= 300) statusColor = '\x1b[36m'; // Cyan (3xx)

    const reset = '\x1b[0m';
    const dim = '\x1b[2m';
    const bold = '\x1b[1m';
    const time = new Date().toLocaleTimeString();

    // Log request API dan Web
    if (originalUrl.startsWith('/api')) {
      const dbTag = res.locals.dbLog
        ? ` \x1b[36m[DB Supabase]\x1b[0m ${res.locals.dbLog}`
        : '';
      console.log(
        `${dim}[${time}]${reset} ${bold}[API]${reset} ${bold}${method.padEnd(6)}${reset} ${originalUrl} ` +
        `-> ${statusColor}${bold}${statusCode} ${res.statusMessage || ''}${reset} ${dim}(${duration}ms)${reset}${dbTag}`
      );
    } else if (originalUrl === '/' || statusCode >= 400) {
      console.log(
        `${dim}[${time}]${reset} ${bold}[WEB]${reset} ${method.padEnd(6)} ${originalUrl} ` +
        `-> ${statusColor}${statusCode}${reset} ${dim}(${duration}ms)${reset}`
      );
    }
  });

  next();
});

// Sajikan static assets frontend (dist) langsung di port 5000
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

const JWT_SECRET = process.env.JWT_SECRET || 'polusee_super_secret_jwt_key_2025';

function renderDevLoginHtml(errorMsg = '') {
  const safeErr = String(errorMsg || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PoluSee | Developer Health Login</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8f8f1;color:#263b3e;font-family:'DM Sans',system-ui,sans-serif;padding:20px}
    .card{width:100%;max-width:400px;background:#fafaf5;border:1px solid #263b3e;box-shadow:6px 6px 0 #285765;padding:28px;border-radius:4px}
    h1{margin:0 0 8px;font-size:22px;color:#263b3e}
    p{margin:0 0 20px;font-size:13px;color:#54615b;line-height:1.6}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:14px}
    input{width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;border:1px solid #aeb9ae;background:#fff;color:#263b3e;font-size:14px;border-radius:2px}
    button{width:100%;padding:11px 16px;background:#285765;color:#f8f8f1;border:0;font-size:14px;font-weight:600;cursor:pointer;border-radius:2px}
    button:hover{background:#173f4d}
    .err{background:#faebeb;color:#9b1c1c;border:1px solid #e3a0a0;padding:10px 12px;font-size:13px;margin-bottom:16px}
    .tag{display:inline-block;background:#edce7e;color:#263b3e;font-size:11px;font-weight:700;padding:3px 8px;margin-bottom:12px}
  </style>
</head>
<body>
  <form class="card" method="POST" action="/api/health/login">
    <span class="tag">KHUSUS ROLE DEVELOPER</span>
    <h1>Login Health Monitor</h1>
    <p>Masuk dengan akun PoluSee yang memiliki role <strong>DEVELOPER</strong> di Supabase untuk melihat status server dan statistik egress database.</p>
    ${safeErr ? `<div class="err">${safeErr}</div>` : ''}
    <label>Email
      <input type="email" name="email" required autocomplete="email" placeholder="developer@polusee.id" />
    </label>
    <label>Kata Sandi
      <input type="password" name="password" required autocomplete="current-password" placeholder="Masukkan kata sandi" />
    </label>
    <button type="submit">Masuk ke /api/health</button>
  </form>
</body>
</html>`;
}

// Login khusus Developer untuk membuka /api/health di browser (HttpOnly cookie)
app.post('/api/health/login', async (req, res) => {
  const { email, password } = req.body || {};
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (!email || !password) {
    if (wantsHtml) return res.status(400).send(renderDevLoginHtml('Email dan kata sandi wajib diisi.'));
    return res.status(400).json({ message: 'Email dan kata sandi wajib diisi.' });
  }
  try {
    const cleanEmail = String(email).trim().toLowerCase();
    const result = await query(
      'SELECT id_akun, nama_lengkap, email, password_hash, role FROM akun WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
      [cleanEmail]
    );
    const account = result?.rows?.[0];
    if (!account || !account.password_hash) {
      if (wantsHtml) return res.status(401).send(renderDevLoginHtml('Email atau kata sandi salah.'));
      return res.status(401).json({ message: 'Email atau kata sandi salah.' });
    }
    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      if (wantsHtml) return res.status(401).send(renderDevLoginHtml('Email atau kata sandi salah.'));
      return res.status(401).json({ message: 'Email atau kata sandi salah.' });
    }
    if (String(account.role || '').toUpperCase() !== 'DEVELOPER') {
      if (wantsHtml) {
        return res
          .status(403)
          .send(renderDevLoginHtml('Akses ditolak. Akun ini tidak memiliki role DEVELOPER di Supabase.'));
      }
      return res.status(403).json({ message: 'Akses ditolak. Khusus role DEVELOPER.' });
    }

    const token = jwt.sign(
      { id_akun: account.id_akun, email: account.email, role: 'DEVELOPER' },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    const isProd = process.env.NODE_ENV === 'production';
    res.setHeader(
      'Set-Cookie',
      `polusee_dev_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/health; Max-Age=43200${isProd ? '; Secure' : ''}`
    );
    if (wantsHtml) return res.redirect('/api/health');
    return res.status(200).json({ success: true, token, role: 'DEVELOPER' });
  } catch (err) {
    if (wantsHtml) return res.status(500).send(renderDevLoginHtml(`Gagal memverifikasi akun: ${err.message}`));
    return res.status(500).json({ message: 'Gagal memverifikasi akun Developer.', error: err.message });
  }
});

app.post('/api/health/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'polusee_dev_token=; HttpOnly; SameSite=Strict; Path=/api/health; Max-Age=0');
  return res.redirect('/api/health');
});

// Health check & Egress Monitor endpoint (Dilindungi khusus role DEVELOPER)
app.get('/api/health', (req, res) => {
  const auth = verifyDeveloperToken(req);
  const wantsHtml =
    (req.headers.accept || '').includes('text/html') && req.query.format !== 'json';

  if (!auth.ok) {
    if (wantsHtml) {
      return res.status(auth.status).send(renderDevLoginHtml(auth.status === 403 ? auth.message : ''));
    }
    return res.status(auth.status).json({ message: auth.message });
  }

  const payload = {
    status: 'OK',
    developer: auth.user.email,
    platform: 'PoluSee Web Platform (Vue.js + Express.js + PostgreSQL)',
    document_ref: 'SKPL-1000 Revisi C',
    cache_stats: serverCache.getStats(),
    db_egress: getDbEgressStats(),
    timestamp: new Date().toISOString(),
  };

  if (wantsHtml) {
    const prettyJson = JSON.stringify(payload, null, 2)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return res.status(200).send(`<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PoluSee | Developer Health & Egress</title>
  <style>
    body{margin:0;background:#f8f8f1;color:#263b3e;font-family:'DM Sans',system-ui,sans-serif;padding:24px}
    .wrap{max-width:960px;margin:auto}
    .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
    .actions{display:flex;gap:8px}
    .btn{padding:8px 14px;border:1px solid #285765;background:#285765;color:#f8f8f1;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;border-radius:2px}
    .btn.sec{background:#fafaf5;color:#285765}
    pre{background:#263b3e;color:#f8f8f1;padding:20px;overflow:auto;border-radius:4px;font-size:13px;line-height:1.55}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bar">
      <div><strong>PoluSee Health &amp; Egress Monitor</strong> · Login sebagai ${auth.user.email}</div>
      <div class="actions">
        <a class="btn sec" href="/api/health">Refresh</a>
        <a class="btn sec" href="/api/health?format=json">Raw JSON</a>
        <form method="POST" action="/api/health/logout" style="margin:0"><button class="btn" type="submit">Keluar</button></form>
      </div>
    </div>
    <pre>${prettyJson}</pre>
  </div>
</body>
</html>`);
  }

  return res.status(200).json(payload);
});

// Routing Modular 15 Use Case SKPL-1000
app.use('/api/auth', authRoutes);
app.use('/api/aqi', aqiRoutes);
app.use('/api/rekomendasi', rekomendasiRoutes);
app.use('/api/edukasi', edukasiRoutes);
app.use('/api/komunitas', komunitasRoutes);
app.use('/api/profile', profilRoutes);
app.use('/api/admin', adminRoutes);
// SPA Fallback: Arahkan seluruh rute browser (non-API) langsung ke frontend Vue (index.html)
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('Frontend build belum ditemukan. Jalankan "npm run build" terlebih dahulu.');
});

app.listen(PORT, () => {
  console.log(`[PoluSee Backend] Express.js server berjalan pada http://localhost:${PORT}`);
  startAqiPeriodicLogger();
});
