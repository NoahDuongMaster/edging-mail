import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { adminDomainRoutes } from './domains';
import { adminOrgRoutes } from './org';
import { reissueRoutes } from './reissue';
import { adminActionRoutes } from './user-actions';
import { adminUserRoutes } from './users';

// Everything under /api/admin. `authenticate` (a session, no open gate) and `requireAdmin` (the admin role, no pending administrator-password
// change) run above these routes; the actions that change who can do what additionally ask for a step-up inside the route.
export const adminRoutes = new Hono<AppEnv>();
adminRoutes.route('/', adminUserRoutes);
adminRoutes.route('/', adminActionRoutes);
adminRoutes.route('/', reissueRoutes);
adminRoutes.route('/', adminDomainRoutes);
adminRoutes.route('/', adminOrgRoutes);

export { applyDueTwoFactorResets } from './user-actions';
