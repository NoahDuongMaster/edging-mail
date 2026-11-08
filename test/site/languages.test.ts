import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleSite } from '../../src/worker/site';
import { copyEn } from '../../src/worker/site/copy.en';
import { copyVi } from '../../src/worker/site/copy.vi';
import { copyZh } from '../../src/worker/site/copy.zh';

const ctx = createExecutionContext();
const env = { LANDING_PAGE: 'on' };
const host = 'https://mail.example.com';

async function fetchText(origin: string, path: string): Promise<string> {
  const response = await handleSite(new Request(`${origin}${path}`), env, ctx, () => Promise.resolve(false));
  if (response === undefined) {
    throw new Error(`${path} is not a site path`);
  }
  return response.text();
}

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

describe('the three languages', () => {
  it('have their own titles and descriptions', () => {
    const copies = [copyVi, copyEn, copyZh];
    expect(new Set(copies.map((copy) => copy.meta.title)).size).toBe(3);
    expect(new Set(copies.map((copy) => copy.meta.description)).size).toBe(3);
    expect(new Set(copies.map((copy) => copy.og.title)).size).toBe(3);
  });

  it('offer the other two languages in the header and all three in the footer, the current one as plain text', async () => {
    const pages = [
      { path: '/', here: 'vi', others: ['en', 'zh-CN'], label: 'Ngôn ngữ' },
      { path: '/en/', here: 'en', others: ['vi', 'zh-CN'], label: 'Language' },
      { path: '/zh/', here: 'zh-CN', others: ['vi', 'en'], label: '语言' }
    ];
    const links: Record<string, string> = {
      vi: 'href="/" hreflang="vi" lang="vi">Tiếng Việt</a>',
      en: 'href="/en/" hreflang="en" lang="en">English</a>',
      'zh-CN': 'href="/zh/" hreflang="zh-CN" lang="zh-CN">简体中文</a>'
    };
    for (const page of pages) {
      const text = await fetchText(host, page.path);
      const header = /<header[\s\S]*?<\/header>/.exec(text)?.[0] ?? '';
      const footer = /<footer[\s\S]*?<\/footer>/.exec(text)?.[0] ?? '';
      for (const other of page.others) {
        expect(header).toContain(links[other]);
        expect(footer).toContain(links[other]);
      }
      expect(header).not.toContain(links[page.here]);
      expect(footer).not.toContain(links[page.here]);
      expect(footer).toContain(`<span aria-current="true" lang="${page.here}">`);
      expect(count(footer, /aria-current/g)).toBe(1);
      // The header switch is one labelled group with the languages in a fixed order; the current one is marked, not a link.
      expect(header).toContain(`<nav class="seg" aria-label="${page.label}">`);
      expect(header).toContain(`<span aria-current="true" lang="${page.here}">`);
      expect(count(header, /aria-current/g)).toBe(1);
      expect(count(header, /hreflang=/g)).toBe(2);
      const nav = /<nav class="seg"[\s\S]*?<\/nav>/.exec(header)?.[0] ?? '';
      expect([...nav.matchAll(/(?<!href)lang="([\w-]+)"/g)].map((match) => match[1])).toEqual(['vi', 'en', 'zh-CN']);
    }
  });

  it('send installed apps from / to the app, on the Vietnamese page only', async () => {
    expect(await fetchText(host, '/')).toContain('<script src="/standalone.js" defer></script>');
    expect(await fetchText(host, '/en/')).not.toContain('standalone.js');
    expect(await fetchText(host, '/zh/')).not.toContain('standalone.js');
  });

  it('note that the deploy guide is in English, on the Vietnamese and Chinese pages (hero and closing)', async () => {
    expect(count(await fetchText(host, '/'), /\(hướng dẫn bằng tiếng Anh\)/g)).toBe(2);
    expect(count(await fetchText(host, '/zh/'), /（部署指南为英文）/g)).toBe(2);
    expect(await fetchText(host, '/en/')).not.toContain('<span class="note">');
  });

  it('give the Chinese page the system CJK fonts and no CJK font download (the one web font is Geist, from this origin)', async () => {
    const text = await fetchText(host, '/zh/');
    const body = /body\{[^}]*font:[^}]*\}/.exec(text)?.[0] ?? '';
    for (const family of ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC']) {
      expect(body).toContain(`'${family}'`);
    }
    // Every @font-face reads a file of this origin under /fonts; nothing is fetched from a font service.
    const faces = text.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/src:url\('\/fonts\/[\w.-]+\.woff2'\)/);
      expect(face).not.toMatch(/PingFang|Hiragino|YaHei|CJK/);
    }
    expect(text).not.toMatch(/fonts\.(googleapis|gstatic)|<link[^>]+rel="stylesheet"/);
  });
});

describe('sitemap.xml', () => {
  it('lists the three pages with their alternates, from the request origin', async () => {
    const text = await fetchText('https://example.org', '/sitemap.xml');
    for (const path of ['/', '/en/', '/zh/']) {
      expect(text).toContain(`<loc>https://example.org${path}</loc>`);
    }
    expect(count(text, /<url>/g)).toBe(3);
    expect(count(text, /hreflang="vi" href="https:\/\/example\.org\/"/g)).toBe(3);
    expect(count(text, /hreflang="en" href="https:\/\/example\.org\/en\/"/g)).toBe(3);
    expect(count(text, /hreflang="zh-CN" href="https:\/\/example\.org\/zh\/"/g)).toBe(3);
    expect(count(text, /hreflang="x-default" href="https:\/\/example\.org\/"/g)).toBe(3);
    expect(text).not.toContain('/app');
  });
});
