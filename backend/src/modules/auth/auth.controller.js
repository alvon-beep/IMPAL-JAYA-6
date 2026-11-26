/**
 * ============================================================================
 * MODUL BACKEND: AUTENTIKASI (LOGIN, REGISTRASI OTP, GOOGLE OAUTH, RESET SANDI)
 * File: backend/src/modules/auth/auth.controller.js
 * ============================================================================
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/db.js';
import { sendOtpEmail } from '../../services/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'polusee_super_secret_jwt_key_2025';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function hashOtp(email, otpCode, purpose) {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${String(email).trim().toLowerCase()}:${purpose}:${String(otpCode).trim()}`)
    .digest('hex');
}

function verifyOtpToken({ email, otp_code, otp_token, expectedPurpose }) {
  if (!otp_code || !otp_token) {
    return { ok: false, status: 400, message: 'Kode verifikasi (OTP) wajib diisi.' };
  }
  try {
    const decoded = jwt.verify(otp_token, JWT_SECRET);
    const cleanEmail = String(email).trim().toLowerCase();
    if (decoded.purpose !== expectedPurpose || decoded.email !== cleanEmail) {
      return { ok: false, status: 400, message: 'Token verifikasi tidak sesuai dengan email Anda.' };
    }
    const expectedHash = hashOtp(cleanEmail, otp_code, expectedPurpose);
    const actualBuf = Buffer.from(String(decoded.otpHash || ''), 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
      return { ok: false, status: 400, message: 'Kode verifikasi salah. Silakan periksa kembali email Anda.' };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 400,
      message: 'Kode verifikasi sudah kedaluwarsa (lebih dari 10 menit). Silakan kirim ulang kode.',
    };
  }
}

function buildProfilResponse(account) {
  const userRole = account.role || 'USER';
  return {
    id_akun: account.id_akun,
    nama_lengkap: account.nama_lengkap,
    username: account.username || `@${(account.email || 'pengguna').split('@')[0]}`,
    email: account.email,
    role: userRole,
    umur: account.umur != null ? account.umur : 25,
    lokasi_default: account.lokasi_default || 'Samarinda',
    kategori_rentan: account.kategori_rentan || 'Umum',
    peringatan_aqi_100: account.peringatan_aqi_100 ?? false,
    foto_profil: account.foto_profil || '',
  };
}

// ============================================================================
// KIRIM KODE OTP 6 DIGIT KE EMAIL (UNTUK REGISTRASI MANUAL & RESET PASSWORD)
// ============================================================================
export async function sendOtp(req, res) {
  try {
    const { email, purpose = 'register' } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ message: 'Format alamat email tidak valid.' });
    }
    if (!['register', 'reset'].includes(purpose)) {
      return res.status(400).json({ message: 'Tujuan verifikasi tidak valid.' });
    }

    const existing = await query(
      'SELECT id_akun FROM akun WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
      [cleanEmail]
    );
    const exists = existing && existing.rows.length > 0;

    if (purpose === 'register' && exists) {
      return res
        .status(409)
        .json({ message: 'Email sudah terdaftar. Silakan masuk atau gunakan email lain.' });
    }
    if (purpose === 'reset' && !exists) {
      return res
        .status(404)
        .json({ message: 'Akun dengan email tersebut tidak ditemukan di database.' });
    }

    const otpCode = String(crypto.randomInt(100000, 1000000));
    await sendOtpEmail(cleanEmail, otpCode, purpose);

    const otpToken = jwt.sign(
      {
        email: cleanEmail,
        purpose,
        otpHash: hashOtp(cleanEmail, otpCode, purpose),
      },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    return res.status(200).json({
      success: true,
      otp_token: otpToken,
      message: `Kode verifikasi 6 digit telah dikirim ke ${cleanEmail}. Periksa inbox atau folder spam Anda.`,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message || 'Gagal mengirim kode verifikasi ke email.',
    });
  }
}

// ============================================================================
// GOOGLE OAUTH SIGN-IN (VERIFIKASI ID TOKEN GOOGLE)
// ============================================================================
export async function googleAuth(req, res) {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ message: 'Token Google tidak ditemukan.' });
    }

    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!verifyRes.ok) {
      return res.status(401).json({ message: 'Token Google tidak valid atau telah kedaluwarsa.' });
    }

    const payload = await verifyRes.json();
    const expectedClientId = (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
    if (expectedClientId && payload.aud !== expectedClientId) {
      return res.status(401).json({ message: 'Google Client ID tidak cocok.' });
    }
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      return res.status(401).json({ message: 'Email akun Google Anda belum terverifikasi.' });
    }

    const cleanEmail = String(payload.email || '').trim().toLowerCase();
    const googleName = String(payload.name || cleanEmail.split('@')[0]).trim();
    const googlePicture = String(payload.picture || '').trim();

    const result = await query(
      `SELECT a.*, u.lokasi_default, u.latitude, u.longitude, u.kategori_rentan, u.foto_profil,
              u.username, u.umur, u.peringatan_aqi_100
       FROM akun a
       LEFT JOIN users u ON a.id_akun = u.id_akun
       WHERE LOWER(TRIM(a.email)) = $1
       LIMIT 1`,
      [cleanEmail]
    );

    if (result && result.rows.length > 0) {
      const account = result.rows[0];
      const userRole = account.role || 'USER';
      const token = jwt.sign(
        { id_akun: account.id_akun, email: account.email, role: userRole },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );
      return res.status(200).json({
        needsProfile: false,
        token,
        role: userRole,
        profil: buildProfilResponse(account),
      });
    }

    // User Google baru: kembalikan token sementara agar frontend menampilkan form Lengkapi Profil
    const googleSignupToken = jwt.sign(
      {
        purpose: 'google_signup',
        email: cleanEmail,
        name: googleName,
        picture: googlePicture,
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.status(200).json({
      needsProfile: true,
      google_signup_token: googleSignupToken,
      googleUser: {
        email: cleanEmail,
        name: googleName,
        picture: googlePicture,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Gagal memverifikasi akun Google.',
      error: err.message,
    });
  }
}

// ============================================================================
// LENGKAPI PROFIL UNTUK PENGGUNA BARU GOOGLE AUTH
// ============================================================================
export async function completeGoogleSignup(req, res) {
  try {
    const {
      google_signup_token,
      nama,
      lokasi_default = 'Samarinda',
      kategori_rentan = 'Umum',
      umur = 25,
    } = req.body || {};

    if (!google_signup_token) {
      return res.status(400).json({ message: 'Sesi pendaftaran Google tidak ditemukan. Silakan ulangi login Google.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(google_signup_token, JWT_SECRET);
      if (decoded.purpose !== 'google_signup' || !decoded.email) {
        throw new Error('Invalid token');
      }
    } catch {
      return res.status(401).json({ message: 'Sesi pendaftaran Google sudah kedaluwarsa. Silakan klik Masuk dengan Google lagi.' });
    }

    const cleanEmail = String(decoded.email).trim().toLowerCase();
    const finalName = String(nama || decoded.name || cleanEmail.split('@')[0]).trim();
    const finalPicture = String(decoded.picture || '').trim();
    const finalUmur = Number(umur) > 0 && Number(umur) <= 120 ? Number(umur) : 25;

    if (!finalName) {
      return res.status(400).json({ message: 'Nama lengkap wajib diisi.' });
    }

    const existing = await query(
      'SELECT id_akun FROM akun WHERE LOWER(TRIM(email)) = $1 LIMIT 1',
      [cleanEmail]
    );
    if (existing && existing.rows.length > 0) {
      return res.status(409).json({ message: 'Akun dengan email Google ini sudah terdaftar. Silakan langsung masuk.' });
    }

    // Buat password hash acak yang aman karena akun ini login melalui Google OAuth
    const randomPass = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(randomPass, 10);

    const insertAkun = await query(
      `INSERT INTO akun (nama_lengkap, email, password_hash, role, status_aktif)
       VALUES ($1, $2, $3, 'USER', TRUE)
       RETURNING id_akun, nama_lengkap, email, role`,
      [finalName, cleanEmail, passwordHash]
    );

    const createdAkun = insertAkun.rows[0];
    const defaultUsername = `@${cleanEmail.split('@')[0]}`;

    await query(
      `INSERT INTO users (id_akun, lokasi_default, kategori_rentan, foto_profil, username, umur, peringatan_aqi_100)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [
        createdAkun.id_akun,
        lokasi_default || 'Samarinda',
        kategori_rentan || 'Umum',
        finalPicture || null,
        defaultUsername,
        finalUmur,
      ]
    );

    const token = jwt.sign(
      { id_akun: createdAkun.id_akun, email: createdAkun.email, role: 'USER' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      token,
      role: 'USER',
      user: {
        id_akun: createdAkun.id_akun,
        nama_lengkap: createdAkun.nama_lengkap,
        username: defaultUsername,
        email: createdAkun.email,
        role: 'USER',
        umur: finalUmur,
        lokasi_default: lokasi_default || 'Samarinda',
        kategori_rentan: kategori_rentan || 'Umum',
        peringatan_aqi_100: true,
        foto_profil: finalPicture,
      },
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Gagal menyelesaikan pendaftaran akun Google.',
      error: err.message,
    });
  }
}

// UC-01: Login Sistem (User & Admin — tanpa OTP)
export async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email dan kata sandi wajib diisi.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    let account = null;

    try {
      const result = await query(
        `SELECT a.*, u.lokasi_default, u.latitude, u.longitude, u.kategori_rentan, u.foto_profil,
                u.username, u.umur, u.peringatan_aqi_100
         FROM akun a
         LEFT JOIN users u ON a.id_akun = u.id_akun
         WHERE LOWER(TRIM(a.email)) = $1`,
        [cleanEmail]
      );
      if (result && result.rows.length > 0) {
        account = result.rows[0];
      }
    } catch (err) {
      return res.status(500).json({ message: 'Gagal terhubung ke database Supabase.', error: err.message });
    }

    if (!account) {
      return res.status(401).json({
        message: 'Akun tidak ditemukan. Silakan periksa kembali email Anda atau lakukan registrasi.',
      });
    }

    let isPasswordValid = false;
    if (account.password_hash) {
      try {
        isPasswordValid = await bcrypt.compare(password, account.password_hash);
      } catch {
        isPasswordValid = false;
      }
    }

    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Kata sandi salah. Silakan coba lagi.',
      });
    }

    const userRole = account.role || 'USER';
    const token = jwt.sign(
      {
        id_akun: account.id_akun,
        email: account.email,
        role: userRole,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      token,
      role: userRole,
      profil: buildProfilResponse(account),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Gagal memproses login.', error: err.message });
  }
}

// UC-02: Registrasi Akun Baru Manual (Wajib Verifikasi OTP Email)
export async function register(req, res) {
  try {
    const { nama, email, password, konfirmasi, lokasi_default, otp_code, otp_token } = req.body;
    if (!nama || !email || !password) {
      return res
        .status(400)
        .json({ message: 'Nama lengkap, email, dan kata sandi wajib diisi.' });
    }
    if (konfirmasi && password !== konfirmasi) {
      return res
        .status(400)
        .json({ message: 'Konfirmasi kata sandi belum cocok.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Wajib verifikasi OTP email sebelum akun dibuat
    const otpCheck = verifyOtpToken({
      email: cleanEmail,
      otp_code,
      otp_token,
      expectedPurpose: 'register',
    });
    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({ message: otpCheck.message });
    }

    try {
      const check = await query('SELECT id_akun FROM akun WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
      if (check && check.rows.length > 0) {
        return res
          .status(409)
          .json({ message: 'Email sudah terdaftar. Silakan login atau gunakan email lain.' });
      }
    } catch (err) {
      return res.status(500).json({ message: 'Gagal memeriksa ketersediaan email di Supabase.', error: err.message });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const insertAkun = await query(
      `INSERT INTO akun (nama_lengkap, email, password_hash, role, status_aktif)
       VALUES ($1, $2, $3, 'USER', TRUE)
       RETURNING id_akun, nama_lengkap, email, role`,
      [nama.trim(), cleanEmail, passwordHash]
    );

    if (!insertAkun || insertAkun.rows.length === 0) {
      return res.status(500).json({ message: 'Gagal membuat akun di database Supabase.' });
    }

    const createdAkun = insertAkun.rows[0];
    const defaultUsername = `@${cleanEmail.split('@')[0]}`;

    await query(
      `INSERT INTO users (id_akun, lokasi_default, kategori_rentan, username, umur, peringatan_aqi_100)
       VALUES ($1, $2, 'Umum', $3, 25, TRUE)`,
      [createdAkun.id_akun, lokasi_default || 'Samarinda', defaultUsername]
    );

    const token = jwt.sign(
      {
        id_akun: createdAkun.id_akun,
        email: createdAkun.email,
        role: createdAkun.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(201).json({
      token,
      role: 'USER',
      user: {
        id_akun: createdAkun.id_akun,
        nama_lengkap: createdAkun.nama_lengkap,
        username: defaultUsername,
        email: createdAkun.email,
        role: 'USER',
        umur: 25,
        lokasi_default: lokasi_default || 'Samarinda',
        kategori_rentan: 'Umum',
        peringatan_aqi_100: true,
        foto_profil: '',
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Gagal melakukan registrasi akun di Supabase.', error: err.message });
  }
}

// UC-03: Lupa Kata Sandi & Atur Ulang Sandi (Wajib Verifikasi OTP Email Aktif)
export async function forgotPassword(req, res) {
  try {
    const { email, password, newPassword, confirmPassword, otp_code, otp_token } = req.body;
    const targetPassword = (newPassword || password || '').trim();

    if (!email) {
      return res.status(400).json({ message: 'Email terdaftar wajib diisi.' });
    }
    if (!targetPassword) {
      return res.status(400).json({ message: 'Kata sandi baru wajib diisi.' });
    }
    if (confirmPassword && targetPassword !== confirmPassword.trim()) {
      return res.status(400).json({ message: 'Konfirmasi kata sandi tidak cocok.' });
    }
    if (targetPassword.length < 6) {
      return res.status(400).json({ message: 'Kata sandi baru minimal 6 karakter.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Wajib verifikasi OTP dari email aktif sebelum mengganti password
    const otpCheck = verifyOtpToken({
      email: cleanEmail,
      otp_code,
      otp_token,
      expectedPurpose: 'reset',
    });
    if (!otpCheck.ok) {
      return res.status(otpCheck.status).json({ message: otpCheck.message });
    }

    const result = await query(
      `SELECT a.id_akun, a.email, a.password_hash FROM akun a WHERE LOWER(TRIM(a.email)) = $1`,
      [cleanEmail]
    );

    if (!result || result.rows.length === 0) {
      return res.status(404).json({ message: 'Akun dengan email tersebut tidak ditemukan di database.' });
    }

    const account = result.rows[0];

    if (account.password_hash) {
      const isSamePassword = await bcrypt.compare(targetPassword, account.password_hash);
      if (isSamePassword) {
        return res.status(400).json({
          message: 'Kata sandi baru tidak boleh sama dengan kata sandi sebelumnya.',
        });
      }
    }

    const passwordHash = await bcrypt.hash(targetPassword, 10);

    await query(
      `UPDATE akun SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id_akun = $2`,
      [passwordHash, account.id_akun]
    );

    return res.status(200).json({
      success: true,
      message: 'Kata sandi berhasil diperbarui! Silakan masuk dengan kata sandi baru Anda.',
    });
  } catch (err) {
    return res.status(500).json({
      message: 'Gagal mengatur ulang kata sandi di Supabase.',
      error: err.message,
    });
  }
}
