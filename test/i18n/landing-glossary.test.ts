import { describe, expect, it } from 'vitest';
import glossary from '../../src/shared/i18n/glossary.json';
import { copyEn } from '../../src/worker/site/copy.en';
import { copyVi } from '../../src/worker/site/copy.vi';
import { copyZh } from '../../src/worker/site/copy.zh';

// The landing pages and the app use the same agreed words (design.md section 20.5, Marketing's glossary rules 1-12).

const COPIES = [
  ['en', copyEn],
  ['vi', copyVi],
  ['zh-CN', copyZh]
] as const;

function everything(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(everything);
  }
  return value !== null && typeof value === 'object' ? Object.values(value).flatMap(everything) : [];
}
const wholeText = (copy: unknown): string => everything(copy).join('\n');

describe('the landing pages and the glossary', () => {
  const folders = glossary.rows.filter((row) => row.id.startsWith('folder.') && row.id !== 'folder.labels');

  it.each(COPIES)('name the folders in %s exactly as the glossary does', (locale, copy) => {
    const card = copy.features.cards[0];
    for (const row of folders) {
      expect(card.text, `${locale} folder card lacks "${row[locale]}"`).toContain(row[locale]);
    }
  });

  it.each(COPIES)('call the sign-in button in %s what the glossary calls it', (locale, copy) => {
    const row = glossary.rows.find((candidate) => candidate.id === 'auth.sign_in');
    expect(copy.cta.signIn).toBe(row?.[locale]);
  });

  it.each(COPIES)('use in %s every glossary term that is marked as used on the landing', (locale, copy) => {
    const text = wholeText(copy).toLowerCase();
    for (const row of glossary.rows.filter((candidate) => (candidate as { landing?: boolean }).landing === true)) {
      expect(text, `${locale} landing lacks "${row[locale]}" (${row.id})`).toContain(row[locale].toLowerCase());
    }
  });

  it('never calls a message a conversation, on any page', () => {
    const forbidden: Record<string, RegExp> = { en: /conversation/i, vi: /cuộc hội thoại|hội thoại/i, 'zh-CN': /对话/ };
    for (const [locale, copy] of COPIES) {
      for (const text of everything(copy)) {
        expect(text, `${locale}: ${text.slice(0, 40)}`).not.toMatch(forbidden[locale] ?? /$^/);
      }
    }
  });

  it('writes the Chinese word for a session only as a sign-in session', () => {
    expect(wholeText(copyZh).replaceAll('登录会话', '')).not.toContain('会话');
  });

  it('writes Vietnamese with the tone on the o, never says "Mở khóa" for enabling an account, and spaces Latin text in Chinese', () => {
    expect(wholeText(copyVi)).not.toMatch(/(?<!\p{L})(?:h|kh|x)o[àáảãạ](?!\p{L})/iu);
    expect(wholeText(copyVi)).not.toMatch(/mở khóa/i);
    expect(wholeText(copyVi)).not.toMatch(/nhật ký kiểm tra/i);
    expect(wholeText(copyZh)).not.toMatch(/[\u4E00-\u9FFF][A-Za-z0-9]|[A-Za-z0-9][\u4E00-\u9FFF]/);
  });
});
