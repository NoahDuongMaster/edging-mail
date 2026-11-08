import { describe, expect, it } from 'vitest';
import { describeAgent, describeKind, describeNotice } from '../../src/client/lib/activity';
import { ApiError, errorText } from '../../src/client/lib/api';
import { domainProblem, localPartProblem } from '../../src/client/lib/admin/address';
import { adminClaim } from '../../src/client/lib/admin/claims';
import { adminErrorText, detailPairs, isStepUpRequired } from '../../src/client/lib/admin/types';

describe('address rules the admin console checks before asking the server', () => {
  it.each(['a', 'mai', 'mai.nguyen', 'sales_team', 'it-support', 'a1.b2', '0'])('accepts the local part %s', (localPart) => {
    expect(localPartProblem(localPart)).toBeNull();
  });

  it.each([
    ['', /Enter/],
    ['a'.repeat(65), /64/],
    ['Mai', /letters a to z/],
    ['a b', /letters a to z/],
    ['a@b', /letters a to z/],
    ['méo', /letters a to z/],
    ['.mai', /dot/],
    ['mai.', /dot/],
    ['mai..nguyen', /dot/]
  ])('refuses the local part %j', (localPart, message) => {
    expect(localPartProblem(localPart)).toMatch(message);
  });

  it('takes the longest local part the server takes', () => {
    expect(localPartProblem('a'.repeat(64))).toBeNull();
  });

  it.each(['example.com', 'mail.example.com', 'example.co.uk', 'xn--bcher-kva.example', 'a-b.example.org'])(
    'accepts the domain %s',
    (name) => {
      expect(domainProblem(name)).toBeNull();
    }
  );

  it.each([
    ['', /Enter a domain/],
    ['example', /full domain/],
    ['https://example.com', /only the domain/],
    ['example.com/mail', /only the domain/],
    ['example.com:8080', /only the domain/],
    ['*.example.com', /only the domain/],
    ['mai@example.com', /only the domain/],
    ['-a.example.com', /hyphen/],
    ['a-.example.com', /hyphen/],
    ['a..example.com', /hyphen/],
    [`${'a'.repeat(64)}.example.com`, /hyphen/],
    [`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`, /253/]
  ])('refuses the domain %j', (name, message) => {
    expect(domainProblem(name)).toMatch(message);
  });
});

describe('what the admin is told when a call fails', () => {
  it('shows the catalogue text of the error code, and a generic one for a code it does not know', () => {
    const fromServer = (code: string, status: number) => new ApiError(errorText(code, 'common.something_wrong'), status, code);
    expect(adminErrorText(fromServer('last_admin', 409))).toBe('There must always be one active admin');
    expect(adminErrorText(fromServer('cannot_delete_self', 409))).toBe('You cannot delete your own account');
    expect(adminErrorText(fromServer('not_a_registered_code', 500))).toBe('Something went wrong (not_a_registered_code)');
    expect(errorText(undefined, 'fail.sign_in')).toBe('Could not sign in');
  });

  it('never shows the text of an error that is not an answer of the server', () => {
    expect(adminErrorText(new Error('account auth deriver is not registered'))).toBe('Something went wrong');
    expect(adminErrorText('weird')).toBe('Something went wrong');
  });

  it('says plainly that nothing changed when the connection failed', () => {
    expect(adminErrorText(new TypeError('Failed to fetch'))).toBe('No connection: nothing was changed');
  });

  it('recognises the answer that asks for a fresh authenticator code', () => {
    expect(isStepUpRequired(new ApiError('step_up_required', 403, 'step_up_required'))).toBe(true);
    expect(isStepUpRequired(new ApiError('Forbidden', 403))).toBe(false);
    expect(isStepUpRequired(new Error('step_up_required'))).toBe(false);
  });

  it('keeps the claim about admins word for word', () => {
    expect(adminClaim().join(' ')).toBe(
      "No admin can reset another person's password, and there is no way in Edging Mail for an admin to open the mail of someone who has already signed in and set up their keys. An admin who creates an account knows its temporary password until the person first signs in, and mail that arrives before then is protected only by a server key. So create an account only when the person is ready to sign in. Admins can disable or delete accounts, re-create an address, add or move alias addresses and reset two-factor sign-in; every such change is logged, and the person is told when their two-factor sign-in is reset. Whoever holds the setup key can restore an admin's console access with a new key (that admin's old mail stays locked). Whoever controls the Cloudflare account or the deployed code could change the software."
    );
  });

  it('never shows the retired absolute claim', () => {
    const text = adminClaim().join(' ');
    expect(text).not.toMatch(/nobody can reset/i);
    expect(text).not.toMatch(/admins included/i);
    expect(text).not.toMatch(/open another person's mail/i);
  });
});

describe('audit entries and account activity', () => {
  it('lists the pairs of an audit detail, whether it arrives as an object or as JSON text', () => {
    expect(detailPairs({ from: 'member', to: 'admin' })).toEqual([
      ['from', 'member'],
      ['to', 'admin']
    ]);
    expect(detailPairs('{"from":"member","count":2}')).toEqual([
      ['from', 'member'],
      ['count', '2']
    ]);
    expect(detailPairs('not json')).toEqual([['', 'not json']]);
    expect(detailPairs('')).toEqual([]);
    expect(detailPairs(null)).toEqual([]);
    expect(detailPairs(['a'])).toEqual([]);
    expect(detailPairs('"just a string"')).toEqual([]);
  });

  it('describes a browser and a system from a user-agent string', () => {
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
    const safariMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const chromeAndroid =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(describeAgent(firefox)).toBe('Firefox on Windows');
    expect(describeAgent(safariMac)).toBe('Safari on macOS');
    expect(describeAgent(chromeAndroid)).toBe('Chrome on Android');
    expect(describeAgent(edge)).toBe('Edge on Windows');
    expect(describeAgent(safariIphone)).toBe('Safari on iOS');
    expect(describeAgent(null)).toBe('Unknown device');
    expect(describeAgent('curl/8.5.0')).toBe('Unknown device');
  });

  it('titles a sign-in or a security event', () => {
    expect(describeKind('sign_in', true)).toBe('Sign-in');
    expect(describeKind('sign_in', false)).toBe('Sign-in failed');
    expect(describeKind('password_recovered', true)).toBe('Password reset with your recovery key');
    expect(describeKind('something_new', true)).toBe('Account event: something_new');
  });

  it('writes a notice that names who did it, and what to do when it was not the owner', () => {
    const at = Date.UTC(2026, 10, 7, 9, 30);
    expect(describeNotice({ id: 1, kind: '2fa_reset', at, by: 'admin@example.com' })).toMatch(
      /reset by admin@example\.com on .*tell another admin/
    );
    expect(describeNotice({ id: 2, kind: 'password_recovered', at })).toMatch(/change your password now/);
    expect(describeNotice({ id: 3, kind: 'brand_new', at, by: null })).toMatch(/^Account event: brand_new on /);
  });
});
