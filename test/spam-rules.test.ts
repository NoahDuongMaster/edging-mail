import { describe, expect, it } from 'vitest';
import { analyse, contentHits } from '../src/worker/spam/content-rules';
import {
  authFailed,
  authMissingPass,
  authPassed,
  BLOCK_LISTED,
  displayNameMismatch,
  extensionOf,
  htmlAttachment,
  macroAttachment,
  noDate,
  noMessageId,
  noSubject,
  replyToDiffers,
  riskyAttachment,
  shoutingSubject,
  SPAM_RULE_IDS,
  spoofsOwnDomain,
  THRESHOLD,
  WEIGHTS
} from '../src/worker/spam/rules';
import type { RuleId } from '../src/worker/spam/rules';
import { MAX_REASONS, reachesThreshold, reasonsOf, scoreMail } from '../src/worker/spam/score';
import { facts } from './spam-helpers';

// The header, subject and attachment rules one by one, the table of weights, and the scorer (the sum, the threshold, the reasons).

const auth = (spf: string, dkim: string, dmarc: string) => ({ spf, dkim, dmarc }) as NonNullable<ReturnType<typeof facts>['auth']>;

describe('the table of weights', () => {
  it('has the weights of the contract, the threshold of 5, and one entry per rule id', () => {
    expect(THRESHOLD).toBe(5);
    expect(WEIGHTS).toEqual({
      auth_failed: 3,
      auth_missing_pass: 3,
      auth_passed: -2,
      spoofs_own_domain: 5,
      reply_to_differs: 1,
      display_name_mismatch: 3,
      no_message_id: 1,
      no_date: 1,
      no_subject: 1,
      link_text_mismatch: 3,
      link_ip_address: 2,
      link_shortener: 1,
      hidden_text: 2,
      image_only: 2,
      many_links: 1,
      shouting_subject: 1,
      spam_phrases: 2,
      phishing_phrases: 3,
      risky_attachment: 7,
      html_attachment: 2,
      macro_attachment: 2
    });
  });

  it('lists as SPAM_RULE_IDS the ids that can be stored as a reason: every rule that adds, and block_listed (auth_passed only takes away)', () => {
    expect(SPAM_RULE_IDS).toContain(BLOCK_LISTED);
    expect(SPAM_RULE_IDS).not.toContain('auth_passed');
    expect(new Set(SPAM_RULE_IDS).size).toBe(SPAM_RULE_IDS.length);
    expect(SPAM_RULE_IDS.toSorted()).toEqual(
      [...(Object.keys(WEIGHTS) as RuleId[]).filter((id) => WEIGHTS[id] > 0), BLOCK_LISTED].toSorted()
    );
    expect(SPAM_RULE_IDS).toHaveLength(21);
  });
});

describe('authentication rules', () => {
  it('auth_failed: DMARC failed', () => {
    expect(authFailed(facts({ auth: auth('pass', 'pass', 'fail') }))).toBe(true);
    expect(authFailed(facts({ auth: auth('fail', 'fail', 'none') }))).toBe(false);
    expect(authFailed(facts({ auth: null }))).toBe(false);
  });

  it('auth_missing_pass: a result of ours exists and none of SPF, DKIM, DMARC passed', () => {
    expect(authMissingPass(facts({ auth: auth('none', 'none', 'none') }))).toBe(true);
    expect(authMissingPass(facts({ auth: auth('fail', 'softfail', 'fail') }))).toBe(true);
    expect(authMissingPass(facts({ auth: auth('pass', 'none', 'none') }))).toBe(false);
    expect(authMissingPass(facts({ auth: auth('none', 'pass', 'none') }))).toBe(false);
    expect(authMissingPass(facts({ auth: auth('none', 'none', 'pass') }))).toBe(false);
    // no result of ours: not a verdict on the sender
    expect(authMissingPass(facts({ auth: null }))).toBe(false);
  });

  it('auth_passed: DMARC passed', () => {
    expect(authPassed(facts({ auth: auth('none', 'none', 'pass') }))).toBe(true);
    expect(authPassed(facts({ auth: auth('pass', 'pass', 'none') }))).toBe(false);
    expect(authPassed(facts({ auth: null }))).toBe(false);
  });

  it('spoofs_own_domain: a hosted From domain without a DMARC pass (also with no result at all)', () => {
    expect(spoofsOwnDomain(facts({ fromHosted: true, auth: null }))).toBe(true);
    expect(spoofsOwnDomain(facts({ fromHosted: true, auth: auth('pass', 'pass', 'none') }))).toBe(true);
    expect(spoofsOwnDomain(facts({ fromHosted: true, auth: auth('none', 'none', 'fail') }))).toBe(true);
    expect(spoofsOwnDomain(facts({ fromHosted: true, auth: auth('pass', 'pass', 'pass') }))).toBe(false);
    expect(spoofsOwnDomain(facts({ fromHosted: false, auth: null }))).toBe(false);
  });

  it('adds up: a failed DMARC is 3 + 3 (it also has no pass), so it is spam without any other sign', () => {
    const scored = scoreMail(facts({ auth: auth('fail', 'none', 'fail') }));
    expect(scored.hits.map((entry) => entry.id)).toEqual(['auth_failed', 'auth_missing_pass']);
    expect(scored.score).toBe(6);
    expect(scoreMail(facts({ auth: auth('pass', 'pass', 'pass') })).score).toBe(-2);
  });
});

const mismatch = (fromName: string, fromAddress: string): boolean => displayNameMismatch(facts({ fromName, fromAddress }));
const names = (...attachmentNames: string[]) => facts({ attachmentNames });

describe('header rules', () => {
  it('reply_to_differs: the Reply-To host is unrelated to the From host (equal, subdomain either way, or the same registrable domain is related)', () => {
    const from = 'news@brand.com';
    expect(replyToDiffers(facts({ fromAddress: from, replyTo: 'help@elsewhere.net' }))).toBe(true);
    expect(replyToDiffers(facts({ fromAddress: from, replyTo: 'help@brand.com' }))).toBe(false);
    expect(replyToDiffers(facts({ fromAddress: from, replyTo: 'help@support.brand.com' }))).toBe(false);
    expect(replyToDiffers(facts({ fromAddress: 'news@mail.brand.com', replyTo: 'help@brand.com' }))).toBe(false);
    expect(replyToDiffers(facts({ fromAddress: 'news@news.brand.com', replyTo: 'help@support.brand.com' }))).toBe(false);
    expect(replyToDiffers(facts({ fromAddress: from, replyTo: '' }))).toBe(false);
    // a host that merely ends with the same letters is not a subdomain
    expect(replyToDiffers(facts({ fromAddress: from, replyTo: 'help@notbrand.com' }))).toBe(true);
    expect(replyToDiffers(facts({ fromAddress: 'a@brand.co.uk', replyTo: 'b@other.co.uk' }))).toBe(true);
  });

  it('display_name_mismatch: the name is an address or a web address of a host other than the From host', () => {
    expect(mismatch('support@paypal.com', 'phish@evil.example')).toBe(true);
    expect(mismatch('"PayPal Support" <support@paypal.com>', 'phish@evil.example')).toBe(true);
    expect(mismatch('paypal.com', 'phish@evil.example')).toBe(true);
    expect(mismatch('www.paypal.com', 'phish@evil.example')).toBe(true);
    expect(mismatch('https://paypal.com', 'phish@evil.example')).toBe(true);
    // the same host, a subdomain of it or a sibling is the sender itself
    expect(mismatch('support@paypal.com', 'service@paypal.com')).toBe(false);
    expect(mismatch('Amazon.com', 'store-news@amazon.com')).toBe(false);
    expect(mismatch('eBay.com', 'ebay@reply.ebay.com')).toBe(false);
    // a name, with or without a domain in it, is not a claim
    expect(mismatch('CNET News.com Daily Dispatch', 'online@newsletter.online.com')).toBe(false);
    expect(mismatch('Node.js Weekly', 'news@nodeweekly.com')).toBe(false);
    expect(mismatch('node.js', 'news@nodeweekly.com')).toBe(false);
    expect(mismatch('hyatt@mozilla', 'rssfeeds@example.org')).toBe(false);
    expect(mismatch('Alice Smith', 'alice@example.org')).toBe(false);
    expect(mismatch('', 'alice@example.org')).toBe(false);
    expect(mismatch('paypal.com', '')).toBe(false);
  });

  it('no_message_id, no_date, no_subject', () => {
    expect(noMessageId(facts({ hasMessageId: false }))).toBe(true);
    expect(noMessageId(facts())).toBe(false);
    expect(noDate(facts({ hasDate: false }))).toBe(true);
    expect(noDate(facts())).toBe(false);
    expect(noSubject(facts({ subject: '' }))).toBe(true);
    expect(noSubject(facts({ subject: ' '.repeat(3) }))).toBe(true);
    expect(noSubject(facts({ subject: 'x' }))).toBe(false);
  });

  it('shouting_subject: at least 10 cased letters and over 80% of them upper case', () => {
    expect(shoutingSubject('GET RICH QUICK NOW')).toBe(true);
    expect(shoutingSubject('FREE!!! FREE!!! 100% FREE')).toBe(true);
    // exactly 10 letters, all upper case
    expect(shoutingSubject('ABCDEFGHIJ')).toBe(true);
    // 9 letters: too few
    expect(shoutingSubject('ABCDEFGHI')).toBe(false);
    // 10 letters, 8 upper = exactly 80%: not over
    expect(shoutingSubject('ABCDEFGHij')).toBe(false);
    // 11 letters, 9 upper = 81.8%
    expect(shoutingSubject('ABCDEFGHIjk')).toBe(true);
    expect(shoutingSubject('Meeting notes for Friday')).toBe(false);
    // letters without a case do not count either way
    expect(shoutingSubject('恭喜您中奖恭喜您中奖恭喜您中奖')).toBe(false);
    expect(shoutingSubject('恭喜 ABCDEFGHIJ 恭喜')).toBe(true);
    expect(shoutingSubject('')).toBe(false);
    expect(shoutingSubject('1234567890!!!!')).toBe(false);
  });
});

describe('attachment rules (by file name)', () => {
  it('risky_attachment: a program or script extension, also as a double extension and in disguise', () => {
    for (const name of [
      'setup.exe',
      'a.scr',
      'run.com',
      'x.bat',
      'x.cmd',
      'a.js',
      'a.jse',
      'a.vbs',
      'a.vbe',
      'a.wsf',
      'a.jar',
      'a.msi',
      'a.lnk',
      'disc.iso',
      'disc.img',
      'a.hta',
      'a.ps1',
      'a.dll'
    ]) {
      expect(riskyAttachment(names(name)), name).toBe(true);
    }
    for (const name of [
      'invoice.pdf.exe',
      'photo.jpg.scr',
      'INVOICE.EXE',
      'invoice.exe ',
      'invoice.exe...',
      'doc\u202Etxt.exe',
      'a.b.c.js'
    ]) {
      expect(riskyAttachment(names(name)), name).toBe(true);
    }
    for (const name of ['report.pdf', 'photo.jpg', 'notes.txt', 'archive.zip', 'exe', 'script.json', 'a.jsx', 'jsfile', 'a.exe.txt', '']) {
      expect(riskyAttachment(names(name)), name).toBe(false);
    }
    expect(riskyAttachment(names('ok.pdf', 'bad.exe'))).toBe(true);
    expect(riskyAttachment(names())).toBe(false);
  });

  it('html_attachment and macro_attachment', () => {
    for (const name of ['page.html', 'page.HTM', 'page.shtml']) {
      expect(htmlAttachment(names(name)), name).toBe(true);
    }
    expect(htmlAttachment(names('page.xhtml', 'page.html.txt', 'html'))).toBe(false);
    for (const name of ['a.docm', 'a.xlsm', 'a.pptm', 'a.xlam']) {
      expect(macroAttachment(names(name)), name).toBe(true);
    }
    expect(macroAttachment(names('a.docx', 'a.xlsx', 'a.pptx', 'a.xlsm.txt'))).toBe(false);
  });

  it('extensionOf drops format characters, blanks and trailing dots', () => {
    expect(extensionOf('a.PDF')).toBe('pdf');
    expect(extensionOf('a.pdf. . ')).toBe('pdf');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.')).toBe('');
    expect(extensionOf('')).toBe('');
  });
});

describe('the scorer', () => {
  it('a harmless mail scores 0 and a rule counts once however many times it applies', () => {
    expect(scoreMail(facts()).score).toBe(0);
    const twice = scoreMail(facts({ attachmentNames: ['a.exe', 'b.exe', 'c.scr'] }));
    expect(twice.hits.filter((entry) => entry.id === 'risky_attachment')).toHaveLength(1);
    expect(twice.score).toBe(7);
  });

  it('the threshold edge: 4 is not spam, 5 is', () => {
    // no_message_id + no_date + no_subject = 3
    expect(scoreMail(facts({ hasMessageId: false, hasDate: false, subject: '' })).score).toBe(3);
    // a display name that claims another host is 3: with one more it is 4, with two more it is 5
    const edge = (extra: Partial<ReturnType<typeof facts>>) =>
      scoreMail(facts({ fromName: 'paypal.com', fromAddress: 'x@evil.example', ...extra }));
    expect(edge({ hasMessageId: false }).score).toBe(4);
    expect(reachesThreshold(edge({ hasMessageId: false }).score)).toBe(false);
    expect(edge({ hasMessageId: false, hasDate: false }).score).toBe(5);
    expect(reachesThreshold(edge({ hasMessageId: false, hasDate: false }).score)).toBe(true);
    expect(reachesThreshold(THRESHOLD - 1)).toBe(false);
    expect(reachesThreshold(THRESHOLD)).toBe(true);
  });

  it('a passed DMARC takes 2 away: a mail at 6 with auth_passed is 4', () => {
    const base = { fromName: 'paypal.com', fromAddress: 'x@evil.example', hasMessageId: false, hasDate: false, subject: '' };
    expect(scoreMail(facts(base)).score).toBe(6);
    expect(scoreMail(facts({ ...base, auth: auth('pass', 'pass', 'pass') })).score).toBe(4);
  });

  it('a program or script attached to mail from a sender that passed DMARC is still spam: any domain can pass DMARC', () => {
    const attached = facts({ attachmentNames: ['invoice.pdf.exe'], auth: auth('pass', 'pass', 'pass') });
    expect(scoreMail(attached).score).toBe(5);
    expect(reachesThreshold(scoreMail(attached).score)).toBe(true);
  });

  it('reasons: only what added, biggest first (equal ones in the order of the table), at most six', () => {
    const everything = facts({
      auth: auth('fail', 'none', 'fail'),
      fromHosted: true,
      fromName: 'paypal.com',
      fromAddress: 'x@evil.example',
      replyTo: 'y@other.example',
      hasMessageId: false,
      hasDate: false,
      subject: '',
      attachmentNames: ['a.exe', 'b.html', 'c.docm']
    });
    const reasons = reasonsOf(scoreMail(everything).hits);
    expect(reasons).toHaveLength(MAX_REASONS);
    expect(reasons).toEqual([
      'risky_attachment',
      'spoofs_own_domain',
      'auth_failed',
      'auth_missing_pass',
      'display_name_mismatch',
      'html_attachment'
    ]);
    // auth_passed never shows as a reason
    expect(reasonsOf(scoreMail(facts({ auth: auth('pass', 'pass', 'pass'), hasDate: false })).hits)).toEqual(['no_date']);
    expect(reasonsOf([])).toEqual([]);
  });

  it('every rule that adds is a stored-reason id, and one mail can trigger all but auth_passed, many_links, image_only and no_subject', () => {
    const scored = scoreMail(
      facts({
        auth: auth('fail', 'none', 'fail'),
        fromHosted: true,
        fromName: 'paypal.com',
        fromAddress: 'x@evil.example',
        replyTo: 'y@other.example',
        hasMessageId: false,
        hasDate: false,
        subject: 'FREE FREE FREE FREE',
        text: 'you have won a prize. claim your prize now. wire transfer. verify your account at http://192.168.1.5/login',
        html: `<a href="https://bit.ly/x">https://paypal.com/login</a><img src="x"><div style="display:none">${'hidden words '.repeat(30)}</div>`,
        attachmentNames: ['a.exe', 'b.html', 'c.docm']
      })
    );
    for (const entry of scored.hits.filter((hit) => hit.weight > 0)) {
      expect(SPAM_RULE_IDS).toContain(entry.id);
    }
    expect(new Set(scored.hits.map((entry) => entry.id)).size).toBe(17);
    expect(contentHits(analyse(facts({ html: '<img src="x">' }))).map((entry) => entry.id)).toEqual(['image_only']);
  });
});
