<script setup>
/**
 * ============================================================================
 * MODUL AUTENTIKASI: LOGIN, REGISTRASI OTP, GOOGLE OAUTH & LUPA KATA SANDI
 * File: src/features/auth/AuthPage.vue
 * ============================================================================
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import {
  loginAccount,
  registerAccount,
  forgotPasswordAccount,
  sendAuthOtp,
  loginWithGoogle,
  completeGoogleRegistration,
} from './authStore';

const props = defineProps({
  mode: {
    type: String,
    required: true, // 'login' | 'register' | 'forgot'
  },
});

const emit = defineEmits(['navigate', 'login', 'admin', 'cancel']);

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

const isRegister = computed(() => props.mode === 'register');
const isForgot = computed(() => props.mode === 'forgot');
const isLogin = computed(() => !isRegister.value && !isForgot.value);

const error = ref('');
const notice = ref('');
const visible = ref(false);
const loading = ref(false);

const nameInput = ref('');
const emailInput = ref('');
const cityInput = ref('Samarinda');
const groupInput = ref('Umum');
const ageInput = ref(25);
const passwordInput = ref('');
const confirmPasswordInput = ref('');

// State OTP (untuk Register Manual & Lupa Kata Sandi)
const otpSent = ref(false);
const otpCode = ref('');
const otpToken = ref('');

// State Lengkapi Profil khusus User Baru Google Auth
const googleProfileStep = ref(false);
const googleSignupToken = ref('');
const googleAvatarPreview = ref('');
const googleBtnRef = ref(null);

function resetTransientState() {
  error.value = '';
  notice.value = '';
  visible.value = false;
  otpSent.value = false;
  otpCode.value = '';
  otpToken.value = '';
  googleProfileStep.value = false;
  googleSignupToken.value = '';
  googleAvatarPreview.value = '';
}

function fillAdminCredentials() {
  emailInput.value = 'admin@polusee.id';
  passwordInput.value = 'admin123';
  error.value = '';
}

function navigate(next) {
  resetTransientState();
  nameInput.value = '';
  passwordInput.value = '';
  confirmPasswordInput.value = '';
  emit('navigate', next);
}

async function handleGoogleCredentialResponse(response) {
  if (!response?.credential) return;
  error.value = '';
  notice.value = '';
  loading.value = true;
  try {
    const res = await loginWithGoogle(response.credential);
    if (res.needsProfile) {
      googleSignupToken.value = res.google_signup_token;
      emailInput.value = res.googleUser?.email || '';
      nameInput.value = res.googleUser?.name || '';
      googleAvatarPreview.value = res.googleUser?.picture || '';
      googleProfileStep.value = true;
      notice.value = 'Akun Google terverifikasi. Lengkapi data profilmu untuk melanjutkan.';
    } else if (res.role === 'ADMIN') {
      emit('admin');
    } else {
      emit('login', { role: res.role });
    }
  } catch (err) {
    error.value = err.message || 'Gagal masuk menggunakan akun Google.';
  } finally {
    loading.value = false;
  }
}

function initGoogleButton() {
  if (!GOOGLE_CLIENT_ID || !googleBtnRef.value || googleProfileStep.value || isForgot.value) return;
  const g = window.google?.accounts?.id;
  if (!g) {
    setTimeout(initGoogleButton, 400);
    return;
  }
  try {
    g.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
    });
    googleBtnRef.value.innerHTML = '';
    g.renderButton(googleBtnRef.value, {
      theme: 'outline',
      size: 'large',
      width: googleBtnRef.value.offsetWidth || 340,
      text: isRegister.value ? 'signup_with' : 'signin_with',
      locale: 'id',
    });
  } catch {
    // Abaikan jika SDK belum siap
  }
}

onMounted(() => {
  nextTick(initGoogleButton);
});

watch(
  () => [props.mode, googleProfileStep.value],
  () => {
    nextTick(initGoogleButton);
  }
);

async function handleCompleteGoogleProfile() {
  error.value = '';
  if (!nameInput.value.trim()) {
    error.value = 'Nama lengkap wajib diisi.';
    return;
  }
  loading.value = true;
  try {
    const res = await completeGoogleRegistration({
      google_signup_token: googleSignupToken.value,
      nama: nameInput.value.trim(),
      lokasi_default: cityInput.value || 'Samarinda',
      kategori_rentan: groupInput.value || 'Umum',
      umur: ageInput.value || 25,
    });
    emit('login', { role: res.role, target: 'home', isNewUser: true });
  } catch (err) {
    error.value = err.message || 'Gagal menyelesaikan pendaftaran akun Google.';
  } finally {
    loading.value = false;
  }
}

async function handleRequestOtp(purpose) {
  error.value = '';
  notice.value = '';
  const cleanEmail = emailInput.value.trim();
  if (!cleanEmail) {
    error.value = 'Alamat email wajib diisi terlebih dahulu.';
    return;
  }
  if (purpose === 'register') {
    if (!nameInput.value.trim()) {
      error.value = 'Nama lengkap wajib diisi.';
      return;
    }
    if (passwordInput.value.length < 6) {
      error.value = 'Kata sandi minimal 6 karakter.';
      return;
    }
    if (passwordInput.value !== confirmPasswordInput.value) {
      error.value = 'Konfirmasi kata sandi belum cocok.';
      return;
    }
  }

  loading.value = true;
  try {
    const res = await sendAuthOtp(cleanEmail, purpose);
    otpToken.value = res.otp_token;
    otpSent.value = true;
    otpCode.value = '';
    notice.value = res.message || `Kode OTP 6 digit dikirim ke ${cleanEmail}.`;
  } catch (err) {
    error.value = err.message || 'Gagal mengirim kode verifikasi ke email.';
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  error.value = '';

  if (googleProfileStep.value) {
    await handleCompleteGoogleProfile();
    return;
  }

  // Tahap 1 untuk Register Manual & Lupa Kata Sandi: kirim OTP dulu
  if (isRegister.value && !otpSent.value) {
    await handleRequestOtp('register');
    return;
  }
  if (isForgot.value && !otpSent.value) {
    await handleRequestOtp('reset');
    return;
  }

  if ((isRegister.value || isForgot.value) && passwordInput.value !== confirmPasswordInput.value) {
    error.value = 'Konfirmasi kata sandi belum cocok.';
    return;
  }
  if ((isRegister.value || isForgot.value) && otpCode.value.trim().length < 6) {
    error.value = 'Masukkan 6 digit kode verifikasi yang dikirim ke email Anda.';
    return;
  }

  loading.value = true;
  try {
    if (isForgot.value) {
      const res = await forgotPasswordAccount({
        email: emailInput.value,
        newPassword: passwordInput.value,
        confirmPassword: confirmPasswordInput.value,
        otp_code: otpCode.value.trim(),
        otp_token: otpToken.value,
      });
      const successMsg = res.message || 'Kata sandi berhasil diperbarui! Silakan masuk.';
      resetTransientState();
      passwordInput.value = '';
      confirmPasswordInput.value = '';
      emit('navigate', 'login');
      notice.value = successMsg;
    } else if (isRegister.value) {
      await registerAccount({
        name: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value,
        confirmPassword: confirmPasswordInput.value,
        lokasi_default: cityInput.value || 'Samarinda',
        otp_code: otpCode.value.trim(),
        otp_token: otpToken.value,
      });
      emit('login', { target: 'profile', isNewUser: true });
    } else {
      const result = await loginAccount(emailInput.value, passwordInput.value);
      if (result.role === 'ADMIN') {
        emit('admin');
      } else {
        emit('login', { role: result.role });
      }
    }
  } catch (err) {
    error.value = err.message || 'Email atau kata sandi tidak valid.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-shell">
    <header class="auth-header flex items-center justify-between">
      <button type="button" class="wordmark" @click="emit('cancel')">
        Polu<span>See</span><span class="brand-dot" />
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 min-h-[40px] border border-[#aeb9ae] bg-[#fafaf5] text-[#285765] text-xs font-semibold hover:border-[#285765] hover:bg-[#285765] hover:text-[#f8f8f1] transition"
        title="Kembali ke Beranda publik"
        @click="emit('cancel')"
      >
        ← Kembali ke Beranda
      </button>
    </header>
    <main class="auth-main">
      <section class="auth-story">
        <span class="eyebrow">RUANG PANTAU UDARA / POLUSEE</span>
        <h2>Udara kita.<br />Masa depan kita.</h2>
        <p>Kenali udara di sekitarmu, lindungi diri, dan jadi bagian dari perubahan yang lebih baik.</p>
        <div class="auth-art" aria-hidden="true">
          <svg viewBox="0 0 320 160" fill="none">
            <circle cx="244" cy="50" r="28" />
            <path d="M12 75h170c40 0 40-50 10-50-18 0-24 12-24 22M12 100h242c45 0 45 48 13 48-17 0-24-12-24-22M12 125h118c29 0 29 26 10 26" />
          </svg>
          <span>NAPAS KECIL. DAMPAK BESAR.</span>
        </div>
        <div class="auth-story-bottom">
          <span>01 / PANTAU</span><span>02 / PAHAMI</span><span>03 / PEDULI</span>
        </div>
      </section>

      <section class="auth-card" aria-labelledby="auth-title">
        <span class="eyebrow">
          <template v-if="googleProfileStep">LENGKAPI PROFIL GOOGLE</template>
          <template v-else-if="isForgot">PEMULIHAN KATA SANDI</template>
          <template v-else-if="isRegister">MULAI LANGKAH BAIKMU</template>
          <template v-else>SELAMAT DATANG KEMBALI</template>
        </span>
        <h1 id="auth-title">
          <template v-if="googleProfileStep">Lengkapi Profilmu.</template>
          <template v-else-if="isForgot">Atur Ulang Kata Sandi.</template>
          <template v-else-if="isRegister">Bergabung di PoluSee.</template>
          <template v-else>Masuk ke PoluSee.</template>
        </h1>
        <p>
          <template v-if="googleProfileStep">
            Email Google sudah terverifikasi. Lengkapi informasi dasar agar rekomendasi udara lebih akurat.
          </template>
          <template v-else-if="isForgot">
            Masukkan email aktif yang terdaftar. Kami akan mengirim kode verifikasi 6 digit ke email tersebut.
          </template>
          <template v-else-if="isRegister">
            Daftar cepat dengan Google atau gunakan email aktif untuk menerima kode verifikasi.
          </template>
          <template v-else>
            Pantau udara dan lanjutkan jejak kepedulianmu.
          </template>
        </p>

        <!-- Tombol Masuk / Daftar dengan Google (Tampil di Login & Register) -->
        <div v-if="!googleProfileStep && !isForgot && !otpSent" class="my-4">
          <div v-if="GOOGLE_CLIENT_ID" ref="googleBtnRef" class="w-full min-h-[44px] flex items-center justify-center" />
          <button
            v-else
            type="button"
            class="w-full min-h-[44px] flex items-center justify-center gap-2.5 border border-[#aeb9ae] bg-white px-4 py-2.5 text-sm font-semibold text-[#263b3e] hover:border-[#285765] hover:bg-[#f0f2e8] transition"
            @click="error = 'VITE_GOOGLE_CLIENT_ID belum diatur di .env.local / Vercel.'"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.8c2.2-2.1 3.6-5.1 3.6-8.8Z"/>
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-3c-1.1.7-2.5 1.2-4.2 1.2-3.2 0-6-2.2-7-5.1H1.1v3.1C3.1 21.3 7.2 24 12 24Z"/>
              <path fill="#FBBC05" d="M5 14.2c-.3-.7-.4-1.5-.4-2.2s.1-1.5.4-2.2V6.7H1.1C.4 8.3 0 10.1 0 12s.4 3.7 1.1 5.3l3.9-3.1Z"/>
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.2 0 3.1 2.7 1.1 6.7L5 9.8c1-2.9 3.8-5 7-5Z"/>
            </svg>
            <span>{{ isRegister ? 'Daftar dengan Google' : 'Masuk dengan Google' }}</span>
          </button>

          <div class="my-4 flex items-center gap-3 text-xs text-[#54615b]">
            <span class="h-px flex-1 bg-[#ced2c8]" />
            <span>atau dengan email</span>
            <span class="h-px flex-1 bg-[#ced2c8]" />
          </div>
        </div>

        <!-- Kredensial Default Cepat untuk Admin (Hanya tampil di form login) -->
        <div v-if="isLogin && !googleProfileStep" class="mb-4 border border-[#aeb9ae] bg-[#f0f2e8] p-3">
          <div class="flex items-center justify-between text-[11px] font-bold text-[#285765] tracking-wide mb-2">
            <span>Akses cepat akun demo</span>
            <span class="bg-[#edce7e] px-2 py-0.5 text-[10px] text-[#263b3e] font-semibold">Isi otomatis</span>
          </div>
          <div class="space-y-2 text-xs">
            <button
              type="button"
              @click="fillAdminCredentials"
              class="w-full flex flex-col text-left p-2.5 border border-[#aeb9ae] bg-[#fafaf5] hover:border-[#285765] hover:bg-[#f0f2e8] transition"
            >
              <div class="flex items-center justify-between font-semibold text-[#285765]">
                <span>Akun Admin</span>
                <span class="text-[11px] text-[#285765] font-normal underline">Klik isi otomatis</span>
              </div>
              <div class="mt-1 font-mono text-[11px] text-[#263b3e]">admin@polusee.id</div>
              <div class="text-[11px] text-[#54615b]">Password: <span class="font-mono font-bold text-[#285765]">admin123</span></div>
            </button>
          </div>
        </div>

        <form :key="`${mode}-${googleProfileStep}-${otpSent}`" @submit.prevent="handleSubmit">
          <!-- FORM KHUSUS LENGKAPI PROFIL GOOGLE (EMAIL OTOMATIS TERISI & TERKUNCI) -->
          <template v-if="googleProfileStep">
            <div v-if="googleAvatarPreview" class="mb-4 flex items-center gap-3 border border-[#aeb9ae] bg-[#f0f2e8] p-3">
              <img :src="googleAvatarPreview" width="44" height="44" class="h-11 w-11 rounded-full object-cover border border-[#aeb9ae]" alt="Foto Google" />
              <div class="text-xs">
                <strong class="block text-[#263b3e]">Akun Google Terverifikasi</strong>
                <span class="text-[#54615b]">{{ emailInput }}</span>
              </div>
            </div>

            <label class="form-label">
              Email (dari Google)
              <input :value="emailInput" type="email" readonly class="!bg-[#edf0e5] text-[#54615b] cursor-not-allowed" />
            </label>
            <label class="form-label">
              Nama lengkap
              <input v-model="nameInput" name="name" placeholder="Nama lengkapmu" required maxlength="100" />
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="form-label !my-2">
                Kota domisili
                <select v-model="cityInput" name="city">
                  <option value="Samarinda">Samarinda</option>
                  <option value="Balikpapan">Balikpapan</option>
                  <option value="Jakarta">Jakarta</option>
                  <option value="Bandung">Bandung</option>
                  <option value="Surabaya">Surabaya</option>
                  <option value="Yogyakarta">Yogyakarta</option>
                  <option value="Medan">Medan</option>
                  <option value="Makassar">Makassar</option>
                </select>
              </label>
              <label class="form-label !my-2">
                Umur
                <input v-model="ageInput" type="number" min="1" max="120" />
              </label>
            </div>
            <label class="form-label">
              Kelompok kesehatan
              <select v-model="groupInput">
                <option value="Umum">Umum</option>
                <option value="Penderita asma">Penderita asma</option>
                <option value="Lansia">Lansia</option>
                <option value="Orang tua dengan anak">Orang tua dengan anak</option>
              </select>
            </label>
          </template>

          <!-- FORM NORMAL: LOGIN / REGISTER OTP / RESET PASSWORD OTP -->
          <template v-else>
            <label v-if="isRegister" class="form-label">
              Nama lengkap
              <input
                v-model="nameInput"
                name="name"
                autocomplete="name"
                placeholder="Nama lengkapmu"
                :readonly="otpSent"
                required
                maxlength="100"
              />
            </label>
            <label v-if="isRegister" class="form-label">
              Kota domisili (asal)
              <select v-model="cityInput" name="city" :disabled="otpSent">
                <option value="Samarinda">Samarinda</option>
                <option value="Balikpapan">Balikpapan</option>
                <option value="Jakarta">Jakarta</option>
                <option value="Bandung">Bandung</option>
                <option value="Surabaya">Surabaya</option>
                <option value="Yogyakarta">Yogyakarta</option>
                <option value="Medan">Medan</option>
                <option value="Makassar">Makassar</option>
              </select>
            </label>

            <label class="form-label">
              {{ isForgot ? 'Email terdaftar' : 'Email aktif (Gmail / lainnya)' }}
              <input
                v-model="emailInput"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="nama@gmail.com"
                :readonly="otpSent"
                required
              />
            </label>

            <!-- Input OTP 6 Digit setelah kode dikirim (Register & Reset Password) -->
            <div v-if="(isRegister || isForgot) && otpSent" class="my-4 border border-[#285765] bg-[#f0f2e8] p-3.5">
              <label class="form-label !my-0">
                Kode Verifikasi Email (6 digit)
                <input
                  v-model="otpCode"
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="Contoh: 482910"
                  required
                  class="tracking-[0.35em] text-center font-mono text-lg font-bold"
                />
              </label>
              <div class="mt-2 flex items-center justify-between text-xs text-[#54615b]">
                <span>Berlaku 10 menit</span>
                <button
                  type="button"
                  class="font-semibold text-[#285765] underline"
                  :disabled="loading"
                  @click="handleRequestOtp(isForgot ? 'reset' : 'register')"
                >
                  Kirim ulang kode
                </button>
              </div>
            </div>

            <!-- Password tampil pada Login, Register, dan tahap 2 Forgot Password -->
            <label v-if="isLogin || isRegister || (isForgot && otpSent)" class="form-label">
              {{ isForgot ? 'Kata sandi baru' : 'Kata sandi' }}
              <div class="auth-password">
                <input
                  v-model="passwordInput"
                  name="password"
                  :type="visible ? 'text' : 'password'"
                  :autocomplete="isRegister || isForgot ? 'new-password' : 'current-password'"
                  :placeholder="isRegister || isForgot ? 'Minimal 6 karakter' : 'Masukkan kata sandi'"
                  minlength="6"
                  required
                />
                <button type="button" :aria-pressed="visible" @click="visible = !visible">
                  {{ visible ? 'Sembunyikan' : 'Tampilkan' }}
                </button>
              </div>
            </label>

            <div v-if="isLogin" class="flex justify-end -mt-3 mb-3">
              <button
                type="button"
                class="text-xs text-[#285765] hover:underline font-semibold"
                @click="navigate('forgot')"
              >
                Lupa kata sandi?
              </button>
            </div>

            <label v-if="isRegister || (isForgot && otpSent)" class="form-label">
              {{ isForgot ? 'Konfirmasi kata sandi baru' : 'Konfirmasi kata sandi' }}
              <input
                v-model="confirmPasswordInput"
                name="confirmPassword"
                :type="visible ? 'text' : 'password'"
                autocomplete="new-password"
                placeholder="Ulangi kata sandi"
                minlength="6"
                required
              />
            </label>
          </template>

          <p v-if="error" class="auth-message !bg-[#faebeb] !text-[#9b1c1c] !border !border-[#e3a0a0] !p-2.5" role="alert">
            {{ error }}
          </p>
          <p v-if="notice" class="auth-message !bg-[#eef8f2] !text-[#1f5e3d] !border !border-[#9ad4b5] !p-2.5" role="status">
            {{ notice }}
          </p>

          <button type="submit" class="primary-button auth-submit justify-center" :disabled="loading">
            <span v-if="loading">Memproses...</span>
            <span v-else-if="googleProfileStep">Simpan Profil &amp; Masuk</span>
            <span v-else-if="isForgot && !otpSent">Kirim Kode Verifikasi ke Email</span>
            <span v-else-if="isForgot && otpSent">Verifikasi &amp; Simpan Kata Sandi</span>
            <span v-else-if="isRegister && !otpSent">Kirim Kode Verifikasi Email</span>
            <span v-else-if="isRegister && otpSent">Verifikasi &amp; Buat Akun</span>
            <span v-else>Masuk ke PoluSee</span>
          </button>

          <button
            v-if="googleProfileStep || otpSent"
            type="button"
            class="mt-2.5 w-full py-2 text-xs font-semibold text-[#54615b] hover:text-[#285765] underline"
            @click="resetTransientState"
          >
            Batal / Ubah email
          </button>
        </form>

        <div v-if="!googleProfileStep" class="auth-switch">
          <template v-if="isForgot">
            Ingat kata sandi Anda?
            <button type="button" class="text-link" @click="navigate('login')">
              Masuk di sini
            </button>
          </template>
          <template v-else-if="isRegister">
            Sudah punya akun?
            <button type="button" class="text-link" @click="navigate('login')">
              Masuk di sini
            </button>
          </template>
          <template v-else>
            Belum punya akun?
            <button type="button" class="text-link" @click="navigate('register')">
              Daftar dengan email
            </button>
          </template>
        </div>
      </section>
    </main>
    <footer class="auth-footer">
      PoluSee · Ruang Pantau Udara &amp; Kesehatan
    </footer>
  </div>
</template>
