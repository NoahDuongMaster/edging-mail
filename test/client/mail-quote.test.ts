import { describe, expect, it } from 'vitest';
import { isAttribution, quoteBlocks, splitQuote } from '../../src/client/lib/mailQuote';

// J6-29: the reader folds the quoted original at the end of a received reply behind "Show quoted text". These are the plain-text rules
// (lib/mailQuote.ts); the HTML fold (foldHtmlQuote: a native <details> in the sandboxed frame) needs a DOM and is checked in the browser.

const REPLY = [
  'Hi Alex,',
  '',
  'Thanks, the dates work for me. I moved the review to Thursday.',
  '',
  'Priya',
  '',
  'On Fri, 13 Nov 2026 at 16:05, Alex Morgan <alex.morgan@example.com> wrote:',
  '> Hi Priya,',
  '>',
  '> Here is a first pass at the plan.',
  '> > Earlier: can we meet on Monday?',
  ''
].join('\n');

describe('isAttribution', () => {
  it('knows the line that introduces a quote, in the languages of the app and the common clients', () => {
    for (const line of [
      'On Fri, 13 Nov 2026 at 16:05, Alex Morgan <alex.morgan@example.com> wrote:',
      'On Mon, Nov 16, 2026, 2:33 PM, Priya Nair <priya@example.com> wrote:',
      'Vào 16 thg 11, 2026, Nguyễn Minh Anh đã viết:',
      '在 2026年11月16日 14:33，李明 写道：',
      'Le lun. 16 nov. 2026 à 14:33, Marie <marie@example.org> a écrit :',
      'Am 16.11.2026 um 14:33 schrieb Jonas <jonas@example.org>:'
    ]) {
      expect(isAttribution(line), line).toBe(true);
    }
  });

  it('does not take an ordinary sentence for one', () => {
    for (const line of ['Here is what I think:', 'Thanks, the dates work for me.', 'Agenda for Thursday', 'See below']) {
      expect(isAttribution(line), line).toBe(false);
    }
  });
});

describe('splitQuote', () => {
  it('splits a reply where its trailing quote starts: the attribution, then the quoted lines', () => {
    const split = splitQuote(REPLY);
    expect(split).not.toBeNull();
    expect(split?.body).toBe('Hi Alex,\n\nThanks, the dates work for me. I moved the review to Thursday.\n\nPriya');
    expect(split?.attribution).toBe('On Fri, 13 Nov 2026 at 16:05, Alex Morgan <alex.morgan@example.com> wrote:');
    expect(split?.quote).toBe('> Hi Priya,\n>\n> Here is a first pass at the plan.\n> > Earlier: can we meet on Monday?');
  });

  it("re-joins an attribution the sender's client wrapped over two lines", () => {
    const wrapped =
      'Sounds good.\n\nOn Fri, 13 Nov 2026 at 16:05, Alex Morgan <\nalex.morgan@example.com> wrote:\n> Hi Priya,\n> See you then.';
    expect(splitQuote(wrapped)).toEqual({
      body: 'Sounds good.',
      attribution: 'On Fri, 13 Nov 2026 at 16:05, Alex Morgan < alex.morgan@example.com> wrote:',
      quote: '> Hi Priya,\n> See you then.'
    });
  });

  it('folds a run of quoted lines with no attribution, and an Outlook header block with its rule', () => {
    expect(splitQuote('Yes, please.\n\n> Can you send the file?\n> Thanks')).toEqual({
      body: 'Yes, please.',
      attribution: null,
      quote: '> Can you send the file?\n> Thanks'
    });
    const outlook =
      'Approved.\n\n-----Original Message-----\nFrom: Tom Becker\nSent: Monday, November 16, 2026 9:12 AM\nTo: Priya Nair\nSubject: Budget\n\nCan you approve the budget?';
    expect(splitQuote(outlook)).toEqual({
      body: 'Approved.',
      attribution: null,
      quote:
        '-----Original Message-----\nFrom: Tom Becker\nSent: Monday, November 16, 2026 9:12 AM\nTo: Priya Nair\nSubject: Budget\n\nCan you approve the budget?'
    });
  });

  it('leaves alone a mail with no quote, a quote that does not end the mail, and a mail that is only a quote', () => {
    expect(splitQuote('Hi,\n\nNo quote here.\n\nBye')).toBeNull();
    expect(splitQuote('> You said this\n\nAnd I answer below it, inline.')).toBeNull();
    expect(splitQuote('On Fri, 13 Nov 2026, Alex <alex@example.com> wrote:\n> Only the quote')).toBeNull();
    expect(splitQuote('')).toBeNull();
  });

  it('keeps a long paragraph of the sender\'s own words that happens to end with "wrote:" out of the attribution, except its last line', () => {
    const own = [
      'I read the whole thread again this morning and I think we should keep the schedule as it is, because the venue is booked and',
      'the travel is paid for already; moving it now would cost more than it saves, and nobody has asked for it. This is what Tom',
      'wrote:',
      '> We can move it if needed.'
    ].join('\n');
    const split = splitQuote(own);
    expect(split?.attribution).toBe('wrote:');
    expect(split?.body.startsWith('I read the whole thread')).toBe(true);
  });
});

describe('quoteBlocks', () => {
  it('turns the quoted lines into paragraphs and nested levels, without the markers', () => {
    expect(quoteBlocks('> Hi Priya,\n>\n> Here is a first pass.\n> > Earlier: Monday?')).toEqual([
      {
        kind: 'quote',
        children: [
          { kind: 'p', text: 'Hi Priya,' },
          { kind: 'p', text: 'Here is a first pass.' },
          { kind: 'quote', children: [{ kind: 'p', text: 'Earlier: Monday?' }] }
        ]
      }
    ]);
  });

  it('keeps unquoted lines (an Outlook block) as paragraphs, and stops nesting at its depth', () => {
    expect(quoteBlocks('From: Tom\nSubject: Budget\n\nCan you approve it?')).toEqual([
      { kind: 'p', text: 'From: Tom\nSubject: Budget' },
      { kind: 'p', text: 'Can you approve it?' }
    ]);
    expect(quoteBlocks('> > deep', 1)).toEqual([{ kind: 'quote', children: [{ kind: 'p', text: '> deep' }] }]);
  });
});
