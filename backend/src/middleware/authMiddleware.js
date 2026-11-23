/**
 * ============================================================================
 * MIDDLEWARE OTENTIKASI JWT & OTORISASI ROLE (USER / ADMIN)
 * File: backend/src/middleware/authMiddleware.js
 * Mengacu pada: NFR-03 & UC-01 SKPL-1000 Revisi C
 * ============================================================================
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'polusee_super_secret_jwt_key_2025';

export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token autentikasi tidak ditemukan.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ message: 'Sesi tidak valid atau telah berakhir.' });
  }
}

export function optionalToken(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || String(req.user.role || '').toUpperCase() !== 'ADMIN') {
    return res.status(403).json({ message: 'Akses ditolak. Hanya untuk Admin.' });
  }
  return next();
}

export function extractTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)polusee_dev_token=([^;]+)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

export function verifyDeveloperToken(req) {
  const token = extractTokenFromRequest(req);
  if (!token) return { ok: false, status: 401, message: 'Autentikasi Developer diperlukan.' };
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (String(decoded.role || '').toUpperCase() !== 'DEVELOPER') {
      return { ok: false, status: 403, message: 'Akses ditolak. Khusus role DEVELOPER.' };
    }
    return { ok: true, user: decoded };
  } catch {
    return { ok: false, status: 401, message: 'Sesi Developer tidak valid atau telah berakhir.' };
  }
}

export function requireDeveloper(req, res, next) {
  const check = verifyDeveloperToken(req);
  if (!check.ok) {
    return res.status(check.status).json({ message: check.message });
  }
  req.user = check.user;
  return next();
}
