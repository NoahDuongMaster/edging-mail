import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DnsResult } from '../../src/client/components/admin/DomainsPanel';
import { PersonStatus, PersonTwoFactor } from '../../src/client/components/admin/adminUi';
import { describeAgent, describeKind, describeNotice } from '../../src/client/lib/activity';
import { ApiError, errorText } from '../../src/client/lib/api';
import { domainProblem, localPartProblem } from '../../src/client/lib/admin/address';
import { adminClaim } from '../../src/client/lib/admin/claims';
import { adminErrorText, detailLine, detailPairs, isStepUpRequired } from '../../src/client/lib/admin/types';
import type { AdminUser, DnsCheck } from '../../src/client/lib/admin/types';
import { tr } from '../../src/client/lib/i18n';

const dnsAnswer = (mx: DnsCheck['receiving']['mx']): DnsCheck => ({
  domain: 'example.com',
  checked_at: Date.UTC(2026, 10, 8, 10, 0),
  receiving: { ready: false, via_cloudflare: false, mx, note: '' },
  sending: {
    ready: false,
    records: [
      { type: 'MX', name: 'cf-bounce.example.com', found: true, required: true },
      { type: 'TXT', name: 'cf-bounce._domainkey.example.com', found: false, required: true },
      { type: 'TXT', name: '_dmarc.example.com', found: false, required: false }
    ],
    note: ''
  }
});
const renderDns = (check: DnsCheck): string => renderToStaticMarkup(createElement(DnsResult, { check }));

// The MX hosts are rows of the receiving step of the DNS checklist (before the sending step): the type, the host name, its priority.
const mxRows = (html: string): string[] =>
  [
    ...(html.split(`aria-label="${tr('domains.sending')}"`)[0] ?? '').matchAll(
      /<li class="ad-record"><span class="ad-rtype">MX<\/span><span class="ad-record-name" translate="no">([^<]*)<\/span>/g
    )
  ].map((match) => match[1]);

describe('the DNS answer of a domain', () => {
  it('says that a null MX (RFC 7505, "0 .") accepts no mail, and lists no empty host', () => {
    const html = renderDns(dnsAnswer([{ priority: 0, host: '' }]));
    expect(html).toContain(tr('domains.note_mx_null'));
    expect(html).not.toContain('point to');
    expect(mxRows(html)).toEqual([]);
    // Nor "No MX records found": the domain has one, and it says something.
    expect(html).not.toContain(tr('domains.no_mx'));
  });

  it('still names the hosts of another provider, and only them', () => {
    const html = renderDns(dnsAnswer([{ priority: 10, host: 'mx.other.example' }]));
    expect(html).toContain(tr('domains.note_mx_other', { hosts: 'mx.other.example' }));
    expect(mxRows(html)).toEqual(['mx.other.example']);
    expect(html).toContain(tr('domains.mx_priority', { priority: 10 }));
  });

  it('shows found and missing records of Email Sending as different badges with words: success, danger, warning when not required', () => {
    const html = renderDns(dnsAnswer([]));
    const badges = [...html.matchAll(/<span class="ui-badge" data-tone="(\w+)">[\s\S]*?<\/span>/g)].map((match) => match[1]);
    // Receiving and sending not ready (danger), then the three records, what is missing first: required (danger), optional (warning), found.
    expect(badges).toEqual(['danger', 'danger', 'danger', 'warning', 'success']);
    expect(html).toContain(tr('domains.record_ok'));
    expect(html.match(new RegExp(tr('domains.record_absent'), 'g'))).toHaveLength(2);
  });

  it('puts the step that does not work first and open, with a dashboard link, and folds a step that works to one line', () => {
    const answer = dnsAnswer([{ priority: 13, host: 'route1.mx.cloudflare.net' }]);
    const html = renderDns({ ...answer, receiving: { ...answer.receiving, ready: true, via_cloudflare: true } });
    // Sending (not ready) comes before receiving (ready).
    expect(html.indexOf(`aria-label="${tr('domains.sending')}"`)).toBeLessThan(html.indexOf(`aria-label="${tr('domains.receiving')}"`));
    // The failing step is open, says where to fix it, and links to the dashboard in a new tab; the ready step is closed.
    const toggles = [...html.matchAll(/aria-expanded="(true|false)"/g)].map((match) => match[1]);
    expect(toggles).toEqual(['true', 'false']);
    expect(html).toContain(tr('domains.guide_path_sending'));
    expect(html).not.toContain(tr('domains.guide_path_routing'));
    expect(html).toMatch(/<a href="https:\/\/dash\.cloudflare\.com\/" target="_blank" rel="noopener noreferrer"/);
    expect(html).toContain(tr('domains.note_mx_cloudflare'));
  });
});

describe('a missing record of Email Sending', () => {
  it('says where its value is (the app cannot know it), and only under the records that are missing', () => {
    const html = renderDns(dnsAnswer([]));
    expect(html.match(/class="ad-record-hint"/g)).toHaveLength(2);
    expect(html).toContain(tr('domains.record_value_hint'));
  });
});

const person = (fields: Partial<AdminUser>): AdminUser => ({
  id: 'u1',
  email: 'maya.chen@example.com',
  display_name: 'Maya Chen',
  role: 'member',
  status: 'active',
  last_login_at: null,
  has_keys: true,
  two_factor: true,
  two_factor_reset_due_at: null,
  never_signed_in: false,
  temp_password_expires_at: null,
  aliases: [],
  ...fields
});
const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);

describe('the state of a person in the admin console', () => {
  it('says two-factor in words with an icon: On quiet, Off a warning unless the account is disabled', () => {
    const on = render(createElement(PersonTwoFactor, { user: person({}) }));
    expect(on).toContain(tr('users.two_factor_is_on'));
    expect(on).not.toContain('data-tone');
    const off = render(createElement(PersonTwoFactor, { user: person({ two_factor: false }) }));
    expect(off).toContain(tr('users.two_factor_is_off'));
    expect(off).toContain('data-tone="warning"');
    expect(render(createElement(PersonTwoFactor, { user: person({ two_factor: false, never_signed_in: true }) }))).toContain(
      'data-tone="warning"'
    );
    expect(render(createElement(PersonTwoFactor, { user: person({ two_factor: false, status: 'disabled' }) }))).not.toContain('data-tone');
    // Under its column header the short word, with the whole phrase for the stacked rows of a narrow table.
    const short = render(createElement(PersonTwoFactor, { user: person({}), short: true }));
    expect(short).toContain(`<span class="ad-wide">${tr('users.two_factor_on')}</span>`);
    expect(short).toContain(`<span class="ad-narrow">${tr('users.two_factor_is_on')}</span>`);
  });

  it('draws every status as an icon and a word, never a pill, so the words of the column share one edge', () => {
    for (const fields of [{}, { never_signed_in: true }, { status: 'disabled' as const }]) {
      const html = render(createElement(PersonStatus, { user: person(fields) }));
      expect(html).toMatch(/^<span class="ad-plain"( data-tone="(warning|danger)")?><span class="ad-state-icon" aria-hidden="true">/);
      expect(html).not.toContain('ui-badge');
    }
  });
});

describe('the audit log in words', () => {
  it('says every value the server writes as words: a change, a language, a reason, on and off', () => {
    const change = (from: string, to: string) => tr('audit.detail_change', { from, to });
    expect(detailLine({ from: 'member', to: 'admin' })).toBe(change(tr('term.member'), tr('term.admin')));
    expect(detailLine({ from: 'vi', to: 'en' })).toBe(change('Tiếng Việt', 'English'));
    expect(detailLine({ from: false, to: true })).toBe(change(tr('audit.value_off'), tr('audit.value_on')));
    expect(detailLine({ reason: 'wrong_credentials' })).toBe(`${tr('audit.detail_reason')}: ${tr('audit.reason_wrong_password')}`);
    expect(detailLine({ reason: 'second_factor' })).toBe(`${tr('audit.detail_reason')}: ${tr('audit.reason_second_factor')}`);
    expect(detailLine({ second_factor: 'totp' })).toBe(`${tr('audit.detail_second_factor')}: ${tr('term.authenticator_app')}`);
    // A reason the client does not know is shown as the server wrote it, never hidden.
    expect(detailLine({ reason: 'left the company' })).toBe(`${tr('audit.detail_reason')}: left the company`);
    expect(detailLine({})).toBe('');
  });
});

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
