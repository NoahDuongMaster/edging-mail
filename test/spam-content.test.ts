import { describe, expect, it } from 'vitest';
import {
  analyse,
  hiddenText,
  imageOnly,
  linkIpAddress,
  linkShortener,
  linkTextMismatch,
  manyLinks,
  phishingPhrases,
  spamPhrasesWeight
} from '../src/worker/spam/content-rules';
import type { Content } from '../src/worker/spam/content-rules';
import { hostNamedBy, hostOfUrl, isIpHost, isShortener, registrableDomain, relatedHosts } from '../src/worker/spam/hosts';
import { decodeEntities, readable } from '../src/worker/spam/html-text';
import { isHiddenStyle } from '../src/worker/spam/html-style';
import { MAX_HTML_CHARS, scanHtml } from '../src/worker/spam/html-scan';
import { fold, matchedPhrases, PHISHING_PHRASES, SPAM_PHRASES } from '../src/worker/spam/phrases';
import { HIDDEN_TEXT_MIN, IMAGE_ONLY_UNDER, MANY_LINKS_OVER, SPAM_PHRASES_CAP } from '../src/worker/spam/rules';
import { facts } from './spam-helpers';

// The content rules one by one (links, hidden text, images, wording), the HTML scanner under them, and the bounds that keep hostile mail cheap.

const read = (html: string, text = ''): Content => analyse(facts({ html, text }));
const words = (count: number): string => 'hidden words '.repeat(count);
const hidden = (count: number): string => `<span style="display:none">${'x'.repeat(count)}</span><p>Visible text of some length here.</p>`;
const quick = (html: string): number => {
  const started = performance.now();
  scanHtml(html);
  return performance.now() - started;
};
const weight = (override: Parameters<typeof facts>[0]): number => spamPhrasesWeight(analyse(facts(override)));

describe('html text', () => {
  it('decodes named, decimal and hex entities, drops invisible padding and collapses blanks', () => {
    expect(decodeEntities('a&amp;b &#38; &#x26; &lt;x&gt; &quot;&apos;')).toBe('a&b & & <x> "\'');
    expect(decodeEntities('&zwnj;&#8204;&shy;')).toBe('\u200C');
    expect(decodeEntities('&unknownentity; &#0; &#1114112; &#xD800;')).toBe('?   ');
    expect(decodeEntities('&constructor; &toString; &hasOwnProperty;')).toBe('? ? ?');
    expect(readable('  Hello&nbsp;&nbsp;\n\t world&zwnj;&#847;&#8204;  ')).toBe(' Hello world ');
  });
});

describe('the HTML scanner', () => {
  it('collects anchors with their text, images, and the visible text', () => {
    const scan = scanHtml(
      '<html><head><title>Not shown</title><style>p{color:red}</style></head><body><p>Hello <b>there</b></p><a href="https://a.example/x">Click &amp; go</a><img src="a.png"><IMG SRC=b.png></body></html>'
    );
    expect(scan.anchors).toEqual([{ href: 'https://a.example/x', text: 'Click & go' }]);
    expect(scan.imageCount).toBe(2);
    expect(scan.visibleText).toBe('Hello there Click & go');
    expect(scan.visibleLength).toBe('Hellothere Click&go'.replaceAll(' ', '').length);
    expect(scan.hiddenLength).toBe(0);
  });

  it('skips script, style and title content and comments, in any case, up to the closing tag', () => {
    const scan = scanHtml(
      '<SCRIPT>if (a < b) { x = "</p>" }</SCRIPT>after<!-- <a href="https://x.example">c</a> -->done<Style>a{}</STYLE ><TITLE>t</title>'
    );
    expect(scan.anchors).toEqual([]);
    expect(scan.visibleText).toBe('afterdone');
  });

  it('a script that never ends hides the rest and costs nothing more', () => {
    expect(scanHtml('<p>seen</p><script>never closed <p>unseen</p>').visibleText).toBe('seen');
  });

  it('puts a space for a line or block tag but not for an inline one', () => {
    expect(scanHtml('Hello<br>World<b>Bold</b>Face<p>Next</p>').visibleText).toBe('Hello WorldBoldFace Next');
  });

  it('text that is not a tag stays text: a lone <, "a < b", an unterminated tag at the end', () => {
    expect(scanHtml('1 < 2 and 3 <4> 5 <').visibleText).toBe('1 < 2 and 3 <4> 5 <');
    expect(scanHtml('hello <a href="x').visibleText).toBe('hello');
  });

  it('attribute values: quoted with either quote, unquoted, and with a > inside quotes', () => {
    expect(
      scanHtml(
        '<a href="https://a.example/?x=1>2">one</a><a href=\'https://b.example\'>two</a><a HREF=https://c.example/z>three</a>'
      ).anchors.map((anchor) => anchor.href)
    ).toEqual(['https://a.example/?x=1>2', 'https://b.example', 'https://c.example/z']);
  });

  it('an anchor without href is no anchor; an anchor that is never closed ends at the next anchor or the end', () => {
    expect(scanHtml('<a name="x">top</a>').anchors).toEqual([]);
    expect(scanHtml('<a href="https://one.example">one<a href="https://two.example">two').anchors).toEqual([
      { href: 'https://one.example', text: 'one' },
      { href: 'https://two.example', text: 'two' }
    ]);
  });

  describe('hidden text', () => {
    it('knows each way to hide: display:none, visibility:hidden, font-size 0 and a text colour equal to the background', () => {
      for (const style of [
        'display:none',
        'DISPLAY : NONE !important',
        'visibility:hidden',
        'visibility: collapse',
        'font-size:0',
        'font-size: 0px',
        'font-size:0.0em',
        'font-size:0%',
        'color:#fff;background-color:#ffffff',
        'color: white; background: #fff url(x.png)',
        'color:rgb(255, 255, 255);background-color:#FFF',
        'background:white;color:white',
        'margin:0;display:none;padding:1px'
      ]) {
        expect(isHiddenStyle(style), style).toBe(true);
      }
      for (const style of [
        'display:block',
        'font-size:12px',
        'font-size:0.5em',
        'color:#fff;background-color:#000',
        'color:#fff',
        'background:#fff',
        'color:red;background:blue',
        '',
        'x',
        ':;::'
      ]) {
        expect(isHiddenStyle(style), style).toBe(false);
      }
    });

    it('counts the text inside hidden elements, and inside what is inside them, but not after they close', () => {
      const scan = scanHtml(
        `<div>shown</div><div style="display:none"><p>one</p><span>two</span></div><div>after</div><span style="font-size:0">x</span>`
      );
      expect(scan.visibleText).toBe('shown after');
      expect(scan.hiddenLength).toBe('onetwox'.length);
    });

    it('a hidden element closed out of order or never closed does not leave the rest of the mail hidden after its parent ends', () => {
      const scan = scanHtml('<div><p style="display:none">gone<span>also</div>visible after the div');
      expect(scan.visibleText).toBe('visible after the div');
    });

    it('hidden_text needs at least HIDDEN_TEXT_MIN printed characters: a short hidden preheader is common in honest mail', () => {
      expect(hiddenText(read(hidden(HIDDEN_TEXT_MIN - 1)))).toBe(false);
      expect(hiddenText(read(hidden(HIDDEN_TEXT_MIN)))).toBe(true);
      // padding does not count: entities that print nothing
      expect(hiddenText(read(`<div style="display:none">${'&zwnj;&nbsp;&#847;'.repeat(200)}</div>`))).toBe(false);
      expect(hiddenText(read(`<div style="color:#fff;background:#fff">${words(30)}</div>`))).toBe(true);
    });
  });

  describe('bounds on hostile HTML', () => {
    it('reads at most MAX_HTML_CHARS characters', () => {
      const scan = scanHtml(`<p>${'a'.repeat(MAX_HTML_CHARS)}</p><a href="https://late.example">late</a>`);
      expect(scan.anchors).toEqual([]);
    });

    it('finishes fast on shapes that hurt careless scanners (each 190 kB)', () => {
      const size = 190_000;
      const shapes: Record<string, string> = {
        'many <': '<'.repeat(size),
        'many <a': '<a '.repeat(size / 3),
        'many open tags': '<div>'.repeat(size / 5),
        'many closers': '</div>'.repeat(size / 6),
        'many unterminated attributes': '<a href="'.repeat(size / 9),
        'one huge attribute': `<a href="${'x'.repeat(size)}`,
        'many equals': '<a ====== ======= ='.repeat(size / 20),
        'many hidden opens': '<div style="display:none">'.repeat(size / 26),
        'many anchors': '<a href="https://x.example/">y</a>'.repeat(size / 33),
        'many comments': '<!--'.repeat(size / 4),
        'many scripts': '<script>'.repeat(size / 8),
        'many entities': '&amp;&#x41;&bogus;'.repeat(size / 18),
        'many images': '<img src=x>'.repeat(size / 11),
        'deep then shallow': '<b>'.repeat(size / 6) + '</b>'.repeat(size / 6)
      };
      for (const [name, html] of Object.entries(shapes)) {
        expect(quick(html), name).toBeLessThan(1500);
      }
    });

    it('keeps its collections bounded', () => {
      const scan = scanHtml('<a href="https://x.example/">y</a>'.repeat(5000));
      expect(scan.anchors.length).toBeLessThanOrEqual(1000);
      expect(scanHtml(`<a href="https://x.example/">${'t'.repeat(100_000)}</a>`).anchors[0]?.text.length).toBeLessThanOrEqual(300);
      expect(scanHtml(`<p>${'word '.repeat(100_000)}</p>`).visibleText.length).toBeLessThanOrEqual(20_000);
    });
  });
});

describe('hosts', () => {
  it('hostOfUrl: http(s) and protocol-relative links only; the URL parser normalises odd forms', () => {
    expect(hostOfUrl('https://Example.COM/path?x=1')).toBe('example.com');
    expect(hostOfUrl(' https://example.com:8080/ ')).toBe('example.com');
    expect(hostOfUrl('//cdn.example.com/x')).toBe('cdn.example.com');
    expect(hostOfUrl('https://user:pw@example.com@evil.example/')).toBe('evil.example');
    expect(hostOfUrl('http://3232235777/')).toBe('192.168.1.1');
    expect(hostOfUrl('http://0xC0A80101/')).toBe('192.168.1.1');
    expect(hostOfUrl('http://[::1]/')).toBe('[::1]');
    expect(hostOfUrl('http&#58;//example.com')).toBe('example.com');
    expect(hostOfUrl('&#104;ttp://example.com/')).toBe('example.com');
    for (const href of [
      'mailto:a@b.example',
      'tel:+1',
      '#top',
      '/relative',
      'javascript:alert(1)',
      'cid:abc',
      'ftp://a.example',
      '',
      'http://',
      'https://exa mple.com'
    ]) {
      expect(hostOfUrl(href), href).toBeNull();
    }
  });

  it('isIpHost, isShortener, registrableDomain and relatedHosts', () => {
    expect(isIpHost('192.168.1.1')).toBe(true);
    expect(isIpHost('[::1]')).toBe(true);
    expect(isIpHost('1.2.3.example.com')).toBe(false);
    expect(isShortener('bit.ly')).toBe(true);
    expect(isShortener('www.tinyurl.com')).toBe(true);
    expect(isShortener('t.co')).toBe(false);
    expect(isShortener('notbit.ly')).toBe(false);
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('a.b.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('x.gov.vn')).toBe('x.gov.vn');
    expect(registrableDomain('example.com')).toBe('example.com');
    expect(relatedHosts('mail.example.com', 'example.com')).toBe(true);
    expect(relatedHosts('example.com', 'mail.example.com')).toBe(true);
    expect(relatedHosts('a.example.com', 'b.example.com')).toBe(true);
    expect(relatedHosts('notexample.com', 'example.com')).toBe(false);
    expect(relatedHosts('example.com.evil.example', 'example.com')).toBe(false);
    expect(relatedHosts('192.168.1.1', '10.1.1.1')).toBe(false);
  });

  it('hostNamedBy: a URL or web address as the whole text; a bare brand domain is not an address', () => {
    expect(hostNamedBy('https://www.paypal.com/signin')).toBe('www.paypal.com');
    expect(hostNamedBy('HTTP://PayPal.com')).toBe('paypal.com');
    expect(hostNamedBy('www.paypal.com')).toBe('www.paypal.com');
    expect(hostNamedBy('paypal.com/login')).toBe('paypal.com');
    for (const text of [
      'paypal.com',
      'Walmart.com',
      'Click here',
      'www',
      'www.paypal.com now',
      'see https://paypal.com',
      '',
      ' '.repeat(3),
      'https://',
      '1.2.3.4/x',
      `www.${'a'.repeat(400)}.com`
    ]) {
      expect(hostNamedBy(text), text).toBeNull();
    }
  });
});

describe('link rules', () => {
  it('link_text_mismatch: the text names one site, the link goes to another', () => {
    expect(linkTextMismatch(read('<a href="https://evil.example/login">https://www.paypal.com/signin</a>'))).toBe(true);
    expect(linkTextMismatch(read('<a href="https://www.paypal.com.evil.example/">www.paypal.com</a>'))).toBe(true);
    expect(linkTextMismatch(read('<a href="https://tracker.example/c?u=1">paypal.com/signin</a>'))).toBe(true);
    // the same site, its subdomain or a sibling
    expect(linkTextMismatch(read('<a href="https://www.paypal.com/x">https://paypal.com/signin</a>'))).toBe(false);
    expect(linkTextMismatch(read('<a href="https://click.brand.com/x">www.brand.com</a>'))).toBe(false);
    // text that is not a web address, a bare brand, or a link that is not http(s)
    expect(linkTextMismatch(read('<a href="https://evil.example/">Sign in to PayPal</a>'))).toBe(false);
    expect(linkTextMismatch(read('<a href="https://tracker.example/">Walmart.com</a>'))).toBe(false);
    expect(linkTextMismatch(read('<a href="mailto:a@brand.com">www.other.com</a>'))).toBe(false);
    expect(linkTextMismatch(read('<a href="https://evil.example/"><img src="x"></a>'))).toBe(false);
  });

  it('link_ip_address: a link whose host is an address, in HTML or written out in the text', () => {
    expect(linkIpAddress(read('<a href="http://192.168.4.5/x">here</a>'))).toBe(true);
    expect(linkIpAddress(read('<a href="http://3232235777/x">here</a>'))).toBe(true);
    expect(linkIpAddress(read('', 'visit http://10.0.0.1/login now'))).toBe(true);
    expect(linkIpAddress(read('', 'visit https://[2001:db8::1]/login now'))).toBe(true);
    expect(linkIpAddress(read('<a href="https://example.com/192.168.4.5">here</a>'))).toBe(false);
    expect(linkIpAddress(read('', 'version 1.2.3.4 released'))).toBe(false);
  });

  it('link_shortener: bit.ly and the others, not t.co', () => {
    for (const host of ['bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'cutt.ly', 'rb.gy', 't.ly', 'shorturl.at', 'rebrand.ly']) {
      expect(linkShortener(read(`<a href="https://${host}/abc">x</a>`)), host).toBe(true);
    }
    expect(linkShortener(read('<a href="https://t.co/abc">x</a>'))).toBe(false);
    expect(linkShortener(read('', 'see https://bit.ly/abc'))).toBe(true);
  });

  it('many_links: more than 15 different hosts (the same host again does not count)', () => {
    const links = (count: number): string =>
      Array.from({ length: count }, (_, index) => `<a href="https://site${index}.example/">x</a>`).join('');
    expect(manyLinks(read(links(MANY_LINKS_OVER)))).toBe(false);
    expect(manyLinks(read(links(MANY_LINKS_OVER + 1)))).toBe(true);
    expect(manyLinks(read('<a href="https://one.example/a">a</a>'.repeat(50)))).toBe(false);
    expect(manyLinks(read('', Array.from({ length: 20 }, (_, index) => `https://t${index}.example/`).join(' ')))).toBe(true);
  });

  it('keeps at most 200 hosts however many links there are', () => {
    const many = Array.from({ length: 1000 }, (_, index) => `<a href="https://h${index}.example/">x</a>`).join('');
    expect(read(many).hosts.size).toBe(200);
  });
});

describe('image_only', () => {
  it('HTML with an image and fewer than 20 printed characters of visible text', () => {
    expect(imageOnly(read('<img src="a.jpg">'))).toBe(true);
    expect(imageOnly(read(`<img src="a.jpg"><p>${'x'.repeat(IMAGE_ONLY_UNDER - 1)}</p>`))).toBe(true);
    expect(imageOnly(read(`<img src="a.jpg"><p>${'x'.repeat(IMAGE_ONLY_UNDER)}</p>`))).toBe(false);
    expect(imageOnly(read('<p>No image here, only a few words.</p>'))).toBe(false);
    // text that is hidden or only padding is not visible text
    expect(imageOnly(read(`<img src="a.jpg"><div style="display:none">${words(5)}</div>`))).toBe(true);
    expect(imageOnly(read(`<img src="a.jpg">${'&nbsp;&zwnj;'.repeat(30)}`))).toBe(true);
    // a mail with no HTML at all is not image-only
    expect(imageOnly(read('', 'plain text'))).toBe(false);
  });
});

describe('wording', () => {
  it('folds case, accents, the Vietnamese đ, curly quotes and blanks', () => {
    expect(fold('  Bạn  ĐÃ\nTrúng Thưởng ')).toBe('ban da trung thuong');
    expect(fold('You’ve WON')).toBe("you've won");
  });

  it('has a list in each of English, Vietnamese and Chinese, for spam wording and for account threats', () => {
    const texts = SPAM_PHRASES.map((phrase) => phrase.text);
    expect(texts).toContain('you have won');
    expect(texts).toContain('ban da trung thuong');
    expect(texts).toContain('恭喜您中奖');
    expect(PHISHING_PHRASES.map((phrase) => phrase.text)).toEqual(
      expect.arrayContaining(['verify your account', 'xac minh tai khoan', '验证您的账户'])
    );
    expect(new Set(texts).size).toBe(texts.length);
    expect(SPAM_PHRASES.filter((phrase) => /[\u4E00-\u9FFF]/.test(phrase.text)).length).toBeGreaterThanOrEqual(15);
    expect(SPAM_PHRASES.filter((phrase) => /^[a-z0-9 '%$-]+$/.test(phrase.text)).length).toBeGreaterThanOrEqual(40);
  });

  it('matches a phrase written with or without accents, in any case, across blanks', () => {
    expect(matchedPhrases(fold('YOU   HAVE\nWON a prize'), SPAM_PHRASES)).toEqual(['you have won']);
    expect(matchedPhrases(fold('Bạn đã trúng thưởng!'), SPAM_PHRASES)).toEqual(['ban da trung thuong']);
    expect(matchedPhrases(fold('ban da trung thuong'), SPAM_PHRASES)).toEqual(['ban da trung thuong']);
    expect(matchedPhrases(fold('恭喜您中奖，请点击领取'), SPAM_PHRASES)).toEqual(['恭喜您中奖', '点击领取']);
  });

  it('a Latin phrase must not touch other letters: "ca do" is not inside "Monica does", viagra is not "viagrafield"', () => {
    expect(matchedPhrases(fold('Monica does the cooking'), SPAM_PHRASES)).toEqual([]);
    expect(matchedPhrases(fold('he plays ca do on Sunday'), SPAM_PHRASES)).toEqual(['ca do']);
    expect(matchedPhrases(fold('viagrafield is a place'), SPAM_PHRASES)).toEqual([]);
    expect(matchedPhrases(fold('buy viagra, now'), SPAM_PHRASES)).toEqual(['viagra']);
    expect(matchedPhrases(fold('xviagra viagrax xviagrax'), SPAM_PHRASES)).toEqual([]);
  });

  it('spam_phrases: 2 for each distinct phrase, at most 6, in the subject or the first 20000 characters of the body (text or HTML)', () => {
    const phrases = ['you have won', 'claim your prize', 'wire transfer', 'viagra', 'online casino'];
    expect(weight({})).toBe(0);
    expect(weight({ text: phrases[0] })).toBe(2);
    expect(weight({ text: phrases.slice(0, 2).join('. ') })).toBe(4);
    expect(weight({ text: phrases.slice(0, 3).join('. ') })).toBe(SPAM_PHRASES_CAP);
    expect(weight({ text: phrases.join('. ') })).toBe(SPAM_PHRASES_CAP);
    // the same phrase twice is one phrase
    expect(weight({ text: 'you have won. YOU HAVE WON. you have won' })).toBe(2);
    expect(weight({ subject: 'You have won', text: 'x', html: '<p>Claim your prize</p>' })).toBe(4);
    // phrases after the first 20000 characters of the body are not looked at
    expect(weight({ text: `${'x '.repeat(10_001)}you have won` })).toBe(0);
    expect(weight({ text: `${'x '.repeat(9000)}you have won` })).toBe(2);
    // wording inside hidden elements is not read, only what a reader sees
    expect(weight({ html: '<div style="display:none">you have won</div><p>hello</p>' })).toBe(0);
  });

  it('phishing_phrases: account-threat wording, and only with a link', () => {
    expect(phishingPhrases(read('<p>Please verify your account</p>'))).toBe(false);
    expect(phishingPhrases(read('<p>Please verify your account</p><a href="https://x.example/">here</a>'))).toBe(true);
    expect(phishingPhrases(read('', 'Please verify your account at https://x.example/login'))).toBe(true);
    expect(phishingPhrases(read('<p>Xác minh tài khoản của bạn</p><a href="https://x.example/">here</a>'))).toBe(true);
    expect(phishingPhrases(read('', '您的账户已被冻结 https://x.example/'))).toBe(true);
    // a link, no wording
    expect(phishingPhrases(read('<p>Here is the report</p><a href="https://x.example/">here</a>'))).toBe(false);
  });

  it('a hostile text of 5 MB costs a moment', () => {
    const started = performance.now();
    const analysed = analyse(
      facts({ text: 'viagra '.repeat(1_000_000).slice(0, 5_000_000), html: `<p>${'you have won '.repeat(400_000)}</p>` })
    );
    expect(performance.now() - started).toBeLessThan(1500);
    expect(analysed.spamPhrases).toEqual(expect.arrayContaining(['viagra', 'you have won']));
  });
});
