import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { isHostname } from '../addresses';
import { auditEntry } from '../audit';
import { batchChanges, errorMessage, getDb } from '../db';
import { addresses, domains } from '../db/schema';
import { currentUser } from '../auth/middleware';
import { apiError } from '../errors';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';

// /api/admin/domains: the mail domains this installation serves, and the DNS check next to them. A domain cannot be removed while an address
// (primary or alias) still uses it.

export const adminDomainRoutes = new Hono<AppEnv>();

const usedBy = sql`(SELECT COUNT(*) FROM ${addresses} WHERE substr(${addresses.address}, instr(${addresses.address}, '@') + 1) = ${domains.name})`;

adminDomainRoutes.get('/domains', async (c) => {
  const rows = await getDb(c.env.DB)
    .select({ id: domains.id, name: domains.name, created_at: domains.created_at, addresses_count: sql<number>`${usedBy}` })
    .from(domains)
    .orderBy(asc(domains.name));
  return c.json({ success: true, domains: rows });
});

adminDomainRoutes.post('/domains', async (c) => {
  const body = await jsonObject<{ name?: unknown }>(c.req, ['name']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!isHostname(name)) {
    return apiError(c, 'invalid_hostname');
  }
  const db = getDb(c.env.DB);
  const actor = currentUser(c);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      db.insert(domains).values({ id, name, created_at: now }),
      auditEntry(db, { id: actor.id, email: actor.email }, 'domain.add', name)
    ]);
  } catch (error) {
    if (errorMessage(error).includes('UNIQUE') || errorMessage(error).includes('constraint')) {
      return apiError(c, 'domain_exists');
    }
    console.error('[edging-mail] Domain add failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
  return c.json({ success: true, domain: { id, name, created_at: now, addresses_count: 0 } }, 201);
});

adminDomainRoutes.delete('/domains/:id', async (c) => {
  const db = getDb(c.env.DB);
  const actor = currentUser(c);
  const domain = await db
    .select()
    .from(domains)
    .where(eq(domains.id, c.req.param('id')))
    .get();
  if (domain === undefined) {
    return apiError(c, 'domain_not_found');
  }
  // The "no address uses it" condition is part of the DELETE, so an address created at the same moment cannot be orphaned.
  const [removed] = await batchChanges(db, [db.delete(domains).where(and(eq(domains.id, domain.id), sql`${usedBy} = 0`))]);
  if (removed !== 1) {
    const used = await db
      .select({
        n: sql<number>`(SELECT COUNT(*) FROM ${addresses} WHERE substr(${addresses.address}, instr(${addresses.address}, '@') + 1) = ${domain.name})`
      })
      .from(domains)
      .get();
    return apiError(c, 'domain_in_use', { error: `This domain is used by ${used?.n ?? 'some'} address(es). Remove or move them first.` });
  }
  await db.batch([auditEntry(db, { id: actor.id, email: actor.email }, 'domain.remove', domain.name)]);
  return c.json({ success: true });
});

// --- DNS check (DNS over HTTPS from the Worker) ---

const DOH = 'https://cloudflare-dns.com/dns-query';
const LOOKUP_TIMEOUT_MS = 5000;
const CLOUDFLARE_MX = /(?:^|\.)mx\.cloudflare\.net\.?$/i;

interface DnsAnswer {
  Status?: number;
  Answer?: { type: number; data: string }[];
}

/** The `data` of the records of one type, or throws when the lookup itself failed (never reported as "not found"). */
async function lookup(name: string, type: 'MX' | 'TXT'): Promise<string[]> {
  const url = `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`DNS answered HTTP ${response.status}`);
  }
  const answer = await response.json<DnsAnswer>();
  // 0 = NOERROR (possibly with no records), 3 = NXDOMAIN (the name has none); anything else is a failed lookup
  if (answer.Status !== 0 && answer.Status !== 3) {
    throw new Error(`DNS status ${answer.Status ?? 'unknown'}`);
  }
  const wanted = type === 'MX' ? 15 : 16;
  return (answer.Answer ?? []).filter((record) => record.type === wanted).map((record) => record.data);
}

const unquote = (txt: string): string => txt.replaceAll(/"\s*"/g, '').replaceAll('"', '');
const parseMx = (data: string): { priority: number; host: string } => {
  const parts = data.trim().split(/\s+/);
  return { priority: Number.parseInt(parts[0], 10), host: (parts.at(1) ?? '').replace(/\.$/, '').toLowerCase() };
};

// Receiving is ready when the domain's MX records are Cloudflare Email Routing's. Sending is ready when the records Email Sending adds on the
// `cf-bounce.` subdomain exist (MX for bounces, SPF, DKIM at cf-bounce._domainkey); DMARC on _dmarc is reported but not required.
// Source: https://developers.cloudflare.com/email-service/configuration/domains/ (the "DNS record configuration details" section).
adminDomainRoutes.get('/domains/:id/check', async (c) => {
  const db = getDb(c.env.DB);
  const domain = await db
    .select()
    .from(domains)
    .where(eq(domains.id, c.req.param('id')))
    .get();
  if (domain === undefined) {
    return apiError(c, 'domain_not_found');
  }
  const name = domain.name;
  try {
    const [rootMx, bounceMx, bounceTxt, dkimTxt, dmarcTxt] = await Promise.all([
      lookup(name, 'MX'),
      lookup(`cf-bounce.${name}`, 'MX'),
      lookup(`cf-bounce.${name}`, 'TXT'),
      lookup(`cf-bounce._domainkey.${name}`, 'TXT'),
      lookup(`_dmarc.${name}`, 'TXT')
    ]);
    const mx = rootMx.map(parseMx).toSorted((a, b) => a.priority - b.priority);
    const viaCloudflare = mx.length > 0 && mx.every((record) => CLOUDFLARE_MX.test(record.host));
    // RFC 7505: a null MX ("0 .", which parseMx turns into an empty host) says the domain accepts no mail. It is not a host to name.
    const nullMx = mx.some((record) => record.host === '');
    const hosts = [...new Set(mx.map((record) => record.host).filter((host) => host !== ''))];
    const bounceReady = bounceMx.map(parseMx).some((record) => CLOUDFLARE_MX.test(record.host));
    const spfReady = bounceTxt.map(unquote).some((text) => /^v=spf1\b/i.test(text) && text.includes('_spf.mx.cloudflare.net'));
    const dkimReady = dkimTxt.map(unquote).some((text) => /\bp=/.test(text) || /v=DKIM1/i.test(text));
    const dmarcFound = dmarcTxt.map(unquote).some((text) => /^v=DMARC1\b/i.test(text));
    const state = viaCloudflare ? 'ready' : nullMx ? 'null_mx' : mx.length === 0 ? 'no_records' : 'other_provider';
    let receivingNote = `The MX records point to ${hosts.join(', ')}, not to Cloudflare Email Routing.`;
    if (viaCloudflare) {
      receivingNote = "The MX records are Cloudflare Email Routing's.";
    } else if (nullMx) {
      receivingNote =
        'The domain publishes a null MX record (RFC 7505), so it accepts no mail: replace it with the MX records of Cloudflare Email Routing.';
    } else if (mx.length === 0) {
      receivingNote = 'The domain has no MX records.';
    }
    return c.json({
      success: true,
      domain: name,
      checked_at: Date.now(),
      receiving: {
        ready: viaCloudflare,
        via_cloudflare: viaCloudflare,
        state,
        mx,
        note: receivingNote
      },
      sending: {
        ready: bounceReady && spfReady && dkimReady,
        records: [
          { type: 'MX', name: `cf-bounce.${name}`, purpose: 'bounce', found: bounceReady, required: true },
          { type: 'TXT', name: `cf-bounce.${name}`, purpose: 'spf', found: spfReady, required: true },
          { type: 'TXT', name: `cf-bounce._domainkey.${name}`, purpose: 'dkim', found: dkimReady, required: true },
          { type: 'TXT', name: `_dmarc.${name}`, purpose: 'dmarc', found: dmarcFound, required: false }
        ],
        note:
          bounceReady && spfReady && dkimReady
            ? 'The Email Sending records are in place.'
            : 'Some Email Sending records are missing: onboard the domain in Compute > Email Service > Email Sending.'
      }
    });
  } catch (error) {
    // A failed lookup is never shown as "ready" or as "not ready": it is a failed lookup.
    console.error('[edging-mail] DNS check failed:', errorClass(error));
    return apiError(c, 'dns_lookup_failed');
  }
});
