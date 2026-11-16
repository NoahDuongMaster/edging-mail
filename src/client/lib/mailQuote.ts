// Received mail (J6-29): the quoted original at the end of a reply is folded behind "Show quoted text", as the compose already does with the
// mail it answers, so the new words come first. Plain text: the attribution line ("On Fri, 13 Nov 2026 at 16:05, Alex Morgan <...> wrote:")
// and the run of '>' lines after it, or an Outlook "Original Message" / From-Sent-Subject header block, when it ends the mail and something
// was written before it. HTML: the trailing .gmail_quote, Outlook's #divRplyFwdMsg (from the rule above it), Apple Mail's and Thunderbird's
// blockquote[type=cite] with its attribution, Yahoo's .yahoo_quoted or a last <blockquote>, wrapped in a native <details> element, which opens
// and closes without any script (the mail frame's sandbox stays as it is: no allow-scripts).

/** A reply split where its trailing quote starts. */
export interface QuoteSplit {
  /** What the sender wrote (lines before the quote, trailing blank lines dropped). */
  body: string;
  /** "On ..., X wrote:" (one line, re-joined if the sender's client wrapped it), or null when the quote has none. */
  attribution: string | null;
  /** The quoted lines as they are ('>' markers kept: `quoteBlocks` turns them into levels). */
  quote: string;
}

// The words mail clients put in an attribution line, in the languages people here write in and the common others.
const ATTRIBUTION_WORDS =
  /\b(wrote|writes|escribió|escreveu|a écrit|schrieb|ha scritto|schreef|skrev|kirjoitti|napisał|napsal)\b|đã viết|написал|写道|寫道|来信|來信/i;
const ENDS_WITH_COLON = /[:：]\s*$/;
// The first word of an attribution, in the clients' languages ("On Fri, ...", "Le lun. ...", "Am 16.11. ...", "Vào ...", "在 ...").
const OPENER = /^\s*(on|le|am|el|il|em|op|den|w dniu|vào|在)\s/i;
const QUOTED = /^\s*>/;
const SEPARATOR =
  /^\s*(-{2,}\s*(original message|ursprüngliche nachricht|message d'origine|mensaje original|thư gốc|原始邮件)\s*-{2,}|_{10,})\s*$/i;
const HEADER_FROM = /^\s*(from|von|de|từ|发件人|寄件者)\s*[:：]\s*\S/i;
const HEADER_SENT = /^\s*(sent|date|gesendet|envoyé|enviado|đã gửi|ngày|发送时间|日期)\s*[:：]/i;
const HEADER_SUBJECT = /^\s*(subject|betreff|objet|asunto|chủ đề|主题|主旨)\s*[:：]/i;

const blank = (line: string): boolean => line.trim() === '';

/** A line that introduces a quote: it ends with a colon and names the writing ("wrote") or carries an address and a date. */
export function isAttribution(line: string): boolean {
  if (!ENDS_WITH_COLON.test(line) || line.length > 400) {
    return false;
  }
  return ATTRIBUTION_WORDS.test(line) || (line.includes('@') && /\d/.test(line));
}

/** The first line of an Outlook header block ("From:" with "Sent:"/"Date:" and "Subject:" under it), or -1. */
function outlookHeader(lines: string[], end: number): number {
  for (let i = end - 1; i >= 0; i -= 1) {
    if (!HEADER_FROM.test(lines[i])) {
      continue;
    }
    const next = lines.slice(i + 1, Math.min(end, i + 7));
    if (next.some((line) => HEADER_SENT.test(line)) && next.some((line) => HEADER_SUBJECT.test(line))) {
      // A separator line just above it belongs to the quote.
      let above = i - 1;
      while (above >= 0 && blank(lines[above])) {
        above -= 1;
      }
      return above >= 0 && SEPARATOR.test(lines[above]) ? above : i;
    }
  }
  return -1;
}

/**
 * Finds the quote that ends a plain-text mail: null when there is none, or when nothing was written before it (a mail that is only a quote
 * is shown as it is). Blank lines between quoted lines belong to the quote; anything else after it means it is not trailing.
 */
export function splitQuote(text: string): QuoteSplit | null {
  const lines = text.replaceAll(/\r\n?/g, '\n').split('\n');
  let end = lines.length;
  while (end > 0 && blank(lines[end - 1])) {
    end -= 1;
  }
  let start = end;
  while (start > 0 && (QUOTED.test(lines[start - 1]) || blank(lines[start - 1]))) {
    start -= 1;
  }
  while (start < end && blank(lines[start])) {
    start += 1;
  }
  // `start`: where the sender's words stop; `quoteStart`: where the quote itself starts (after its attribution).
  const quoteStart = start;
  let attribution: string | null = null;
  if (start < end) {
    // The attribution: the paragraph right above the '>' lines when it ends with "wrote:" (a long one may have been wrapped in two or three
    // lines by the sender's client).
    let last = start - 1;
    while (last >= 0 && blank(lines[last])) {
      last -= 1;
    }
    if (last >= 0 && isAttribution(lines[last])) {
      // A long attribution may have been wrapped by the sender's client ("On Fri, ..., Alex Morgan <" / "alex@example.com> wrote:"): the
      // lines above belong to it only up to the one that opens it ("On", "Le", "Am", "Vào", "在"...), at most two more lines. Without such
      // an opener only the last line is the attribution: the lines above are the sender's own words.
      let first = last;
      while (!OPENER.test(lines[first]) && first > 0 && !blank(lines[first - 1]) && last - first < 2) {
        first -= 1;
      }
      if (!OPENER.test(lines[first])) {
        first = last;
      }
      attribution = lines
        .slice(first, last + 1)
        .map((line) => line.trim())
        .join(' ');
      start = first;
    }
  } else {
    const header = outlookHeader(lines, end);
    if (header < 0) {
      return null;
    }
    start = header;
  }
  const body = lines.slice(0, start);
  while (body.length > 0 && blank(body.at(-1) ?? '')) {
    body.pop();
  }
  if (!body.some((line) => !blank(line))) {
    return null;
  }
  return { body: body.join('\n'), attribution, quote: lines.slice(attribution === null ? start : quoteStart, end).join('\n') };
}

/** A quoted text as levels: paragraphs, and quotes inside it (each '>' a level, the markers gone). */
export type QuoteNode = { kind: 'p'; text: string } | { kind: 'quote'; children: QuoteNode[] };

/** Splits quoted text into paragraphs and nested quotes, stripping one '>' per level (at most `depth` levels; deeper ones stay as text). */
export function quoteBlocks(text: string, depth = 6): QuoteNode[] {
  const nodes: QuoteNode[] = [];
  const lines = text.split('\n');
  const stripped = lines.map((line) => (QUOTED.test(line) ? line.replace(/^\s*> ?/, '') : null));
  // A line that opens one more level here (none once the depth is used up: deeper '>' lines stay as text).
  const quotedAt = (index: number): boolean => depth > 0 && stripped[index] !== null;
  let i = 0;
  while (i < lines.length) {
    if (quotedAt(i)) {
      const inner: string[] = [];
      while (i < lines.length && quotedAt(i)) {
        inner.push(stripped[i] ?? '');
        i += 1;
      }
      nodes.push({ kind: 'quote', children: quoteBlocks(inner.join('\n'), depth - 1) });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && !quotedAt(i) && !blank(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length > 0) {
      nodes.push({ kind: 'p', text: paragraph.join('\n') });
    } else {
      i += 1;
    }
  }
  return nodes;
}

// ---------- HTML ----------

/** Whether nothing a person would see follows `node` up to the body (whitespace, <br>, empty elements and a signature-less tail). */
function nothingAfter(node: Element): boolean {
  let current: Element | null = node;
  while (current !== null && current.tagName !== 'BODY') {
    for (let next = current.nextSibling; next !== null; next = next.nextSibling) {
      if (next.nodeType === 3 && (next.textContent ?? '').trim() !== '') {
        return false;
      }
      if (next.nodeType === 1) {
        const element = next as Element;
        if (element.textContent.trim() !== '' || element.querySelector('img, table, video, svg') !== null) {
          return false;
        }
      }
    }
    current = current.parentElement;
  }
  return true;
}

/** The nodes to fold: the quote's first node and its later siblings (an Outlook quote runs from its rule to the end of its parent). */
function quoteRun(doc: Document): Node[] | null {
  const gmail = [...doc.querySelectorAll('.gmail_quote, .yahoo_quoted')].filter(
    (element) => element.parentElement?.closest('.gmail_quote, .yahoo_quoted, blockquote') === null
  );
  const last = gmail.at(-1);
  if (last !== undefined && nothingAfter(last)) {
    return [last];
  }
  // Outlook: on the web a rule and #divRplyFwdMsg (From, Sent, To, Subject); on the desktop a div with a top border holding the same lines.
  const outlook =
    doc.querySelector('#divRplyFwdMsg') ??
    [...doc.querySelectorAll("div[style*='border-top:solid']")].find((element) => HEADER_FROM.test(element.textContent)) ??
    null;
  if (outlook !== null && outlook.parentElement !== null) {
    let first: Element = outlook;
    const before = outlook.previousElementSibling;
    if (before !== null && before.tagName === 'HR') {
      first = before;
    }
    const run: Node[] = [];
    for (let node: Node | null = first; node !== null; node = node.nextSibling) {
      run.push(node);
    }
    if (nothingAfter(outlook.parentElement)) {
      return run;
    }
  }
  const quotes = [...doc.querySelectorAll('blockquote')].filter((element) => element.parentElement?.closest('blockquote') === null);
  const quote = quotes.at(-1);
  if (quote === undefined || !nothingAfter(quote)) {
    return null;
  }
  // Its attribution: the element (or text) right before it, when it reads "... wrote:".
  const run: Node[] = [quote];
  let previous = quote.previousSibling;
  while (previous !== null && previous.nodeType === 3 && (previous.textContent ?? '').trim() === '') {
    previous = previous.previousSibling;
  }
  if (previous !== null && previous.nodeName === 'BR') {
    previous = previous.previousSibling;
  }
  if (previous !== null && isAttribution((previous.textContent ?? '').trim().replaceAll(/\s+/g, ' '))) {
    run.unshift(previous);
  }
  return run;
}

/** The words of the fold's control, in the reader's language. */
export interface QuoteLabels {
  show: string;
  hide: string;
}

/**
 * Folds the trailing quote of an HTML mail into `<details class="em-quote">` with a `<summary>` that says "Show quoted text" (or "Hide
 * quoted text" while open: both are in it, the frame's style shows one). Nothing happens when there is no trailing quote or nothing before
 * it. Our words go in as text, never as markup. Returns whether it folded something.
 */
export function foldHtmlQuote(doc: Document, labels: QuoteLabels): boolean {
  const run = quoteRun(doc);
  if (run === null || run.length === 0) {
    return false;
  }
  const first = run[0];
  const parent = first.parentNode;
  if (parent === null) {
    return false;
  }
  // Something was written before it, or the mail is only a quote and stays as it is.
  const seen = doc.body.textContent.replaceAll(/\s+/g, '');
  const quoted = run
    .map((node) => node.textContent ?? '')
    .join('')
    .replaceAll(/\s+/g, '');
  if (seen.length - quoted.length <= 0 && doc.body.querySelector('img') === null) {
    return false;
  }
  const details = doc.createElement('details');
  details.className = 'em-quote';
  const summary = doc.createElement('summary');
  const dots = doc.createElement('span');
  dots.className = 'em-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.textContent = '\u2026';
  const show = doc.createElement('span');
  show.className = 'em-show';
  show.textContent = labels.show;
  const hide = doc.createElement('span');
  hide.className = 'em-hide';
  hide.textContent = labels.hide;
  // appendChild / insertBefore, not append() / before(): @cloudflare/workers-types overrides them with the HTMLRewriter signatures.
  /* eslint-disable unicorn/prefer-dom-node-append, unicorn/prefer-modern-dom-apis -- see above */
  summary.appendChild(dots);
  summary.appendChild(show);
  summary.appendChild(hide);
  const body = doc.createElement('div');
  body.className = 'em-quoted';
  parent.insertBefore(details, first);
  details.appendChild(summary);
  details.appendChild(body);
  for (const node of run) {
    body.appendChild(node);
  }
  /* eslint-enable unicorn/prefer-dom-node-append, unicorn/prefer-modern-dom-apis */
  return true;
}
