import { describe, expect, it } from 'vitest';
import { SPAM_RULE_IDS } from '../src/worker/spam/rules';

// The reasons a spam mail carries are rule ids, and the app shows a sentence for each (the client falls back to a generic one for any other id). Every id the Worker can
// store must have its own sentence, so no rule ever shows the generic text by accident.

const [EN] = Object.values(
  import.meta.glob<Record<string, string>>('../src/shared/i18n/locales/en.json', { import: 'default', eager: true })
);

describe('spam rule texts', () => {
  it('lists the rule ids a row can carry, each once', () => {
    expect(SPAM_RULE_IDS.length).toBeGreaterThan(20);
    expect(new Set(SPAM_RULE_IDS).size).toBe(SPAM_RULE_IDS.length);
    expect(SPAM_RULE_IDS).toContain('block_listed');
    // a rule that only takes points away is never a reason
    expect(SPAM_RULE_IDS).not.toContain('auth_passed');
  });

  it('has a key spam.reason.<id> in en.json for every id in SPAM_RULE_IDS', () => {
    const missing = SPAM_RULE_IDS.filter((id) => typeof EN[`spam.reason.${id}`] !== 'string' || EN[`spam.reason.${id}`].trim() === '');
    expect(missing).toEqual([]);
  });
});
