/**
 * ============================================================================
 * LAYANAN PENGIRIMAN EMAIL OTP (GMAIL SMTP / RESEND API)
 * File: backend/src/services/emailService.js
 * ============================================================================
 */

import nodemailer from 'nodemailer';

function createGmailTransporter() {
  const user = (process.env.SMTP_EMAIL || '').trim();
  const pass = (process.env.SMTP_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

function buildOtpHtml(otpCode, purpose) {
  const isReset = purpose === 'reset';
  const title = isReset ? 'Kode Reset Kata Sandi PoluSee' : 'Verifikasi Email Pendaftaran PoluSee';
  const intro = isReset
    ? 'Kami menerima permintaan untuk mengatur ulang kata sandi akun PoluSee Anda. Gunakan kode verifikasi berikut:'
    : 'Terima kasih telah mendaftar di PoluSee. Masukkan kode verifikasi berikut untuk mengaktifkan akun Anda:';

  return `<!doctype html>
<html lang="id">
<body style="margin:0;padding:24px;background:#f8f8f1;font-family:'DM Sans',Arial,sans-serif;color:#263b3e;">
  <div style="max-width:480px;margin:0 auto;background:#fafaf5;border:1px solid #263b3e;padding:28px;">
    <div style="font-size:20px;font-weight:800;color:#285765;margin-bottom:16px;">PoluSee</div>
    <h1 style="font-size:18px;margin:0 0 10px;color:#263b3e;">${title}</h1>
    <p style="font-size:14px;line-height:1.6;color:#54615b;margin:0 0 20px;">${intro}</p>
    <div style="background:#edce7e;border:1px solid #263b3e;padding:16px;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#263b3e;margin-bottom:20px;">
      ${otpCode}
    </div>
    <p style="font-size:12px;line-height:1.6;color:#54615b;margin:0;">
      Kode ini berlaku selama <strong>10 menit</strong>. Jangan bagikan kode ini kepada siapa pun. Jika Anda tidak meminta kode ini, abaikan email ini.
    </p>
  </div>
</body>
</html>`;
}

export async function sendOtpEmail(toEmail, otpCode, purpose = 'register') {
  const isReset = purpose === 'reset';
  const subject = isReset
    ? `[PoluSee] Kode Reset Kata Sandi: ${otpCode}`
    : `[PoluSee] Kode Verifikasi Pendaftaran: ${otpCode}`;
  const html = buildOtpHtml(otpCode, purpose);
  const text = `${subject}\n\nKode OTP Anda: ${otpCode}\nBerlaku selama 10 menit. Jangan bagikan kode ini kepada siapa pun.`;

  // 1. Prioritas: Gmail SMTP (Nodemailer + App Password)
  const transporter = createGmailTransporter();
  if (transporter) {
    const fromEmail = process.env.SMTP_EMAIL.trim();
    await transporter.sendMail({
      from: `"PoluSee" <${fromEmail}>`,
      to: toEmail,
      subject,
      text,
      html,
    });
    return { provider: 'gmail' };
  }

  // 2. Alternatif: Resend HTTP API jika RESEND_API_KEY diatur
  const resendKey = (process.env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    const fromAddr = (process.env.RESEND_FROM || 'PoluSee <onboarding@resend.dev>').trim();
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [toEmail],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Gagal mengirim email via Resend: ${errBody || res.status}`);
    }
    return { provider: 'resend' };
  }

  throw new Error(
    'Layanan email OTP belum dikonfigurasi. Atur SMTP_EMAIL & SMTP_APP_PASSWORD (atau RESEND_API_KEY) di .env.local / Vercel.'
  );
}
