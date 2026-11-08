import { describe, expect, it } from 'vitest';
import { call } from './helpers';

// PX-13: public/_headers gives /assets/* a one-year immutable Cache-Control, and the assets layer applies a rule by path, not by status. The
// Worker (which sees every request that matches no asset) must not let an error answer keep that header.

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The assets layer as the real one behaves for this rule: the header follows the path, hit or miss. */
function assetsLayer(files: Partial<Record<string, string>>, answer?: (path: string) => Response | undefined): Fetcher {
  return {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(new Request(input, init).url).pathname;
      const special = answer?.(path);
      if (special !== undefined) {
        return Promise.resolve(special);
      }
      const body = files[path];
      const headers = new Headers(path.startsWith('/assets/') ? { 'Cache-Control': IMMUTABLE } : {});
      return Promise.resolve(new Response(body ?? null, { status: body === undefined ? 404 : 200, headers }));
    }
  } as unknown as Fetcher;
}

describe('a miss under /assets/ is never cached (PX-13)', () => {
  const files = { '/assets/app-3f9c1a.js': 'console.log(1)', '/favicon.svg': '<svg/>' };

  it('answers 404 with no-store for a hashed file that does not exist, although the layer put the immutable header on it', async () => {
    const answer = await call('/assets/app-000000.js', { env: { ASSETS: assetsLayer(files) } });
    expect(answer.status).toBe(404);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(answer.headers.get('Cache-Control')).not.toMatch(/immutable|max-age/);
  });

  it('keeps the immutable header on a file that exists, and says nothing about caching for one without a rule', async () => {
    const hit = await call('/assets/app-3f9c1a.js', { env: { ASSETS: assetsLayer(files) } });
    expect([hit.status, hit.text, hit.headers.get('Cache-Control')]).toEqual([200, 'console.log(1)', IMMUTABLE]);
    const plain = await call('/favicon.svg', { env: { ASSETS: assetsLayer(files) } });
    expect([plain.status, plain.headers.get('Cache-Control')]).toEqual([200, null]);
  });

  it('treats a miss anywhere, a deeper path and a server error the same way; leaves a redirect alone', async () => {
    const env = {
      ASSETS: assetsLayer(files, (path) =>
        path === '/assets/broken.js'
          ? new Response('boom', { status: 500, headers: { 'Cache-Control': IMMUTABLE } })
          : path === '/assets/moved'
            ? new Response(null, { status: 307, headers: { Location: '/assets/app-3f9c1a.js', 'Cache-Control': IMMUTABLE } })
            : undefined
      )
    };
    for (const path of ['/nothing-here', '/assets/deep/er/gone.css', '/assets/broken.js']) {
      const answer = await call(path, { env });
      expect([path, answer.headers.get('Cache-Control')]).toEqual([path, 'no-store']);
    }
    const broken = await call('/assets/broken.js', { env });
    expect([broken.status, broken.text]).toEqual([500, 'boom']);
    const moved = await call('/assets/moved', { env });
    expect([moved.status, moved.headers.get('Location'), moved.headers.get('Cache-Control')]).toEqual([
      307,
      '/assets/app-3f9c1a.js',
      IMMUTABLE
    ]);
  });

  it('keeps the other headers of the layer on a miss (its security headers survive)', async () => {
    const env = {
      ASSETS: assetsLayer(
        {},
        () => new Response(null, { status: 404, headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': IMMUTABLE } })
      )
    };
    const answer = await call('/assets/gone.js', { env });
    expect([answer.status, answer.headers.get('X-Content-Type-Options'), answer.headers.get('Cache-Control')]).toEqual([
      404,
      'nosniff',
      'no-store'
    ]);
  });
});
