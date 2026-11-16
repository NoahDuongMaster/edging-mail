import type React from 'react';
import { BRAND_NAME } from '../../shared/i18n';
import type { ThemeTokens } from '../theme';
import './mailbox.css';

interface BrandProps {
  /** Kept for the callers; the look comes from the theme's variables (mailbox.css `.mb-brand*`, `.mb-wordmark*`). */
  t: ThemeTokens;
}

// The product name is never translated: its first word is semibold, the rest is regular.
const [BRAND_FIRST_WORD = '', ...BRAND_OTHER_WORDS] = BRAND_NAME.split(' ');

/** The product name with the first word semibold and the rest regular, in the second text colour. */
export const Wordmark: React.FC<BrandProps> = () => (
  <span className="mb-wordmark">
    <span className="mb-wordmark-first">{BRAND_FIRST_WORD}</span> <span className="mb-wordmark-rest">{BRAND_OTHER_WORDS.join(' ')}</span>
  </span>
);

/** Edgar's head on the app tile (public/logo.svg, the favicon too), 28 px, next to the wordmark. */
export const BrandMark: React.FC<BrandProps> = ({ t }) => (
  <div className="mb-brand">
    <img src="/logo.svg" alt="" width={28} height={28} className="mb-brand-tile" />
    <Wordmark t={t} />
  </div>
);
