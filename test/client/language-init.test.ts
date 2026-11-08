import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale } from '../../src/shared/i18n';
import { initLanguage, LANGUAGE_STORAGE_KEY, useLanguageSync } from '../../src/client/lib/i18n';
import type { SessionLanguage } from '../../src/client/lib/i18n';
import { languageToAdopt } from '../../src/client/lib/language';

// The language of the screen before the first render (`initLanguage`) and once the session is known (`useLanguageSync`), against a stand-in
// window, navigator and document (the tests run in workerd: none of them exists). The order is spec 20.1: the account language, then `?lang=`,
// then the device choice, then the browser, then the organisation default, then English.

// The hook is called outside React: an effect runs at once, which is all `useLanguageSync` needs from React.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEffect: (effect: () => void) => {
    effect();
  }
}));

interface Page {
  readonly store: Map<string, string>;
  readonly html: { lang: string };
}

/** A page whose address has `search`, whose picker choice is `device` and whose browser prefers `languages`. */
function openPage(options: { search?: string; device?: string; languages?: string[] } = {}): Page {
  const store = new Map<string, string>(options.device === undefined ? [] : [[LANGUAGE_STORAGE_KEY, options.device]]);
  const html = { lang: 'en' };
  vi.stubGlobal('window', {
    location: { search: options.search ?? '' },
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) }
  });
  vi.stubGlobal('navigator', { languages: options.languages ?? [] });
  Object.defineProperty(globalThis, 'document', { value: { documentElement: html }, configurable: true });
  return { store, html };
}

beforeEach(async () => {
  await setLocale('en');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'document');
  await setLocale('en');
});

describe('initLanguage (before the first render)', () => {
  it('takes the browser language, and English when the browser asks for none we have', async () => {
    const page = openPage({ languages: ['vi-VN', 'en'] });
    await initLanguage();
    expect(getLocale()).toBe('vi');
    expect(page.html.lang).toBe('vi');
    await setLocale('en');
    openPage({ languages: ['fr-FR', 'de'] });
    await initLanguage();
    expect(getLocale()).toBe('en');
  });

  it('prefers the device choice to the browser, and a ?lang= link to both', async () => {
    openPage({ device: 'zh-CN', languages: ['vi'] });
    await initLanguage();
    expect(getLocale()).toBe('zh-CN');
    await setLocale('en');
    openPage({ search: '?lang=vi', device: 'zh-CN', languages: ['en'] });
    await initLanguage();
    expect(getLocale()).toBe('vi');
  });

  it('ignores a choice that is not one of our languages', async () => {
    openPage({ search: '?lang=klingon', device: 'xx', languages: ['zh-CN'] });
    await initLanguage();
    expect(getLocale()).toBe('zh-CN');
  });

  it('never saves what a link or the browser chose: only the picker writes the device choice', async () => {
    const page = openPage({ search: '?lang=vi', languages: ['zh'] });
    await initLanguage();
    expect(page.store.has(LANGUAGE_STORAGE_KEY)).toBe(false);
  });

  it('starts when the device cannot read its storage', async () => {
    openPage({ languages: ['vi'] });
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: {
        getItem: () => {
          throw new Error('storage blocked');
        },
        setItem: () => {
          throw new Error('storage blocked');
        }
      }
    });
    await initLanguage();
    expect(getLocale()).toBe('vi');
  });
});

async function settled(locale: string): Promise<void> {
  await vi.waitFor(() => {
    expect(getLocale()).toBe(locale);
  });
}

describe('useLanguageSync (once the session is known)', () => {
  it('does nothing until there is a session', async () => {
    const page = openPage({ device: 'vi' });
    const notRead: { session?: SessionLanguage } = {};
    useLanguageSync(notRead.session);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(getLocale()).toBe('en');
    expect(page.html.lang).toBe('en');
  });

  it('puts the language of the account over a link, the device and the browser, and keeps it on the device', async () => {
    const page = openPage({ search: '?lang=vi', device: 'vi', languages: ['en'] });
    useLanguageSync({ language: 'zh-CN', default_language: 'en' });
    await settled('zh-CN');
    expect(page.html.lang).toBe('zh-CN');
    await vi.waitFor(() => {
      expect(page.store.get(LANGUAGE_STORAGE_KEY)).toBe('zh-CN');
    });
  });

  it('takes the organisation default only when nothing else speaks, and does not keep it on the device', async () => {
    const page = openPage({ languages: [] });
    useLanguageSync({ language: null, default_language: 'vi' });
    await settled('vi');
    expect(page.store.has(LANGUAGE_STORAGE_KEY)).toBe(false);
  });

  it('lets the device or the browser win over the organisation default when the account has no language', async () => {
    openPage({ device: 'zh-CN' });
    useLanguageSync({ language: null, default_language: 'vi' });
    await settled('zh-CN');
    await setLocale('en');
    openPage({ languages: ['vi'] });
    useLanguageSync({ default_language: 'zh-CN' });
    await settled('vi');
  });

  it('ignores an account language that this build does not have', async () => {
    const page = openPage({ device: 'vi' });
    useLanguageSync({ language: 'xx', default_language: 'zh-CN' });
    await settled('vi');
    expect(page.store.get(LANGUAGE_STORAGE_KEY)).toBe('vi');
  });
});

describe('languageToAdopt (the language chosen on the sign-in picker is saved to the account)', () => {
  const base = { authenticated: true, saved: null, gateOpen: false, device: 'vi' };

  it('is due when signed in, with no saved language, a device choice and no gate open', () => {
    expect(languageToAdopt(base)).toBe('vi');
    expect(languageToAdopt({ ...base, device: 'zh-CN' })).toBe('zh-CN');
  });

  it('waits while a gate is open: the server refuses settings until the first sign-in is done (C-8)', () => {
    expect(languageToAdopt({ ...base, gateOpen: true })).toBeUndefined();
    // The same inputs a moment later, with the last gate done.
    expect(languageToAdopt({ ...base, gateOpen: false })).toBe('vi');
  });

  it('is not due when nobody is signed in, the account already has a language, or the session is not read yet', () => {
    expect(languageToAdopt({ ...base, authenticated: false })).toBeUndefined();
    expect(languageToAdopt({ ...base, saved: 'zh-CN' })).toBeUndefined();
    expect(languageToAdopt({ ...base, saved: undefined })).toBeUndefined();
  });

  it('is not due without a device choice, or with one that is not a language of this build', () => {
    expect(languageToAdopt({ ...base, device: null })).toBeUndefined();
    expect(languageToAdopt({ ...base, device: 'klingon' })).toBeUndefined();
  });
});
