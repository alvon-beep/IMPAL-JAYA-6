import { Router } from 'express';
import {
  login,
  register,
  forgotPassword,
  sendOtp,
  googleAuth,
  completeGoogleSignup,
} from './auth.controller.js';

const router = Router();

router.post('/login', login);
router.post('/register', register);
router.post('/send-otp', sendOtp);
router.post('/google', googleAuth);
router.post('/google/complete', completeGoogleSignup);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', forgotPassword);

export default router;
