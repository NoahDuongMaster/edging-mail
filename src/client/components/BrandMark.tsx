import type React from 'react';
import { BRAND_NAME } from '../../shared/i18n';
import type { ThemeTokens } from '../theme';

interface BrandProps {
  t: ThemeTokens;
}

// The product name is never translated: its first word is semibold, the rest is regular.
const [BRAND_FIRST_WORD = '', ...BRAND_OTHER_WORDS] = BRAND_NAME.split(' ');

/** The product name with the first word semibold. */
export const Wordmark: React.FC<BrandProps> = ({ t }) => (
  <span style={{ fontSize: 16, lineHeight: '24px', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
    <span style={{ fontWeight: 600 }}>{BRAND_FIRST_WORD}</span>{' '}
    <span style={{ fontWeight: 400, color: t.text2 }}>{BRAND_OTHER_WORDS.join(' ')}</span>
  </span>
);

/** Edgar's head on the app tile (public/logo.svg, the favicon too), 28 px, next to the wordmark. */
export const BrandMark: React.FC<BrandProps> = ({ t }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <img src="/logo.svg" alt="" width={28} height={28} style={{ display: 'block', flex: 'none' }} />
    <Wordmark t={t} />
  </div>
);
