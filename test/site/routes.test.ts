import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleSite, landingEnabled, type SiteEnv } from '../../src/worker/site';

// handleSite is pure: it only needs a Request, the two bindings it reads and the session callback. No Worker, no D1.

const ORIGIN = 'https://mail.example.com';
const ctx = createExecutionContext();

function fakeAssets(): { assets: Fetcher; requested: string[] } {
  const requested: string[] = [];
  const assets = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(new URL(new Request(input, init).url).pathname);
      return Promise.resolve(
        new Response('<!doctype html><div id="root"></div>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'" }
        })
      );
    }
  } as unknown as Fetcher;
  return { assets, requested };
}

interface Call {
  env?: SiteEnv;
  signedIn?: boolean | (() => Promise<boolean>);
  method?: string;
}

function call(path: string, { env = { LANDING_PAGE: 'on' }, signedIn = false, method = 'GET' }: Call = {}): Promise<Response | undefined> {
  const session = typeof signedIn === 'function' ? signedIn : () => Promise.resolve(signedIn);
  return handleSite(new Request(`${ORIGIN}${path}`, { method }), env, ctx, session);
}

describe('LANDING_PAGE switch', () => {
  it.each([
    ['on', true],
    ['ON', true],
    ['  On ', true],
    ['off', false],
    ['', false],
    ['true', false],
    ['1', false],
    ['onn', false],
    [undefined, false]
  ])('%j -> %s', (value, expected) => {
    expect(landingEnabled({ LANDING_PAGE: value })).toBe(expected);
  });
});

describe('landing page ON', () => {
  it('serves the Vietnamese landing at / for a signed-out visitor', async () => {
    const response = await call('/');
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response?.text()).toContain('<html lang="vi">');
  });

  it('redirects / to /app for a real session and keeps the query (notification links are /?m=<id>)', async () => {
    const response = await call('/?m=abc', { signedIn: true });
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe('/app?m=abc');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('treats a failing session check as signed out', async () => {
    const response = await call('/', { signedIn: () => Promise.reject(new Error('D1 is down')) });
    expect(response?.status).toBe(200);
  });

  it('serves the English landing at /en/ even for a signed-in visitor', async () => {
    const response = await call('/en/', { signedIn: true });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain('<html lang="en">');
  });

  it('serves the Chinese landing at /zh/ even for a signed-in visitor', async () => {
    const response = await call('/zh/', { signedIn: true });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain('<html lang="zh-CN">');
  });

  it.each([
    ['/en?x=1', '/en/?x=1'],
    ['/zh?x=1', '/zh/?x=1'],
    ['/zh', '/zh/']
  ])('sends %s to %s with a permanent redirect', async (path, location) => {
    const response = await call(path);
    expect(response?.status).toBe(308);
    expect(response?.headers.get('Location')).toBe(location);
  });

  it('answers sitemap.xml and robots.txt', async () => {
    const sitemap = await call('/sitemap.xml');
    expect(sitemap?.status).toBe(200);
    expect(sitemap?.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    const robots = await call('/robots.txt');
    expect(robots?.status).toBe(200);
    expect(await robots?.text()).toBe(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  });

  it('never lets a landing page be stored as the app shell (Cache.put() refuses Vary: *)', async () => {
    for (const path of ['/', '/en/', '/zh/']) {
      const response = await call(path);
      expect(response?.headers.get('Vary')).toBe('*');
      expect(response?.headers.get('Cache-Control')).toMatch(/no-cache/);
    }
  });
});

describe('landing page OFF (unset, "off" or anything that is not "on")', () => {
  const unset: SiteEnv = {};
  const garbage: SiteEnv = { LANDING_PAGE: 'yes please' };

  it.each([unset, { LANDING_PAGE: 'off' }, garbage])('sends / straight to /app without asking for a session (%j)', async (env) => {
    let asked = false;
    const response = await call('/?m=7', {
      env,
      signedIn: () => {
        asked = true;
        return Promise.resolve(true);
      }
    });
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe('/app?m=7');
    expect(asked).toBe(false);
  });

  it.each(['/en', '/en/', '/zh', '/zh/', '/sitemap.xml'])('answers %s with a plain 404 that is not indexed', async (path) => {
    const response = await call(path, { env: unset });
    expect(response?.status).toBe(404);
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(await response?.text()).toBe('Not found\n');
  });

  it('disallows everything in robots.txt and names no sitemap', async () => {
    const response = await call('/robots.txt', { env: unset });
    expect(await response?.text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('leaves /app alone', async () => {
    const { assets } = fakeAssets();
    const response = await call('/app', { env: { ASSETS: assets } });
    expect(response?.status).toBe(200);
  });
});

describe('/app', () => {
  it.each(['/app', '/app/', '/app/settings/account'])('serves the shell for %s, not indexed', async (path) => {
    const { assets, requested } = fakeAssets();
    const response = await call(path, { env: { ASSETS: assets, LANDING_PAGE: 'on' } });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toContain('id="root"');
    expect(response?.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    // The headers of the asset layer (its own _headers rules) survive.
    expect(response?.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(requested).toEqual(['/']);
  });

  it('leaves the request to the Worker when there is no build to serve', async () => {
    expect(await call('/app', { env: {} })).toBeUndefined();
  });
});

describe('paths the site does not own', () => {
  it.each([
    '/api/health',
    '/api',
    '/apple-touch-icon.png',
    '/application',
    '/sw.js',
    '/assets/index.js',
    '/en/x',
    '/EN/',
    '/zh/x',
    '/ZH/',
    '/zh-CN/',
    '/index.html',
    '/nope'
  ])('returns undefined for %s so the static assets answer', async (path) => {
    expect(await call(path)).toBeUndefined();
  });

  it('answers any other method on its own paths with 405', async () => {
    for (const path of ['/', '/en/', '/zh/', '/app', '/robots.txt', '/sitemap.xml']) {
      const response = await call(path, { method: 'POST' });
      expect(response?.status).toBe(405);
      expect(response?.headers.get('Allow')).toBe('GET, HEAD');
    }
  });

  it('answers HEAD with the headers of GET and no body', async () => {
    const response = await call('/en/', { method: 'HEAD' });
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response?.text()).toBe('');
  });
});
