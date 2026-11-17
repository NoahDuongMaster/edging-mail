import { describe, expect, it } from 'vitest';
import { dmarcPassed, formatAuth, ourAuthResult, parseAuthenticationResults, readAuth } from '../src/worker/spam/auth-results';
import type { HeaderLine } from '../src/worker/spam/auth-results';

// The Authentication-Results header Cloudflare Email Routing prepends, and what the filter takes from it. The header is untrusted text: another server's
// header is ignored, a hostile one costs little and never throws.

const OURS = 'mx.cloudflare.net';
const header = (value: string): HeaderLine => ({ key: 'authentication-results', value });

/** Milliseconds `work` takes. */
const seconds = (work: () => unknown): number => {
  const started = performance.now();
  work();
  return performance.now() - started;
};

describe('parseAuthenticationResults', () => {
  it('reads the simplified form of the documentation', () => {
    expect(parseAuthenticationResults(`${OURS}; spf=pass; dkim=pass; dmarc=pass`)).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  });

  it('reads a real header: comments, properties, a reason and a folded layout', () => {
    const value = [
      'mx.cloudflare.net;',
      '\tdkim=pass header.d=example.com header.s=selector header.b=IRdayjbb;',
      '\tdmarc=pass header.from=example.com policy.dmarc=reject;',
      '\tspf=none (mx.cloudflare.net: no SPF records found for postmaster@example.com) smtp.helo=smtp.example.com;',
      '\tspf=pass (mx.cloudflare.net: domain of joe@example.com designates 2a00:1440:4824:20::32e as permitted sender) smtp.mailfrom=joe@example.com;',
      '\tarc=none smtp.remote-ip=2a00:1440:4824:20::32e'
    ].join('\r\n');
    expect(parseAuthenticationResults(value)).toEqual({ spf: 'pass', dkim: 'pass', dmarc: 'pass' });
  });

  it('writes a mechanism that is not reported as none, and keeps the results that are not pass', () => {
    expect(parseAuthenticationResults(`${OURS}; dmarc=fail header.from=a.example`)).toEqual({ spf: 'none', dkim: 'none', dmarc: 'fail' });
    expect(parseAuthenticationResults(`${OURS}; spf=softfail; dkim=neutral; dmarc=temperror`)).toEqual({
      spf: 'softfail',
      dkim: 'neutral',
      dmarc: 'temperror'
    });
    expect(parseAuthenticationResults(`${OURS}; spf=permerror; dkim=policy; dmarc=none`)).toEqual({
      spf: 'permerror',
      dkim: 'policy',
      dmarc: 'none'
    });
    // no result at all is still our header
    expect(parseAuthenticationResults(`${OURS}; none`)).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
  });

  it('is case-insensitive, accepts a version after the server and spaces around the equals sign', () => {
    expect(parseAuthenticationResults('MX.Cloudflare.NET 1; SPF = PASS; DKIM =fail; DMARC= Pass')).toEqual({
      spf: 'pass',
      dkim: 'fail',
      dmarc: 'pass'
    });
  });

  it('is null for any other authserv-id, and for nothing', () => {
    for (const value of [
      'mail.example.org; spf=pass; dkim=pass; dmarc=pass',
      'mx.cloudflare.net.evil.example; dmarc=pass',
      'evil-mx.cloudflare.net; dmarc=pass',
      'notmx.cloudflare.net; dmarc=pass',
      '',
      ';',
      '(mx.cloudflare.net); dmarc=pass'
    ]) {
      expect(parseAuthenticationResults(value), value).toBeNull();
    }
  });

  it('maps a result it does not know to none and never takes a method name that only starts like one', () => {
    expect(parseAuthenticationResults(`${OURS}; spf=hardfail; dkim-adsp=pass; dmarcx=pass; xdmarc=pass`)).toEqual({
      spf: 'none',
      dkim: 'none',
      dmarc: 'none'
    });
  });

  it('lets pass win for SPF and DKIM, which may be reported more than once', () => {
    expect(parseAuthenticationResults(`${OURS}; spf=fail smtp.helo=a; spf=pass smtp.mailfrom=b; dkim=fail; dkim=pass; dkim=none`)).toEqual({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'none'
    });
    expect(parseAuthenticationResults(`${OURS}; spf=none; spf=softfail; dkim=none; dkim=fail`)).toEqual({
      spf: 'softfail',
      dkim: 'fail',
      dmarc: 'none'
    });
  });

  it('does not take a second DMARC result as a pass unless every one is a pass', () => {
    expect(parseAuthenticationResults(`${OURS}; dmarc=fail; dmarc=pass`)).toMatchObject({ dmarc: 'fail' });
    expect(parseAuthenticationResults(`${OURS}; dmarc=pass; dmarc=fail`)).toMatchObject({ dmarc: 'fail' });
    expect(parseAuthenticationResults(`${OURS}; dmarc=pass; dmarc=pass`)).toMatchObject({ dmarc: 'pass' });
  });

  it('does not read a result that sits inside a comment or a quoted string', () => {
    expect(parseAuthenticationResults(`${OURS}; dmarc=fail (note; dmarc=pass; spf=pass)`)).toEqual({
      spf: 'none',
      dkim: 'none',
      dmarc: 'fail'
    });
    expect(parseAuthenticationResults(`${OURS}; dmarc=fail reason="x; dmarc=pass; spf=pass"; dkim=none`)).toEqual({
      spf: 'none',
      dkim: 'none',
      dmarc: 'fail'
    });
    // an escaped parenthesis does not end the comment, an escaped quote does not end the string
    expect(parseAuthenticationResults(String.raw`${OURS}; dmarc=fail (a \) ; dmarc=pass ) ; spf=none`)).toEqual({
      spf: 'none',
      dkim: 'none',
      dmarc: 'fail'
    });
    expect(parseAuthenticationResults(String.raw`${OURS}; dmarc=fail reason="a \" ; dmarc=pass ; "`)).toEqual({
      spf: 'none',
      dkim: 'none',
      dmarc: 'fail'
    });
  });

  describe('a hostile header', () => {
    it('an unterminated quote or comment runs to the end and reads nothing after it', () => {
      expect(parseAuthenticationResults(`${OURS}; dmarc=fail; reason="never closed; dmarc=pass; spf=pass`)).toEqual({
        spf: 'none',
        dkim: 'none',
        dmarc: 'fail'
      });
      expect(parseAuthenticationResults(`${OURS}; dmarc=fail; (never closed; dmarc=pass; spf=pass`)).toEqual({
        spf: 'none',
        dkim: 'none',
        dmarc: 'fail'
      });
    });

    it('a huge value is cut and read in a moment', () => {
      const big = `${OURS}; dmarc=fail; ${'x'.repeat(5_000_000)}; dmarc=pass`;
      const started = performance.now();
      const answer = parseAuthenticationResults(big);
      expect(performance.now() - started).toBeLessThan(200);
      expect(answer).toEqual({ spf: 'none', dkim: 'none', dmarc: 'fail' });
      // the result that comes after the cut is not read
      expect(parseAuthenticationResults(`${OURS}; ${' '.repeat(20_000)}dmarc=pass`)).toEqual({ spf: 'none', dkim: 'none', dmarc: 'none' });
    });

    it('a huge number of segments, of parentheses and of quotes stay cheap and never throw', () => {
      const hostile = [
        `${OURS}${'; spf=pass'.repeat(100_000)}`,
        `${OURS}; ${'('.repeat(100_000)}dmarc=pass`,
        `${OURS}; ${'(a'.repeat(50_000)}`,
        `${OURS}; ${'"'.repeat(100_000)}`,
        `${OURS}; ${'\\'.repeat(100_000)}`,
        `${OURS}; ${'= ='.repeat(50_000)}`,
        `${OURS}; ${'a'.repeat(16_000)}=pass`
      ];
      for (const value of hostile) {
        expect(
          seconds(() => parseAuthenticationResults(value)),
          value.slice(0, 20)
        ).toBeLessThan(200);
      }
      // too deep a comment is given up on: nothing after it counts as ours
      expect(parseAuthenticationResults(`${OURS}; dmarc=fail; ${'('.repeat(100)} ; dmarc=pass`)).toEqual({
        spf: 'none',
        dkim: 'none',
        dmarc: 'fail'
      });
    });

    it('control characters and non-text do not throw', () => {
      for (const value of ['\u0000', `${OURS};\u0000dmarc=pass`, `${OURS}; dmarc=pa\u0000ss`, '\uD800', `${OURS}; \uD800dmarc=pass`]) {
        expect(() => parseAuthenticationResults(value), value).not.toThrow();
      }
    });
  });
});

describe('ourAuthResult: only the FIRST Authentication-Results header counts, and only when it is Cloudflare', () => {
  const pass = `${OURS}; spf=pass; dkim=pass; dmarc=pass`;

  it('reads our header when it comes first, whatever follows it', () => {
    expect(ourAuthResult([header(pass), header('mail.example.org; dmarc=fail'), header(`${OURS}; dmarc=fail`)])).toEqual({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass'
    });
  });

  it('ignores our server name when the sender wrote it in a header BELOW the first one (the first is not ours: no result)', () => {
    expect(ourAuthResult([header('mail.example.org; dmarc=pass'), header(pass)])).toBeNull();
    expect(ourAuthResult([{ key: 'received', value: 'from x' }, header('forged.example; dmarc=pass'), header(pass)])).toBeNull();
  });

  it('does not count a header whose name only looks like it, or none at all', () => {
    expect(ourAuthResult([{ key: 'x-authentication-results', value: pass }])).toBeNull();
    expect(ourAuthResult([{ key: 'arc-authentication-results', value: `i=1; ${pass}` }])).toBeNull();
    expect(ourAuthResult([{ key: 'authentication-results ', value: pass }])).toBeNull();
    expect(ourAuthResult([])).toBeNull();
  });

  it('takes the first one even when other headers come before it', () => {
    expect(
      ourAuthResult([{ key: 'received', value: 'from a' }, { key: 'received', value: 'from b' }, header(`${OURS}; dmarc=fail`)])
    ).toMatchObject({
      dmarc: 'fail'
    });
  });
});

describe('the stored form', () => {
  it('is exactly spf=<r>;dkim=<r>;dmarc=<r> and reads back', () => {
    const result = { spf: 'pass', dkim: 'none', dmarc: 'fail' } as const;
    expect(formatAuth(result)).toBe('spf=pass;dkim=none;dmarc=fail');
    expect(readAuth('spf=pass;dkim=none;dmarc=fail')).toEqual(result);
  });

  it('reads anything that is not exactly that as no result', () => {
    for (const value of [
      null,
      undefined,
      '',
      'dmarc=pass',
      'spf=pass;dkim=pass',
      'spf=pass;dkim=pass;dmarc=bogus',
      ' spf=pass;dkim=pass;dmarc=pass',
      'spf=pass; dkim=pass; dmarc=pass'
    ]) {
      expect(readAuth(value), String(value)).toBeNull();
    }
  });

  it('says dmarc passed only for dmarc=pass', () => {
    expect(dmarcPassed('spf=none;dkim=none;dmarc=pass')).toBe(true);
    for (const value of [
      null,
      'spf=pass;dkim=pass;dmarc=none',
      'spf=pass;dkim=pass;dmarc=fail',
      'dmarc=pass',
      'spf=pass;dkim=pass;dmarc=pass;x=y'
    ]) {
      expect(dmarcPassed(value), String(value)).toBe(false);
    }
  });
});
