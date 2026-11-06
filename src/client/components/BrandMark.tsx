import type React from 'react';
import type { ThemeTokens } from '../theme';

interface BrandProps {
  t: ThemeTokens;
}

/** "Edging Mail" with the first word bold. */
export const Wordmark: React.FC<BrandProps> = ({ t }) => (
  <span style={{ fontSize: 17, lineHeight: '24px', letterSpacing: '-0.01em' }}>
    <span style={{ fontWeight: 700 }}>Edging</span> <span style={{ fontWeight: 400, color: t.text2 }}>Mail</span>
  </span>
);

/** Edgar's head on the app tile (public/logo.svg, the favicon too) next to the wordmark. */
export const BrandMark: React.FC<BrandProps> = ({ t }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <img src="/logo.svg" alt="" width={32} height={32} style={{ display: 'block', flex: 'none' }} />
    <Wordmark t={t} />
  </div>
);
