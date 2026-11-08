// Headers of every page the Worker builds itself. public/_headers only reaches static files, never a Worker response, so
// the same intent is set here: stricter than the app's policy (no Google Fonts, no remote images, no remote connections).

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

/** Security headers for a page answered on `url`. HSTS only over https: browsers ignore it over http and local dev is http. */
export function securityHeaders(url: URL): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
  if (url.protocol === 'https:') {
    headers['Strict-Transport-Security'] = 'max-age=15552000; includeSubDomains';
  }
  return headers;
}

/** A response with its headers; a HEAD request gets the same headers and no body. */
export function respond(request: Request, body: string, status: number, headers: Record<string, string>): Response {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

/**
 * A redirect that must never be cached or stored by anything (it depends on the session or on the LANDING_PAGE setting).
 * The query string is kept: a notification link is `/?m=<message id>`.
 */
export function redirect(url: URL, path: string, status: 302 | 308): Response {
  return new Response(null, { status, headers: { Location: `${path}${url.search}`, 'Cache-Control': 'no-store' } });
}

/** A plain 404 for paths the site does not serve (never a copy of the app shell). */
export function notFound(request: Request, url: URL): Response {
  return respond(request, 'Not found\n', 404, {
    ...securityHeaders(url),
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Robots-Tag': 'noindex'
  });
}

export function methodNotAllowed(url: URL): Response {
  return new Response('Method not allowed\n', {
    status: 405,
    headers: { ...securityHeaders(url), Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
