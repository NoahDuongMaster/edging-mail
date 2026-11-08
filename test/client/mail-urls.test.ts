/* eslint-disable unicorn/prefer-https -- these tests are about addresses written with http:// */
import { describe, expect, it } from 'vitest';
import { cssNamesAHost, namesAHost, srcsetNamesAHost, withoutRemoteCss } from '../../src/client/lib/mailUrls';

// PX-3: until the reader chose 'Show images' the document of a mail names no address of another host (`buildMailDocument`). These are the functions that
// decide what such an address is, and rewrite the style sheets. They are read the way a browser reads an address, because a sender hides them: tabs inside
// the scheme, backslashes, a scheme-relative `//host`. The document builder itself needs a DOM: scripts/frame-probe.mjs runs it in a browser.

describe('namesAHost', () => {
  it.each([
    'http://x.example/a.png',
    'https://x.example/a.png',
    'HTTPS://X.EXAMPLE/A.PNG',
    '//x.example/a.png',
    'ftp://x.example/a.png',
    'ws://x.example/socket',
    'http://127.0.0.1:9101/p/x',
    // What a sender writes to get past a pattern: a tab or a line break inside the scheme, spaces around, backslashes for slashes.
    'ht\ttp://x.example/a.png',
    'http\n://x.example/a.png',
    '  \t http://x.example/a.png',
    String.raw`http:\\x.example\a.png`,
    String.raw`\\x.example\a.png`
  ])('says yes to %j', (value) => {
    expect(namesAHost(value)).toBe(true);
  });

  it.each([
    '',
    'a.png',
    '/a.png',
    '../a.png',
    '#fragment',
    '?q=1',
    'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    'cid:logo@example.org',
    'mailto:a@example.org',
    'tel:+10000000',
    'javascript:void(0)',
    'about:blank',
    'http://',
    'http:///'
  ])('says no to %j', (value) => {
    expect(namesAHost(value)).toBe(false);
  });
});

describe('srcsetNamesAHost', () => {
  it.each([
    'https://x.example/a.png 1x',
    'a.png 1x, //x.example/b.png 2x',
    'a.png 100w,\nhttps://x.example/b.png 200w',
    '  http://x.example/a.png',
    // A comma inside an address: the first piece is still an address of another host.
    'https://x.example/a,b.png 1x'
  ])('says yes to %j', (value) => {
    expect(srcsetNamesAHost(value)).toBe(true);
  });

  it.each(['', 'a.png 1x, b.png 2x', 'data:image/gif;base64,R0lGODlhAQABAAAAACw= 1x', 'cid:logo@example.org 2x'])(
    'says no to %j',
    (value) => {
      expect(srcsetNamesAHost(value)).toBe(false);
    }
  );
});

const REMOTE_CSS = [
  'background:url(http://x.example/a.png)',
  "background:url('//x.example/a.png') no-repeat",
  'background: URL( "https://x.example/a.png" ) no-repeat red',
  'list-style-image:url(https://x.example/a.png)',
  'cursor:url(http://x.example/a.cur),auto',
  'background-image:image-set("https://x.example/a.png" 1x)',
  "background-image:-webkit-image-set('//x.example/a.png' 1x, 'b.png' 2x)",
  'background:image-set(url(https://x.example/a.png) 1x)',
  '@font-face{font-family:f;src:url(https://x.example/a.woff)}',
  'a{background:url(a.png),url(http://x.example/b.png)}'
];

describe('cssNamesAHost', () => {
  it.each(REMOTE_CSS)('says yes to %j', (css) => {
    expect(cssNamesAHost(css)).toBe(true);
  });

  it.each([
    '',
    'color:red',
    'background:url(a.png)',
    'background:url(#frag)',
    'background:url(data:image/png;base64,AAAA)',
    'src:url("data:font/woff2;base64,AAAA")',
    "font-family:'Geist',sans-serif",
    // Words, not an address to fetch.
    'p::before{content:"http://x.example"}'
  ])('says no to %j', (css) => {
    expect(cssNamesAHost(css)).toBe(false);
  });
});

describe('withoutRemoteCss', () => {
  it('turns the remote url() of every kind into an empty picture and leaves the rest of the declaration alone', () => {
    expect(withoutRemoteCss('a{background:url(http://x.example/a.png) no-repeat red}')).toBe('a{background:url("data:,") no-repeat red}');
    expect(withoutRemoteCss("a{background:url('//x.example/a.png')}")).toBe('a{background:url("data:,")}');
    expect(withoutRemoteCss('a{background:URL( "https://x.example/a.png" )}')).toBe('a{background:url("data:,")}');
    expect(withoutRemoteCss('a{background:url(a.png),url(http://x.example/b.png)}')).toBe('a{background:url(a.png),url("data:,")}');
  });

  it('drops an @import rule, with its media list, and keeps the rules after it (a semicolon inside the quotes does not end it)', () => {
    expect(withoutRemoteCss('@import url(http://x.example/a.css); p{color:red}')).toBe(' p{color:red}');
    expect(withoutRemoteCss('@import "http://x.example/a.css" screen;p{color:red}')).toBe('p{color:red}');
    expect(withoutRemoteCss("@IMPORT url('//x.example/a.css');p{color:red}")).toBe('p{color:red}');
    expect(withoutRemoteCss('@import url("http://x.example/a;b.css");p{color:red}')).toBe('p{color:red}');
  });

  it('empties the remote strings of an image-set and keeps the local ones', () => {
    expect(withoutRemoteCss('a{background-image:image-set("http://x.example/a.png" 1x, "b.png" 2x)}')).toBe(
      'a{background-image:image-set("data:," 1x, "b.png" 2x)}'
    );
  });

  it('leaves local addresses, fonts in the mail itself and plain text alone', () => {
    for (const css of [
      'a{background:url(a.png)}',
      'a{background:url(data:image/png;base64,AAAA)}',
      '@font-face{src:url("data:font/woff2;base64,AAAA")}',
      'p::before{content:"http://x.example"}',
      'p{color:red}'
    ]) {
      expect(withoutRemoteCss(css)).toBe(css);
    }
  });

  it('leaves nothing for cssNamesAHost to find, and gives the same answer when run again', () => {
    for (const css of REMOTE_CSS) {
      const once = withoutRemoteCss(css);
      expect(cssNamesAHost(once), css).toBe(false);
      expect(withoutRemoteCss(once)).toBe(once);
    }
  });
});
