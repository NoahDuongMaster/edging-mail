import type { Env } from '../types';
import { copyEn } from './copy.en';
import type { LandingCopy } from './copy.types';
import { copyVi } from './copy.vi';
import { copyZh } from './copy.zh';
import { methodNotAllowed, notFound, redirect, respond, securityHeaders } from './headers';
import { renderLanding } from './landing';
import { APP_PATH } from './links';
import { robotsTxt, sitemapXml } from './seo';

/**
 * What the site needs from the Worker's bindings: the static assets (for the app shell) and the LANDING_PAGE switch. `Env`
 * fits, and a test passes just these two.
 */
export type SiteEnv = Pick<Env, 'ASSETS' | 'LANDING_PAGE'>;

/**
 * The landing page is on only when LANDING_PAGE is "on" (case and surrounding spaces do not matter). Unset, "off" or anything
 * else leaves it off: a fork that forgets the variable does not publish the maintainer's marketing page.
 */
export const landingEnabled = (env: SiteEnv): boolean => env.LANDING_PAGE?.trim().toLowerCase() === 'on';

type Route = 'home' | 'page' | 'redirect' | 'app' | 'robots' | 'sitemap';

// The Vietnamese page lives at "/" (with its session redirect); the other languages live under their own folder, and the
// folder name without its slash answers with a permanent redirect to it.
const PAGES = new Map<string, LandingCopy>([copyEn, copyZh].map((copy) => [copy.path, copy]));
const FOLDER_REDIRECTS = new Map<string, string>([copyEn, copyZh].map((copy) => [copy.path.slice(0, -1), copy.path]));

const routeOf = (pathname: string): Route | undefined => {
  if (pathname === '/') {
    return 'home';
  }
  if (PAGES.has(pathname)) {
    return 'page';
  }
  if (FOLDER_REDIRECTS.has(pathname)) {
    return 'redirect';
  }
  if (pathname === '/robots.txt') {
    return 'robots';
  }
  if (pathname === '/sitemap.xml') {
    return 'sitemap';
  }
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`) ? 'app' : undefined;
};

// A broken session lookup must not take the public page down: the visitor gets the landing page, which shows no private data.
async function hasSession(signedIn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await signedIn();
  } catch (error) {
    console.error('[edging-mail] site: session check failed, answering as signed out', error);
    return false;
  }
}

// A landing page is never stored by the service worker as the app shell. Cache.put() refuses a response whose Vary header
// holds "*", and the older worker (cache edging-mail-v2, shell key "/") swallows that refusal; without it, a visit to "/"
// or "/en/" would replace the cached app shell with this page. "*" also covers the cookie that "/" depends on.
const landingPage = (request: Request, url: URL, copy: LandingCopy, cacheControl: string): Response =>
  respond(request, renderLanding(copy, url.origin), 200, {
    ...securityHeaders(url),
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cacheControl,
    Vary: '*'
  });

const textFile = (request: Request, url: URL, body: string, contentType: string): Response =>
  respond(request, body, 200, { ...securityHeaders(url), 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });

// The app shell is index.html from the static assets, whatever the path under /app: the app has one screen tree and reads
// its own state. Search engines are told to skip it (index.html says so too). undefined when there is no build to serve.
async function appShell(request: Request, env: SiteEnv): Promise<Response | undefined> {
  if (env.ASSETS === undefined) {
    return undefined;
  }
  const asset = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  if (!asset.ok && asset.status !== 304) {
    return asset;
  }
  const response = new Response(asset.body, asset);
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

/**
 * The public site: the landing pages (`/` in Vietnamese, `/en/` in English, `/zh/` in Chinese), robots.txt, sitemap.xml and the app shell at
 * `/app` and below. Returns the Response for a path it owns and undefined for every other path, which then falls through to
 * the static assets (see `fetch` in ../index.ts). `/api/*` never gets here.
 *
 * `signedIn` answers "does this request carry a real session?" (decided by D1, not by the mere presence of a cookie). It is
 * asked only for "/" with the landing page on; with it off, "/" always goes to the app.
 */
export async function handleSite(
  request: Request,
  env: SiteEnv,
  _ctx: ExecutionContext,
  signedIn: () => Promise<boolean>
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const route = routeOf(url.pathname);
  if (route === undefined) {
    return undefined;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowed(url);
  }
  const landing = landingEnabled(env);
  if (route === 'app') {
    return appShell(request, env);
  }
  if (route === 'robots') {
    return textFile(request, url, robotsTxt(url.origin, landing), 'text/plain; charset=utf-8');
  }
  if (!landing) {
    return route === 'home' ? redirect(url, APP_PATH, 302) : notFound(request, url);
  }
  if (route === 'home') {
    return (await hasSession(signedIn)) ? redirect(url, APP_PATH, 302) : landingPage(request, url, copyVi, 'private, no-cache');
  }
  if (route === 'redirect') {
    return redirect(url, FOLDER_REDIRECTS.get(url.pathname) ?? APP_PATH, 308);
  }
  if (route === 'page') {
    const copy = PAGES.get(url.pathname);
    return copy === undefined ? notFound(request, url) : landingPage(request, url, copy, 'no-cache');
  }
  return textFile(request, url, sitemapXml(url.origin), 'application/xml; charset=utf-8');
}
