/**
 * ============================================================================
 * STATE & SERVICE AUTENTIKASI / PROFIL PENGGUNA (FR-01, FR-02, FR-11 SKPL-1000)
 * File: src/features/auth/authStore.js
 * ============================================================================
 */

import { reactive, watch } from 'vue';
import {
  apiRequest,
  setStoredSession,
  clearStoredSession,
  getStoredUser,
  saveStoredUser,
} from '../../services/apiClient';

function getInitialProfile() {
  const storedUser = getStoredUser();
  if (storedUser && (storedUser.email || storedUser.nama_lengkap || storedUser.id_akun)) {
    return {
      id_akun: storedUser.id_akun || '',
      nama_lengkap: storedUser.nama_lengkap || '',
      username: storedUser.username || '',
      email: storedUser.email || '',
      umur: storedUser.umur ?? null,
      lokasi_default: storedUser.lokasi_default || 'Samarinda',
      kategori_rentan: storedUser.kategori_rentan || 'Umum',
      peringatan_aqi_100: storedUser.peringatan_aqi_100 ?? false,
      foto_profil: storedUser.foto_profil || '',
      role: storedUser.role || '',
    };
  }

  return {
    id_akun: '',
    nama_lengkap: '',
    username: '',
    email: '',
    umur: null,
    lokasi_default: 'Samarinda',
    kategori_rentan: 'Umum',
    peringatan_aqi_100: false,
    foto_profil: '',
    role: '',
  };
}

export const userProfileStore = reactive(getInitialProfile());

watch(
  userProfileStore,
  (val) => {
    saveStoredUser(val);
  },
  { deep: true }
);

/**
 * Kirim Kode OTP 6 Digit ke Email (purpose: 'register' | 'reset')
 */
export async function sendAuthOtp(email, purpose = 'register') {
  const cleanEmail = (email || '').trim().toLowerCase();
  const res = await apiRequest('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email: cleanEmail, purpose }),
  });
  return res;
}

/**
 * Autentikasi Google OAuth (POST /api/auth/google)
 */
export async function loginWithGoogle(credential) {
  const res = await apiRequest('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
  if (res?.needsProfile) {
    return {
      needsProfile: true,
      google_signup_token: res.google_signup_token,
      googleUser: res.googleUser,
    };
  }
  if (res && res.token) {
    const profilData = res.profil || res.user;
    if (profilData) {
      Object.assign(userProfileStore, profilData);
    }
    setStoredSession(res.token, userProfileStore);
    return {
      needsProfile: false,
      success: true,
      role: res.role || userProfileStore.role || 'USER',
    };
  }
  throw new Error('Gagal melakukan autentikasi Google.');
}

/**
 * Selesaikan Pendaftaran Akun Baru Google Auth (POST /api/auth/google/complete)
 */
export async function completeGoogleRegistration({
  google_signup_token,
  nama,
  lokasi_default,
  kategori_rentan,
  umur,
}) {
  const res = await apiRequest('/auth/google/complete', {
    method: 'POST',
    body: JSON.stringify({
      google_signup_token,
      nama,
      lokasi_default: lokasi_default || 'Samarinda',
      kategori_rentan: kategori_rentan || 'Umum',
      umur: Number(umur) || 25,
    }),
  });
  if (res && res.token) {
    const userData = res.user || res.profil;
    if (userData) {
      Object.assign(userProfileStore, userData);
    }
    setStoredSession(res.token, userProfileStore);
    return { success: true, role: res.role || 'USER' };
  }
  throw new Error('Gagal menyimpan profil pendaftaran Google.');
}

/**
 * Autentikasi Login (UC-01 SKPL: POST /api/auth/login)
 */
export async function loginAccount(email, password) {
  const res = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (res && res.token) {
    const profilData = res.profil || res.user;
    if (profilData) {
      Object.assign(userProfileStore, profilData);
    }
    setStoredSession(res.token, userProfileStore);
    return {
      success: true,
      role: res.role || userProfileStore.role || 'USER',
      fromBackend: true,
    };
  }
  throw new Error('Gagal melakukan autentikasi ke database Supabase.');
}

/**
 * Registrasi Akun Baru Manual dengan OTP Email (UC-02 SKPL: POST /api/auth/register)
 */
export async function registerAccount({
  name,
  email,
  password,
  confirmPassword,
  lokasi_default,
  otp_code,
  otp_token,
}) {
  const res = await apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      nama: name,
      email,
      password,
      konfirmasi: confirmPassword,
      lokasi_default: lokasi_default || 'Samarinda',
      otp_code,
      otp_token,
    }),
  });
  if (res && res.token) {
    const userData = res.user || res.profil;
    if (userData) {
      Object.assign(userProfileStore, userData);
    }
    setStoredSession(res.token, userProfileStore);
    return { success: true, fromBackend: true };
  }
  throw new Error('Gagal mendaftarkan akun ke database Supabase.');
}

/**
 * Update Profil Pengguna (UC-11 SKPL: PUT /api/profile)
 */
export async function updateProfileData(payload) {
  try {
    const res = await apiRequest('/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (res && res.profil_user) {
      Object.assign(userProfileStore, payload, res.profil_user);
      saveStoredUser(userProfileStore);
    }
    return userProfileStore;
  } catch (err) {
    console.error('[authStore] Gagal memperbarui profil ke Supabase:', err);
    throw err;
  }
}

export async function forgotPasswordAccount({
  email,
  newPassword,
  confirmPassword,
  otp_code,
  otp_token,
}) {
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPassword = (newPassword || '').trim();

  const res = await apiRequest('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({
      email: cleanEmail,
      password: cleanPassword,
      newPassword: cleanPassword,
      confirmPassword,
      otp_code,
      otp_token,
    }),
  });
  return {
    success: true,
    message:
      res.message || 'Kata sandi berhasil diperbarui! Silakan masuk dengan kata sandi baru Anda.',
  };
}

export function logoutAccount() {
  clearStoredSession();
  Object.assign(userProfileStore, {
    id_akun: '',
    nama_lengkap: '',
    username: '',
    email: '',
    umur: null,
    lokasi_default: 'Samarinda',
    kategori_rentan: 'Umum',
    peringatan_aqi_100: false,
    foto_profil: '',
    role: '',
  });
}
