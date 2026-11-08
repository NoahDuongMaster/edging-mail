import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReplyRedirectNote } from '../../src/client/components/compose/ReplyRedirectNote';
import { UnverifiedChip } from '../../src/client/components/UnverifiedChip';
import { arrivedUnverified, bareAddress, replyRedirect, splitAddressList } from '../../src/client/lib/mail';
import { getTokens } from '../../src/client/theme';

// PX-12: mail that arrives over email can claim the address of a colleague. The reader says, quietly, that nobody checked it; and the reply
// window says where the answer would really go when the sender asked for it elsewhere.

describe('arrivedUnverified', () => {
  it('is true only for a message that came over email and whose From address is on a hosted domain', () => {
    expect(arrivedUnverified({ origin: 'smtp', from_hosted: true })).toBe(true);
    expect(arrivedUnverified({ origin: 'smtp', from_hosted: 1 })).toBe(true);
    expect(arrivedUnverified({ origin: 'smtp', from_hosted: false })).toBe(false);
    expect(arrivedUnverified({ origin: 'smtp', from_hosted: 0 })).toBe(false);
    expect(arrivedUnverified({ origin: 'smtp' })).toBe(false);
    // Sent between people of this deployment: not a claim to check here.
    expect(arrivedUnverified({ origin: 'internal', from_hosted: true })).toBe(false);
    // An older row has neither field.
    expect(arrivedUnverified({})).toBe(false);
  });
});

describe('bareAddress and replyRedirect', () => {
  it('compares an address without case or a name part', () => {
    expect(bareAddress('Alice Admin <Alice@Example.com>')).toBe('alice@example.com');
    expect(bareAddress('  alice@example.com ')).toBe('alice@example.com');
  });

  it('says nothing when there is no Reply-To, or it is the sender', () => {
    expect(replyRedirect({ from_address: 'alice@example.com', reply_to: null })).toBeUndefined();
    expect(replyRedirect({ from_address: 'alice@example.com', reply_to: '' })).toBeUndefined();
    expect(replyRedirect({ from_address: 'alice@example.com' })).toBeUndefined();
    expect(replyRedirect({ from_address: 'alice@example.com', reply_to: 'ALICE@example.com' })).toBeUndefined();
    expect(replyRedirect({ from_address: 'alice@example.com', reply_to: 'Alice <alice@example.com>' })).toBeUndefined();
  });

  it('names the Reply-To address that is not the sender, and the sender', () => {
    expect(replyRedirect({ from_address: 'alice@example.com', reply_to: 'attacker@evil.test' })).toEqual({
      address: 'attacker@evil.test',
      sender: 'alice@example.com'
    });
    expect(replyRedirect({ from_address: 'Alice@Example.com', reply_to: 'The Boss <Boss@Evil.test>' })).toEqual({
      address: 'boss@evil.test',
      sender: 'alice@example.com'
    });
  });

  it('with several Reply-To addresses names only the ones that differ', () => {
    expect(replyRedirect({ from_address: 'alice@example.com', reply_to: 'alice@example.com, other@evil.test; third@evil.test' })).toEqual({
      address: 'other@evil.test, third@evil.test',
      sender: 'alice@example.com'
    });
  });

  it('does not cut a display name at its comma or semicolon (a name like "Doe, John")', () => {
    // The sender's own address under a name with a comma in it: nothing to warn about (it used to name an address that was half a name).
    expect(replyRedirect({ from_address: 'x@example.com', reply_to: '"Doe, John" <x@example.com>' })).toBeUndefined();
    expect(replyRedirect({ from_address: 'x@example.com', reply_to: '"Roe; Jane" <X@Example.com>' })).toBeUndefined();
    // Another address: named once, as an address.
    expect(replyRedirect({ from_address: 'x@example.com', reply_to: '"Doe, John" <other@evil.test>' })).toEqual({
      address: 'other@evil.test',
      sender: 'x@example.com'
    });
    expect(replyRedirect({ from_address: 'x@example.com', reply_to: '"Doe, John" <x@example.com>, third@evil.test' })).toEqual({
      address: 'third@evil.test',
      sender: 'x@example.com'
    });
    // An escaped quote inside a quoted name does not end the name.
    expect(replyRedirect({ from_address: 'x@example.com', reply_to: String.raw`"Say \"hi, there\"" <other@evil.test>` })).toEqual({
      address: 'other@evil.test',
      sender: 'x@example.com'
    });
  });
});

describe('splitAddressList', () => {
  it('splits at commas and semicolons and trims the entries', () => {
    expect(splitAddressList('a@b.test, d@e.test; g@h.test')).toEqual(['a@b.test', 'd@e.test', 'g@h.test']);
  });

  it('keeps a quoted name, with its comma or semicolon, and an address in angle brackets, in one entry', () => {
    expect(splitAddressList('"Doe, John" <j@b.test>, d@e.test')).toEqual(['"Doe, John" <j@b.test>', 'd@e.test']);
    expect(splitAddressList('"Roe; Jane" <r@b.test>;d@e.test')).toEqual(['"Roe; Jane" <r@b.test>', 'd@e.test']);
    expect(splitAddressList('<a,b@c.test>, e@f.test')).toEqual(['<a,b@c.test>', 'e@f.test']);
  });

  it('drops empty entries and gives nothing for nothing', () => {
    expect(splitAddressList(',, a@b.test ;')).toEqual(['a@b.test']);
    expect(splitAddressList('')).toEqual([]);
    expect(splitAddressList('  ')).toEqual([]);
  });

  it('does not fail on a quote that is never closed: the rest stays one entry', () => {
    expect(splitAddressList('"Doe, John <j@b.test>, d@e.test')).toEqual(['"Doe, John <j@b.test>, d@e.test']);
  });
});

describe('the chip and the line', () => {
  const t = getTokens(false);
  const chip = (): string => renderToStaticMarkup(createElement(UnverifiedChip, { t }));
  const note = (to: string[], redirect = replyRedirect({ from_address: 'alice@example.com', reply_to: 'attacker@evil.test' })): string =>
    renderToStaticMarkup(createElement(ReplyRedirectNote, { t, redirect, to }));

  it('shows the chip with the plain sentence and no alarm colour', () => {
    const html = chip();
    expect(html).toContain('data-unverified-sender');
    expect(html).toContain('Arrived by email; the sender is not verified');
    expect(html).not.toMatch(/#B42318|#F97066|#B91C1C|#F87171|role="alert"/i);
  });

  it('puts the Reply-To address and the sender on a line of their own while the To field holds that address', () => {
    const html = note(['attacker@evil.test']);
    expect(html).toContain('data-reply-redirect');
    expect(html).toContain('The sender asked for replies to go to attacker@evil.test, not to alice@example.com.');
    expect(note(['ATTACKER@evil.test'])).toContain('data-reply-redirect');
  });

  it('is gone once the person has taken that address out of To, and when there is no redirect', () => {
    expect(note(['someone@example.com'])).toBe('');
    expect(note([])).toBe('');
    expect(renderToStaticMarkup(createElement(ReplyRedirectNote, { t, redirect: undefined, to: ['attacker@evil.test'] }))).toBe('');
  });
});
