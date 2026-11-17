import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { ourAuthResult } from '../src/worker/spam/auth-results';
import { factsFromEmail } from '../src/worker/spam/facts';
import { hostOfAddress } from '../src/worker/spam/hosts';
import { THRESHOLD } from '../src/worker/spam/rules';
import { reachesThreshold, reasonsOf, scoreMail } from '../src/worker/spam/score';

// A hand-written set of realistic messages (test/fixtures/spam/*.eml; every one is invented text, none is taken from a real mailbox). The rules alone, with no
// list and no history of the person, must put no legitimate mail at the threshold and every spam mail at or over it. The files hold the Authentication-Results
// header Cloudflare would have put on top (mx.cloudflare.net), as it is in a real delivery.

const FILES = import.meta.glob<string>('./fixtures/spam/*.eml', { query: '?raw', import: 'default', eager: true });
/** The domain this test deployment hosts (the Worker tests host example.com). */
const HOSTED = 'example.com';

interface Judged {
  name: string;
  score: number;
  reasons: string[];
}

async function judge(raw: string): Promise<Omit<Judged, 'name'>> {
  // Messages are stored with \n in the repo; mail on the wire has \r\n.
  const parsed = await PostalMime.parse(raw.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  const from = (parsed.from?.address ?? '').toLowerCase();
  const facts = { ...factsFromEmail(parsed, from, ourAuthResult(parsed.headers)), fromHosted: hostOfAddress(from) === HOSTED };
  const scored = scoreMail(facts);
  return { score: scored.score, reasons: reasonsOf(scored.hits) };
}

const names = Object.keys(FILES).toSorted();
const kindOf = (path: string): string => path.split('/').at(-1)?.split('-', 1).at(0) ?? '';
const nameOf = (path: string): string =>
  path
    .split('/')
    .at(-1)
    ?.replace(/\.eml$/, '') ?? path;

describe('the fixture set', () => {
  it('has at least 25 messages, spam and legitimate, in English, Vietnamese and Chinese', () => {
    expect(names.length).toBeGreaterThanOrEqual(25);
    expect(names.filter((path) => kindOf(path) === 'ham').length).toBeGreaterThanOrEqual(12);
    expect(names.filter((path) => kindOf(path) === 'spam').length).toBeGreaterThanOrEqual(12);
    for (const tag of ['-vi-', '-zh-']) {
      expect(
        names.some((path) => kindOf(path) === 'spam' && nameOf(path).includes(tag)),
        tag
      ).toBe(true);
    }
    expect(names.every((path) => ['ham', 'spam'].includes(kindOf(path)))).toBe(true);
  });

  it('keeps every legitimate message under the threshold', async () => {
    const over: Judged[] = [];
    for (const path of names.filter((entry) => kindOf(entry) === 'ham')) {
      const verdict = await judge(FILES[path] ?? '');
      if (reachesThreshold(verdict.score)) {
        over.push({ name: nameOf(path), ...verdict });
      }
    }
    expect(over).toEqual([]);
  });

  it('puts every spam message at or over the threshold', async () => {
    const under: Judged[] = [];
    for (const path of names.filter((entry) => kindOf(entry) === 'spam')) {
      const verdict = await judge(FILES[path] ?? '');
      if (!reachesThreshold(verdict.score)) {
        under.push({ name: nameOf(path), ...verdict });
      }
    }
    expect(under).toEqual([]);
  });

  it('has two legitimate messages close to the line, both for a reason a person can see: a list post whose DMARC failed because the list re-sent it, and a mail that quotes spam', async () => {
    const close: string[] = [];
    for (const path of names.filter((entry) => kindOf(entry) === 'ham')) {
      if ((await judge(FILES[path] ?? '')).score >= THRESHOLD - 1) {
        close.push(nameOf(path));
      }
    }
    // The list post: dmarc=fail (3) + the Reply-To of the list on another host (1) = 4. The mail that quotes two spam subjects: two phrases (2 each) = 4. One more
    // point would send either to Spam, which is what an allow entry and the Not spam button are for.
    expect(close).toEqual(['ham-mailing-list-post', 'ham-spam-discussion']);
  });

  it('explains each spam message with at least one reason from the table', async () => {
    for (const path of names.filter((entry) => kindOf(entry) === 'spam')) {
      const { reasons } = await judge(FILES[path] ?? '');
      expect(reasons.length, nameOf(path)).toBeGreaterThan(0);
      expect(reasons.length, nameOf(path)).toBeLessThanOrEqual(6);
    }
  });

  it('judges each message the same on every run (the score depends on the message only)', async () => {
    const raw = FILES[names[0] ?? ''] ?? '';
    expect(await judge(raw)).toEqual(await judge(raw));
  });
});

describe('what the spam fixtures are caught by', () => {
  const expected: Record<string, string[]> = {
    'spam-en-lottery': ['spam_phrases'],
    'spam-en-phishing-bank': ['auth_failed', 'link_text_mismatch', 'phishing_phrases'],
    'spam-en-exe-attachment': ['risky_attachment'],
    'spam-en-html-attachment-phish': ['phishing_phrases', 'html_attachment'],
    'spam-vi-lottery': ['spam_phrases'],
    'spam-vi-phishing': ['auth_failed', 'phishing_phrases'],
    'spam-zh-casino': ['spam_phrases'],
    'spam-zh-phishing': ['auth_failed', 'phishing_phrases'],
    'spam-spoof-own-domain': ['spoofs_own_domain', 'auth_failed'],
    'spam-spoof-no-result': ['spoofs_own_domain'],
    'spam-en-macro-document': ['spam_phrases', 'macro_attachment']
  };

  for (const [name, ids] of Object.entries(expected)) {
    it(`${name} is caught for the reasons a reader would give`, async () => {
      const path = names.find((entry) => nameOf(entry) === name);
      const { reasons } = await judge(FILES[path ?? ''] ?? '');
      expect(reasons).toEqual(expect.arrayContaining(ids));
    });
  }
});
