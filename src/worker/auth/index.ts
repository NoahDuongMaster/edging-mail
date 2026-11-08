import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { credentialRoutes } from './credentials';
import { forgotRoutes } from './forgot';
import { loginRoutes } from './login';
import { noticeRoutes } from './notices';
import { setupRoutes } from './setup';
import { twoFactorRoutes } from './two-factor';

// Everything under /api/auth. Which of these need a session is decided by `authenticate` (middleware.ts), registered above all routes.
export const authRoutes = new Hono<AppEnv>();
authRoutes.route('/', loginRoutes);
authRoutes.route('/', setupRoutes);
authRoutes.route('/', credentialRoutes);
authRoutes.route('/', twoFactorRoutes);
authRoutes.route('/', forgotRoutes);
authRoutes.route('/', noticeRoutes);

export { keyRoutes } from './key-routes';
export { authenticate, requireAdmin, requireStepUp } from './middleware';
export { verifiedUser } from './session';
