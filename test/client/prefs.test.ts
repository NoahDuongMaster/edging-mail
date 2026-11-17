import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMotionPref,
  DEFAULT_PREFS,
  applyDensityPref,
  parsePrefs,
  PREFS_STORAGE_KEY,
  readPrefs,
  reloadPrefs,
  setPref,
  subscribePrefs,
  UNDO_SEND_CHOICES
} from '../../src/client/lib/prefs';

// The preferences of this device (lib/prefs.ts): what is read when nothing is stored or the stored text is damaged, what a change writes,
// and the `data-motion` attribute the reduced-motion CSS and ui/motion.ts read. localStorage and <html> are stand-ins (no DOM in Node).

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;
let html: { dataset: Record<string, string | undefined> };

beforeEach(() => {
  storage = new MemoryStorage();
  html = { dataset: {} };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { documentElement: html });
  reloadPrefs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  reloadPrefs();
});

// The fields the older cases do not look at, at their defaults.
const REST = { density: 'comfortable', undoSend: 10 } as const;

describe('parsePrefs', () => {
  it('gives the defaults (motion follows the system, single-key shortcuts on) for nothing, an empty or a damaged text', () => {
    expect(DEFAULT_PREFS).toEqual({ motion: 'system', shortcuts: true, density: 'comfortable', undoSend: 10 });
    for (const raw of [null, '', '{', 'null', '42', '"reduce"', '[]']) {
      expect(parsePrefs(raw), String(raw)).toEqual(DEFAULT_PREFS);
    }
  });

  it('keeps what is valid and drops what is not, field by field', () => {
    expect(parsePrefs('{"motion":"reduce","shortcuts":false}')).toEqual({ ...REST, motion: 'reduce', shortcuts: false });
    expect(parsePrefs('{"motion":"wild","shortcuts":"no","density":"tiny","undoSend":7}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"shortcuts":false}')).toEqual({ ...REST, motion: 'system', shortcuts: false });
    expect(parsePrefs('{"density":"compact","undoSend":0}')).toEqual({ ...DEFAULT_PREFS, density: 'compact', undoSend: 0 });
    expect(parsePrefs('{"undoSend":30}').undoSend).toBe(30);
    // J1-16: 60 and 120 s, so the wait can be set to over ten times the 10 s default (WCAG 2.2.1); anything else is still refused.
    expect(parsePrefs('{"undoSend":60}').undoSend).toBe(60);
    expect(parsePrefs('{"undoSend":120}').undoSend).toBe(120);
    expect(parsePrefs('{"undoSend":90}').undoSend).toBe(DEFAULT_PREFS.undoSend);
    expect(UNDO_SEND_CHOICES).toEqual([0, 5, 10, 20, 30, 60, 120]);
    expect(Math.max(...UNDO_SEND_CHOICES)).toBeGreaterThanOrEqual(10 * DEFAULT_PREFS.undoSend);
  });
});

describe('the stored preferences', () => {
  it('read as the defaults when nothing is stored', () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('are written as one JSON object, read back, and the same snapshot is returned until something changes', () => {
    setPref('shortcuts', false);
    expect(JSON.parse(storage.getItem(PREFS_STORAGE_KEY) ?? '')).toEqual({ ...REST, motion: 'system', shortcuts: false });
    const first = readPrefs();
    expect(first).toEqual({ ...REST, motion: 'system', shortcuts: false });
    expect(readPrefs()).toBe(first);
    reloadPrefs();
    expect(readPrefs()).toEqual({ ...REST, motion: 'system', shortcuts: false });
  });

  it('read what another visit stored', () => {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ motion: 'reduce', shortcuts: false }));
    reloadPrefs();
    expect(readPrefs()).toEqual({ ...REST, motion: 'reduce', shortcuts: false });
  });

  it('tell every subscriber about a change, until it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrefs(listener);
    setPref('motion', 'reduce');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setPref('motion', 'system');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('still hold for this visit when the browser refuses to store them', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    });
    reloadPrefs();
    setPref('shortcuts', false);
    expect(readPrefs().shortcuts).toBe(false);
  });
});

describe('applyMotionPref', () => {
  it('writes data-motion="reduce" on <html> for Reduce motion and removes it for Match system, also when changed in Settings', () => {
    applyMotionPref({ ...REST, motion: 'reduce', shortcuts: true });
    expect(html.dataset.motion).toBe('reduce');
    applyMotionPref({ ...REST, motion: 'system', shortcuts: true });
    expect('motion' in html.dataset).toBe(false);
    setPref('motion', 'reduce');
    expect(html.dataset.motion).toBe('reduce');
    setPref('motion', 'system');
    expect('motion' in html.dataset).toBe(false);
  });

  it('reads the stored choice when called with nothing (main.tsx, before the first render)', () => {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ motion: 'reduce' }));
    reloadPrefs();
    html.dataset = {};
    applyMotionPref();
    expect(html.dataset.motion).toBe('reduce');
  });
});

describe('applyDensityPref', () => {
  it('writes data-density="compact" on <html> for Compact and removes it for Comfortable, also when changed in Settings', () => {
    applyDensityPref({ ...DEFAULT_PREFS, density: 'compact' });
    expect(html.dataset.density).toBe('compact');
    applyDensityPref({ ...DEFAULT_PREFS, density: 'comfortable' });
    expect('density' in html.dataset).toBe(false);
    setPref('density', 'compact');
    expect(html.dataset.density).toBe('compact');
    setPref('density', 'comfortable');
    expect('density' in html.dataset).toBe(false);
  });
});
