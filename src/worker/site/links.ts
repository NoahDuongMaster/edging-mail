/**
 * Links of the public landing page that point at the upstream project. They are collected here on purpose: a fork that keeps
 * the landing page (LANDING_PAGE=on) changes these lines and nothing else on the page. The deploy guide link is the one the
 * approved copy asks for.
 */
export const GITHUB_URL = 'https://github.com/NoahDuongMaster/edging-mail';
export const DEPLOY_GUIDE_URL = `${GITHUB_URL}/blob/main/docs/deployment.md`;
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
/** The licence as schema.org wants it: a URL that names the licence itself. */
export const MIT_LICENSE_URL = 'https://opensource.org/license/mit';

/** The signed-in app (and its shell) lives here. */
export const APP_PATH = '/app';
export const BRAND_NAME = 'Edging Mail';
export const OG_IMAGE_PATH = '/og-image.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
