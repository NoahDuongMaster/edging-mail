// What the Worker adds to an answer of the static-assets layer (PX-13).

/**
 * An answer that is an error is never kept. `public/_headers` gives every path under `/assets/*` the one-year immutable Cache-Control, and the
 * assets layer applies a rule by path, not by status, so a request for a hashed file that does not exist yet (a deploy half-propagated, a typo,
 * a probe) would be answered 404 with that header, and a CDN or browser could keep "missing" for a year for a file a later deploy adds. The
 * Worker sees every miss (the request reaches it when no asset matches) and sets `no-store` on the way out; answers below 400 are left alone.
 */
export function neverKeepAnError(response: Response): Response {
  if (response.status < 400) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
