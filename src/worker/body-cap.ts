import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';
import { apiError } from './errors';
import type { AppEnv } from './types';

// PX-5: no JSON body of the API is read whole before it is looked at. Hono's bodyLimit refuses a declared Content-Length over the cap at once
// and, for a body with no length (chunked), reads it in pieces and stops at the cap, so an anonymous caller cannot make the Worker hold and
// parse megabytes on a route that never needs them. The answer is the registered 413 `payload_too_large`.
//
// The largest honest body of an ordinary route is a Setup or an admin-created person with the full 20 aliases (about 8 KiB); a batch action
// names message ids (40 bytes each), so it gets a bigger cap. The three routes that take mail are left to their own checks: sending (a body
// is the whole message and its attachments), draft saving, and end-to-end sending (a streamed cap of its own, `readJsonLimited`).

export const MAX_JSON_BODY_BYTES = 16 * 1024;
export const MAX_BATCH_BODY_BYTES = 256 * 1024;

const TAKES_MAIL = /^\/api\/(?:messages\/(?:send|internal)|drafts\/[^/]+)$/;
const BATCH = '/api/messages/batch';

const refuse = bodyLimit({ maxSize: MAX_JSON_BODY_BYTES, onError: (c) => apiError(c, 'payload_too_large') });
const refuseBatch = bodyLimit({ maxSize: MAX_BATCH_BODY_BYTES, onError: (c) => apiError(c, 'payload_too_large') });

export const capBody: MiddlewareHandler<AppEnv> = (c, next) => {
  if (TAKES_MAIL.test(c.req.path)) {
    return next();
  }
  return (c.req.path === BATCH ? refuseBatch : refuse)(c, next);
};
