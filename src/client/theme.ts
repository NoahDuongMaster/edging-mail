import { stringHue } from './lib/mail';

export interface ThemeTokens {
  dark: boolean;
  accent: string;
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderStrong: string;
  track: string;
  text: string;
  text2: string;
  text3: string;
  selBg: string;
  selText: string;
  navSelBg: string;
  link: string;
  unreadDot: string;
  star: string;
  kbdBg: string;
  toastBg: string;
  toastText: string;
  toastAction: string;
  shadow: string;
  divider: string;
  hover: string;
}

const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));

export function mix(a: string, b: string, w: number): string {
  const x = p(a);
  const y = p(b);
  return `#${x
    .map((v, i) =>
      Math.round(v * (1 - w) + y[i] * w)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

export function getTokens(dark: boolean, accent?: string): ThemeTokens {
  const a = accent !== undefined && /^#[0-9a-fA-F]{6}/.test(accent) ? accent.slice(0, 7) : '#2F5BEA';
  if (dark) {
    return {
      dark: true,
      accent: a,
      bg: '#0D0F13',
      surface: '#14171C',
      raised: '#1A1E25',
      border: '#262B33',
      borderStrong: '#363C47',
      track: '#262B33',
      text: '#ECEEF2',
      text2: '#A6ADBA',
      text3: '#8C93A0',
      selBg: mix(a, '#14171C', 0.76),
      selText: mix(a, '#FFFFFF', 0.55),
      navSelBg: mix(a, '#0D0F13', 0.76),
      link: mix(a, '#FFFFFF', 0.5),
      unreadDot: mix(a, '#FFFFFF', 0.35),
      star: '#F2B636',
      kbdBg: '#232830',
      toastBg: '#ECEEF2',
      toastText: '#15171C',
      toastAction: mix(a, '#000000', 0.12),
      shadow: '0 1px 0 rgba(255,255,255,0.02)',
      divider: '#1F242B',
      hover: 'rgba(255,255,255,0.06)'
    };
  }
  return {
    dark: false,
    accent: a,
    bg: '#F4F5F7',
    surface: '#FFFFFF',
    raised: '#F7F8FA',
    border: '#E3E6EB',
    borderStrong: '#D2D6DD',
    track: '#E3E6EB',
    text: '#15171C',
    text2: '#535A66',
    text3: '#6A717D',
    selBg: mix(a, '#FFFFFF', 0.9),
    selText: mix(a, '#000000', 0.18),
    navSelBg: mix(a, '#F4F5F7', 0.86),
    link: mix(a, '#000000', 0.12),
    unreadDot: a,
    star: '#B97800',
    kbdBg: '#EEF0F3',
    toastBg: '#15171C',
    toastText: '#FFFFFF',
    toastAction: mix(a, '#FFFFFF', 0.55),
    shadow: '0 1px 2px rgba(16,24,40,0.05)',
    divider: '#ECEEF1',
    hover: 'rgba(16,24,40,0.05)'
  };
}

export function getChip(hue: string, t: ThemeTokens): { bg: string; fg: string; dot: string } {
  return t.dark
    ? {
        bg: mix(hue, '#14171C', 0.76),
        fg: mix(hue, '#FFFFFF', 0.6),
        dot: mix(hue, '#FFFFFF', 0.3)
      }
    : {
        bg: mix(hue, '#FFFFFF', 0.87),
        fg: mix(hue, '#000000', 0.28),
        dot: hue
      };
}

export const FILE_HUES: Record<string, string> = {
  PDF: '#C2410C',
  XLS: '#15803D',
  XLSX: '#15803D',
  PNG: '#6D28D9',
  JPG: '#6D28D9',
  JPEG: '#6D28D9',
  WEBP: '#6D28D9',
  GIF: '#6D28D9',
  HEIC: '#6D28D9',
  DOC: '#2F5BEA',
  DOCX: '#2F5BEA'
};

/** Labels are user-made, so a name picks its colour from the fixed palette by hash: the same name is always the same colour. */
export function getLabelChip(label: string, t: ThemeTokens): { name: string; bg: string; fg: string; dot: string } {
  return { name: label, ...getChip(stringHue(label), t) };
}

export function getFileChip(type: string, t: ThemeTokens): { bg: string; fg: string; dot: string } {
  const hue = FILE_HUES[type.toUpperCase()] || '#475569';
  return getChip(hue, t);
}
