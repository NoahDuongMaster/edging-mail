import React from 'react';
import { Building2, ChevronLeft, CircleAlert, Lock, ShieldCheck, X } from 'lucide-react';
import { DARK, DURATION, EASING, LIGHT } from '../../../shared/design/tokens';
import { BRAND_NAME } from '../../../shared/i18n';
import type { ThemeTokens } from '../../theme';
import { useDocumentTitle } from '../../lib/documentTitle';
import { tRich, useT } from '../../lib/i18n';
import {
  ActionBar,
  Button,
  Checkbox,
  FlightTrail,
  HiddenHint,
  IconButton,
  InfoTip,
  PHONE_QUERY,
  PhoneBar,
  useMediaMatch,
  type HintMode
} from '../../ui';
import { useIdleBeat } from '../../ui/EmptyState';
import { motionReduced } from '../../ui/motion';
import { LanguagePicker } from '../LanguagePicker';
import { DEFAULT_SKY, heroTrail } from './brandSky';
import type { SkyInput } from './brandSky';
import './auth.css';

// The pieces every screen before the mailbox is made of (sign-in, unlock, the gates, Setup, forgot password), in the v3 "Airmail" look: a
// split page on a desktop (the form on the left half, the deep airmail-blue brand panel with the flight trail and one statement on the
// right), the form alone on a narrow window and a phone (a slim brand row, a small trail over the title), and a calm status page with Edgar
// for a blocked state. The quiet page actions (Sign out, the language list) sit top right of the form side, so the screens read as one flow
// and a layout fix lands in one place. The look is in auth.css (`au-*`) and the ui/ primitives; `t` stays in the props for the callers
// (Settings uses these pieces too).

export const dangerColor = (t: ThemeTokens): string => (t.dark ? DARK.danger : LIGHT.danger);

// The product name is never translated: its first word is semibold, the rest regular (as the Wordmark of the app's rail).
const [BRAND_FIRST = '', ...BRAND_REST] = BRAND_NAME.split(' ');

/** Whether a card has been on this page yet: the first one rises in (M: 250 ms fade + 8 px), every later screen or step only fades in. */
let cardShown = false;

/** Whether the brand panel has been on this page yet: its trail draws in and its letter lands the first time only, later screens show it still. */
let panelShown = false;

/** The host of this page (the server the password is for), or nothing outside a browser (the server-side render of the tests). */
const pageHost = (): string => (typeof location === 'undefined' ? '' : location.host);

/** The place of this screen in a flow of several (Setup, forgot password, break-glass, the gates of a first sign-in). */
export interface AuthStep {
  current: number;
  total: number;
}

/** The phone layout of these screens (auth.css): the fixed top bar instead of the brand row, the ways back in it (DESIGN-v4m R3). */
export const AUTH_PHONE = '(max-width: 640px)';

/** True while the screens are in their phone layout (a window up to 640 px wide). False on the server. */
export const useAuthPhone = (): boolean => useMediaMatch(AUTH_PHONE);

/** True while the bottom action bar is docked (ui ActionBar: a phone or a touch screen): the quiet ways out then stand above it. */
export const useAuthDocked = (): boolean => useMediaMatch(PHONE_QUERY);

/** The way back of a screen, drawn in the top bar on a phone (an arrow for Back, a cross for Cancel); elsewhere the screen draws it. */
export interface AuthBack {
  label: string;
  onClick: () => void;
  /** `back` (default): one step back in the flow; `close`: leaves the flow (Cancel). */
  kind?: 'back' | 'close';
}

/**
 * What a part of a screen needs to know about the card around it: whether the card's top bar holds its way back (then the part draws no
 * Cancel or Back of its own), and a way to disable that back while the part runs a request. Outside a card (Settings) nothing of this.
 */
interface AuthBar {
  holdsBack: boolean;
  holdBack: (held: boolean) => void;
}
const AuthBarContext = React.createContext<AuthBar>({
  holdsBack: false,
  holdBack: () => {
    // No card around the part: nothing to hold.
  }
});

/** True when the top bar of the card around this part shows the way back, so the part leaves out its own; the bar's back is held while `busy`. */
export function useBarBack(busy: boolean): boolean {
  const { holdsBack, holdBack } = React.useContext(AuthBarContext);
  React.useEffect(() => {
    if (!holdsBack) {
      return;
    }
    holdBack(busy);
    return () => holdBack(false);
  }, [holdsBack, holdBack, busy]);
  return holdsBack;
}

/**
 * "Step 2 of 3" and a thin progress line of one segment per step, the done ones in a lighter step of the indicator and the current one in
 * full (it fills in from the start when the step begins). The words carry it; the line is a picture.
 */
export const AuthSteps: React.FC<AuthStep> = ({ current, total }) => {
  const tr = useT();
  return (
    <div className="au-steps">
      <p className="au-steps-text">{tr('auth.step', { current, total })}</p>
      <span className="au-steps-bar" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className="au-steps-seg"
            data-on={index < current ? 'true' : undefined}
            data-current={index === current - 1 ? 'true' : undefined}
          />
        ))}
      </span>
    </div>
  );
};

// The stamp of the panel's letter (in the letter's own 240 x 160 units): perforated paper with round bites centred on its edges, seven
// along the top and bottom, eight down the sides.
const STAMP = { x: 170, y: 22, width: 44, height: 52 };
const STAMP_HOLES: readonly (readonly [number, number])[] = [
  ...Array.from({ length: 7 }, (_, index) => STAMP.x + (STAMP.width / 7) * (index + 0.5)).flatMap((x) => [
    [x, STAMP.y] as const,
    [x, STAMP.y + STAMP.height] as const
  ]),
  ...Array.from({ length: 8 }, (_, index) => STAMP.y + (STAMP.height / 8) * (index + 0.5)).flatMap((y) => [
    [STAMP.x, y] as const,
    [STAMP.x + STAMP.width, y] as const
  ])
];
/** The postmark's wavy cancellation lines, from its ring across the stamp's lower half and on to the paper: seven half waves each. */
const POSTMARK_WAVES = [50, 57, 64, 71].map((y) => `M182 ${y} q3.25 -2.6 6.5 0${' t6.5 0'.repeat(6)}`);

/**
 * The airmail letter that lands in the panel's sky: white paper with the par-avion edge all round (red, paper, blue, at the angle of the
 * band along the panel's foot), a return address and an address in soft bars, a perforated stamp with the product's initial printed on it,
 * and a postmark (a ring with a dotted ring of lettering inside) whose wavy lines run across the stamp. Decoration only (aria-hidden).
 */
const AirmailLetter: React.FC<{ id: string }> = ({ id }) => (
  <svg aria-hidden="true" focusable="false" className="au-letter" viewBox="0 0 240 160">
    <defs>
      <pattern id={`${id}-edge`} width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="24" height="24" className="au-letter-paper" />
        <rect width="8" height="24" className="au-letter-red" />
        <rect x="12" width="8" height="24" className="au-letter-blue" />
      </pattern>
      <mask id={`${id}-perf`} maskUnits="userSpaceOnUse" x="163" y="15" width="58" height="66">
        <rect x={STAMP.x} y={STAMP.y} width={STAMP.width} height={STAMP.height} className="au-letter-paper" />
        {STAMP_HOLES.map(([cx, cy]) => (
          <circle key={`${cx} ${cy}`} cx={cx} cy={cy} r="2.1" className="au-letter-hole" />
        ))}
      </mask>
    </defs>
    <rect width="240" height="160" rx="12" fill={`url(#${id}-edge)`} />
    <rect x="9" y="9" width="222" height="142" rx="5" className="au-letter-paper" />
    <rect x="22" y="24" width="46" height="4" rx="2" className="au-letter-ink-soft" />
    <rect x="22" y="33" width="32" height="4" rx="2" className="au-letter-ink-soft" />
    <rect x="78" y="96" width="106" height="6" rx="3" className="au-letter-ink" />
    <rect x="78" y="109" width="86" height="6" rx="3" className="au-letter-ink" />
    <rect x="78" y="122" width="62" height="6" rx="3" className="au-letter-ink" />
    <g className="au-letter-stamp">
      <rect x={STAMP.x} y={STAMP.y} width={STAMP.width} height={STAMP.height} mask={`url(#${id}-perf)`} className="au-letter-paper" />
    </g>
    <rect x={STAMP.x + 5} y={STAMP.y + 5} width={STAMP.width - 10} height={STAMP.height - 10} rx="1.5" className="au-letter-field" />
    <rect x={STAMP.x + 7.5} y={STAMP.y + 7.5} width={STAMP.width - 15} height={STAMP.height - 15} rx="1" className="au-letter-frame" />
    <text x={STAMP.x + STAMP.width / 2} y={STAMP.y + 34} textAnchor="middle" className="au-letter-initial">
      {BRAND_FIRST.charAt(0)}
    </text>
    {/* The postmark: its ring over the stamp's lower left corner, its waves across the stamp. */}
    <g className="au-letter-postmark">
      <circle cx="166" cy="62" r="16" />
      <circle cx="166" cy="62" r="11" className="au-letter-postmark-words" />
      {POSTMARK_WAVES.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  </svg>
);

/** The panel's sky as it is laid out now (px, rounded), or nothing while the panel is not drawn (under 1024 px). */
function measureSky(panel: HTMLElement, letter: HTMLElement | null, copy: HTMLElement | null): SkyInput | null {
  if (panel.offsetWidth === 0 || letter === null) {
    return null;
  }
  const box = panel.getBoundingClientRect();
  // The form's main button (the submit; else its first AuthButton), wherever the window has it: the trail leaves at its height.
  const page = panel.closest('.au-page');
  const button =
    page?.querySelector<HTMLElement>('.au-card .au-btn[type="submit"]') ?? page?.querySelector<HTMLElement>('.au-card .au-btn');
  const at = button?.getBoundingClientRect();
  const tilt = Number.parseFloat(getComputedStyle(letter).rotate);
  return {
    width: panel.clientWidth,
    height: panel.clientHeight,
    entry: at === undefined || at.height === 0 ? null : Math.round(at.top + at.height / 2 - box.top),
    letter: {
      x: letter.offsetLeft + letter.offsetWidth / 2,
      y: letter.offsetTop + letter.offsetHeight / 2,
      width: letter.offsetWidth,
      height: letter.offsetHeight,
      tilt: Number.isFinite(tilt) ? tilt : -12
    },
    copy: copy === null ? null : { left: copy.offsetLeft, top: copy.offsetTop, right: copy.offsetLeft + copy.offsetWidth }
  };
}

/**
 * The right half of the split page (1024 px and wider): a deep airmail-blue night sky in both themes. The hero of it is an airmail letter
 * (the par-avion edge, a stamp, a postmark), up in the sky right of centre, and the one flight trail that brings it there: it leaves the
 * panel's left edge at the height of the form's main button and climbs over the words to the letter. Then one statement in display type,
 * three proof lines, and the airmail band along the panel's foot. Decoration and a promise, not a control: it is hidden under 1024 px,
 * where the trust line under the form says what matters. The trail is measured (brandSky.ts), so it lands on the letter at every size.
 */
const BrandPanel: React.FC = () => {
  const tr = useT();
  // Decided once, when it mounts: the first panel of the page draws its trail in; a later screen (Forgot password after Sign in) shows it still.
  const still = React.useMemo(() => panelShown, []);
  React.useEffect(() => {
    panelShown = true;
  }, []);
  const id = `sky-${React.useId().replaceAll(/[^\w-]/g, '')}`;
  const panel = React.useRef<HTMLElement>(null);
  const letter = React.useRef<HTMLSpanElement>(null);
  const copy = React.useRef<HTMLDivElement>(null);
  const [sky, setSky] = React.useState<SkyInput>(DEFAULT_SKY);
  // Measured before the first paint and again whenever the panel, the form or the words change size (a window resize, an error under a
  // field, another language), so the trail always leaves at the button and lands on the letter.
  React.useLayoutEffect(() => {
    const node = panel.current;
    const measure = () => {
      const next = node === null ? null : measureSky(node, letter.current, copy.current);
      if (next !== null) {
        setSky((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      }
    };
    measure();
    const observer = node === null || typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const card = node?.closest('.au-page')?.querySelector('.au-card') ?? null;
    if (observer !== null && node !== null) {
      observer.observe(node);
      if (card) {
        observer.observe(card);
      }
      if (copy.current !== null) {
        observer.observe(copy.current);
      }
    }
    // The first form of the page rises in by 8px: once it stands, the button is where the trail must leave from.
    card?.addEventListener('animationend', measure);
    return () => {
      observer?.disconnect();
      card?.removeEventListener('animationend', measure);
    };
  }, []);
  const trail = heroTrail(sky);
  return (
    <aside ref={panel} className="au-panel" data-still={still ? 'true' : undefined}>
      <div className="au-panel-flight" aria-hidden="true">
        <svg
          aria-hidden="true"
          focusable="false"
          className="au-panel-trail"
          width={sky.width}
          height={sky.height}
          viewBox={`0 0 ${sky.width} ${sky.height}`}
          fill="none"
        >
          <defs>
            {/* The trail comes in from the form's side: its first 40px fade in from the panel's edge. */}
            <linearGradient id={`${id}-fade`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="40" y2="0">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.15" />
              <stop offset="1" stopColor="currentColor" />
            </linearGradient>
            {/* The trail draws in once from the panel's edge to the letter (a mask whose stroke runs along it); the dashes never move. */}
            <mask id={`${id}-reveal`} maskUnits="userSpaceOnUse" x="-16" y="0" width={sky.width + 32} height={sky.height}>
              <path d={trail.forward} pathLength={1} stroke={`url(#${id}-fade)`} className="au-panel-reveal" />
            </mask>
          </defs>
          <path d={trail.backward} className="au-panel-path" mask={`url(#${id}-reveal)`} />
        </svg>
        <span ref={letter} className="au-panel-letter">
          <AirmailLetter id={id} />
        </span>
      </div>
      <div ref={copy} className="au-panel-copy">
        <p className="au-panel-statement">{tr('auth.panel_statement')}</p>
        <ul className="au-panel-proofs">
          <li className="au-panel-proof">
            <span className="au-panel-icon" aria-hidden="true">
              <Lock size={16} />
            </span>
            {tr('auth.panel_proof_no_admin')}
          </li>
          <li className="au-panel-proof">
            <span className="au-panel-icon" aria-hidden="true">
              <Building2 size={16} />
            </span>
            {tr('auth.panel_proof_host')}
          </li>
          <li className="au-panel-proof">
            <span className="au-panel-icon" aria-hidden="true">
              <ShieldCheck size={16} />
            </span>
            {tr('auth.panel_proof_two_factor')}
          </li>
        </ul>
      </div>
      <span className="ui-airmail au-panel-edge" data-tone="panel" aria-hidden="true" />
    </aside>
  );
};

interface AuthCardProps {
  t: ThemeTokens;
  title: string;
  /** The name of the tab when it differs from the title (sign-in: the title greets, the tab says 'Sign in'). */
  pageTitle?: string;
  /** One short paragraph under the title. */
  lead?: string;
  /** The longer explanation of the screen, behind an InfoTip after the title (DESIGN-v4m R1: the lead stays one short line). */
  info?: string;
  /**
   * Which server the password goes to, as a quiet chip under the title: 'Sign in to mail.example.com' before sign-in, 'Signed in to ...' on
   * the unlock screen. The host of the page, as text (never a link), so a person with accounts on several servers sees which one this is.
   */
  server?: 'sign-in' | 'unlock';
  /** The language picker is on every screen before sign-in; the gates come after it, so they leave it out. */
  picker?: boolean;
  /** The column for a secret shown once (recovery key, two-factor QR) or a long form (Setup): 560 px instead of 400 px. */
  wide?: boolean;
  /** A quiet action top right, before the language picker (the unlock screen's Sign out): first on the page and in the tab order. */
  topAction?: React.ReactNode;
  /**
   * The way back of this screen (Back to the step before, Cancel out of the flow). On a phone it is the start of the fixed top bar and the
   * screen leaves its own text button out (useAuthPhone); elsewhere the screen draws it as before.
   */
  back?: AuthBack;
  /** Where this screen is in a flow of several: "Step 1 of 2" over the title. */
  step?: AuthStep;
  /** A short line above the title, for a screen that is not a numbered step. */
  eyebrow?: string;
  /**
   * Edgar (112 px) with his flight trail behind him over a centred title: only for a screen that reports a blocked state (Setup not ready),
   * never on a form. The page is then a status page (no brand panel, the page ground). He gives his idle beats the first time the screen
   * shows (M20, ui EmptyState).
   */
  illustration?: boolean;
  onSubmit?: (event: React.SyntheticEvent) => void;
  children: React.ReactNode;
}

export const AuthCard: React.FC<AuthCardProps> = ({
  t,
  title,
  pageTitle,
  lead,
  info,
  server,
  picker = false,
  wide = false,
  topAction,
  back,
  step,
  eyebrow,
  illustration = false,
  onSubmit,
  children
}) => {
  const tr = useT();
  const Tag = onSubmit === undefined ? 'div' : 'form';
  const heading = React.useRef<HTMLHeadingElement>(null);
  const card = React.useRef<HTMLElement | null>(null);
  const art = React.useRef<HTMLImageElement | null>(null);
  // The first card of the page rises in by CSS (data-enter); this one is decided once, when it mounts.
  const rise = React.useMemo(() => !cardShown, []);
  const shownTitle = React.useRef<string | null>(null);
  const phone = useAuthPhone();
  const [backHeld, setBackHeld] = React.useState(false);
  const holdsBack = phone && back !== undefined;
  const bar = React.useMemo<AuthBar>(() => ({ holdsBack, holdBack: setBackHeld }), [holdsBack]);
  const headingGone = useScrolledPast(heading, phone);
  useIdleBeat(art, illustration, title);
  // WCAG 2.4.2: the tab is named after the screen ("Sign in - Edging Mail", "Set up Edging Mail").
  useDocumentTitle([pageTitle ?? title]);
  const host = server === undefined ? '' : pageHost();

  // A new screen or a new step of one (its title changed): the content fades in where the form stands (150 ms, no move: errors and steps
  // never shake or slide), the window goes back to its top, and the keyboard and the screen reader start at the new title. A screen
  // that wants a field instead moves the focus on in its own effect, which runs after this one.
  React.useLayoutEffect(() => {
    if (shownTitle.current === title) {
      return;
    }
    const first = shownTitle.current === null;
    shownTitle.current = title;
    if (first && rise) {
      cardShown = true;
      return;
    }
    cardShown = true;
    if (!first) {
      window.scrollTo({ top: 0 });
    }
    for (const part of card.current?.children ?? []) {
      part.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: motionReduced() ? DURATION.fast : DURATION.quick,
        easing: EASING.standard
      });
    }
  }, [title, rise]);

  // C-9: a screen that replaces another one must not leave the keyboard and the screen reader on <body>, where the next Tab starts from the top of the
  // page. When nothing has focus, the title takes it (a screen with a field of its own, like sign-in, moves it on to that field right after); a new
  // step of the same screen moves it there too.
  const focusedTitle = React.useRef<string | null>(null);
  React.useEffect(() => {
    const active = document.activeElement;
    const newStep = focusedTitle.current !== null && focusedTitle.current !== title;
    focusedTitle.current = title;
    if (newStep || active === null || active === document.body) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [title]);

  const brand = (
    // The brand: Edgar's head on the app tile (32 px) and the product name (18 px, never translated), at the left of the top row on every
    // width; on the split page the top row stands right over the form (auth.css), the language list on its right edge, one line.
    <p className="au-brand">
      <img src="/logo.svg" alt="" width={32} height={32} className="au-brand-mark" />
      <span className="au-brand-name">
        <span className="au-brand-first">{BRAND_FIRST}</span> {BRAND_REST.join(' ')}
      </span>
    </p>
  );
  const picked = picker ? <LanguagePicker t={t} id="auth-language" short={phone} /> : null;

  // v4m R3: on a phone the brand row becomes the fixed top bar: the way back (when the flow has one), the app's tile with the step (or the
  // product name) and, once the title has scrolled under the bar, the title itself; Sign out and the language (as its code) at the end.
  const phoneBar = phone ? (
    <PhoneBar
      as="div"
      className="au-phonebar"
      start={
        back === undefined ? undefined : (
          <IconButton label={back.label} disabled={backHeld} onClick={back.onClick}>
            {back.kind === 'close' ? <X size={20} aria-hidden="true" /> : <ChevronLeft size={22} aria-hidden="true" />}
          </IconButton>
        )
      }
      title={
        <>
          <img src="/logo.svg" alt="" width={28} height={28} className="au-phonebar-mark" />
          {headingGone ? (
            <span className="au-phonebar-text" data-kind="title">
              {title}
            </span>
          ) : step === undefined ? (
            <span className="au-phonebar-text" data-kind="brand">
              <span className="au-brand-first">{BRAND_FIRST}</span> {BRAND_REST.join(' ')}
            </span>
          ) : (
            <span className="au-phonebar-text" data-kind="step">
              {tr('auth.step', { current: step.current, total: step.total })}
            </span>
          )}
        </>
      }
      end={
        picked === null && topAction === undefined ? undefined : (
          <>
            {topAction}
            {picked}
          </>
        )
      }
    />
  ) : null;

  const titleElement = (
    <h1 ref={heading} tabIndex={-1} className="au-title">
      {title}
    </h1>
  );

  return (
    <div className="au-page" data-layout={illustration ? 'status' : 'split'} data-wide={wide ? 'true' : undefined}>
      {/* v3 P1: where the brand panel is hidden (under 1024 px) the page wears the airmail edge along its very top, full width. */}
      {illustration ? null : <span className="ui-airmail au-page-edge" aria-hidden="true" />}
      <div className="au-side">
        {phoneBar ?? (
          <div className="au-top">
            {brand}
            {picker || topAction !== undefined ? (
              // The page's quiet actions, top right: Sign out first (the unlock screen, CK-17), then the language list.
              <div className="au-bar">
                {topAction}
                {picker ? <LanguagePicker t={t} id="auth-language" /> : null}
              </div>
            ) : null}
          </div>
        )}
        <main className="au-column" data-wide={wide ? 'true' : undefined}>
          <AuthBarContext.Provider value={bar}>
            <Tag
              {...(onSubmit === undefined ? {} : { onSubmit, noValidate: true })}
              ref={(node: HTMLElement | null) => {
                card.current = node;
              }}
              className="au-card"
              data-enter={rise ? 'rise' : undefined}
              data-status={illustration ? 'true' : undefined}
            >
              <div className="au-head">
                {/* The trail Edgar flew in on, behind him (status page); on a form, a small trail over the title where the panel is hidden. */}
                {illustration ? <FlightTrail size="md" className="au-art-trail" /> : <FlightTrail size="sm" className="au-head-trail" />}
                {illustration ? <img ref={art} src="/edgar.svg" alt="" width={112} height={109} className="au-art ui-empty-art" /> : null}
                {step === undefined ? null : <AuthSteps current={step.current} total={step.total} />}
                {eyebrow === undefined ? null : <p className="au-eyebrow">{eyebrow}</p>}
                {info === undefined ? (
                  titleElement
                ) : (
                  // The tip follows the title's last word, outside the heading (its name stays the title's words).
                  <div className="au-title-row ui-tip-row">
                    {titleElement}
                    <InfoTip label={title}>{info}</InfoTip>
                  </div>
                )}
                {host === '' ? null : (
                  <p className="au-host">
                    {tRich(server === 'unlock' ? 'keys.unlock_host' : 'auth.sign_in_host', {
                      host: (
                        <span className="au-host-name" translate="no">
                          {host}
                        </span>
                      )
                    })}
                  </p>
                )}
                {lead === undefined ? null : <p className="au-lead">{lead}</p>}
              </div>
              {children}
            </Tag>
          </AuthBarContext.Provider>
        </main>
      </div>
      {illustration ? null : <BrandPanel />}
    </div>
  );
};

/**
 * Whether `target` has scrolled up under the phone's top bar (its bottom above the bar's bottom edge): the bar then says the title. Only
 * watched while `active` (the phone layout); false elsewhere and on the server (the last answer is kept but not used while inactive).
 */
function useScrolledPast(target: React.RefObject<HTMLElement | null>, active: boolean): boolean {
  const [past, setPast] = React.useState(false);
  React.useEffect(() => {
    const node = target.current;
    if (!active || node === null) {
      return;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const bar = node.closest('.au-page')?.querySelector('.au-phonebar');
      const edge = bar === null || bar === undefined ? 0 : bar.getBoundingClientRect().bottom;
      setPast(node.getBoundingClientRect().bottom <= edge);
    };
    const later = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(check);
      }
    };
    later();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
      window.cancelAnimationFrame(frame);
    };
  }, [target, active]);
  return active && past;
}

/** The look of a bare input element next to these pieces (Settings > Security still has some). New fields use ui/TextField instead. */
export const inputStyle = (_t: ThemeTokens): React.CSSProperties => ({
  width: '100%',
  height: 44,
  padding: '0 12px',
  border: '1px solid var(--control)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 'var(--ui-field-size)'
});

interface FieldProps {
  t: ThemeTokens;
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}

/** A label above one bare control, with an optional hint under it. The control carries the same `id`. New fields use ui/TextField instead. */
export const Field: React.FC<FieldProps> = ({ id, label, children, hint }) => (
  <div className="ui-field">
    <label htmlFor={id} className="ui-label">
      {label}
    </label>
    {children}
    {hint === undefined ? null : (
      <p id={`${id}-hint`} className="ui-hint">
        {hint}
      </p>
    )}
  </div>
);

interface ButtonProps {
  t: ThemeTokens;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
  quiet?: boolean;
  /** An icon before the label (16 px, aria-hidden), so a quiet button reads as one pair with the CopyButton beside it. */
  icon?: React.ReactNode;
}

/**
 * The button of a form on these screens: the primary one (one per screen, full width), or `quiet` (secondary) for Copy, Download and Retry.
 * 44px high. A way back (Back, Cancel) is a TextButton. Busy: the wingbeat loader (still under reduced motion, C-11), `aria-busy` and no clicks.
 */
export const AuthButton: React.FC<ButtonProps> = ({
  label,
  busy = false,
  disabled = false,
  type = 'submit',
  onClick,
  quiet = false,
  icon
}) => (
  <Button
    type={type === 'submit' ? 'submit' : 'button'}
    variant={quiet ? 'secondary' : 'primary'}
    size="lg"
    className="au-btn"
    loading={busy}
    disabled={busy || disabled}
    aria-busy={busy}
    leadingIcon={icon}
    onClick={onClick}
  >
    {label}
  </Button>
);

/** A quiet button, for "Forgot password" and "Sign out" next to a form: a text link in look. `action` names it for the tests (`data-action`). */
export const TextButton: React.FC<{ t: ThemeTokens; label: string; onClick: () => void; disabled?: boolean; action?: string }> = ({
  label,
  onClick,
  disabled = false,
  action
}) => (
  // C-12: 44px high (size lg on every screen) and never under 44px wide (auth.css), so a short label (vi "Hủy", zh "返回") is still a tap target.
  <Button variant="ghost" size="lg" className="au-text-btn" data-action={action} onClick={onClick} disabled={disabled}>
    {label}
  </Button>
);

/**
 * A way to another screen that reads as a link ('Forgot password' of the password field): the accent's text, underlined under the pointer
 * and with the keyboard, the ui focus ring, and what the other screen needs behind an InfoTip right after it (v4m R1: no line of helper
 * text under the password). The words also describe the link for a screen reader (aria-describedby, kept in the page visually hidden).
 * With a mouse on a window wider than a phone the pair sits on the password's label row (auth.css); on touch it follows the field (a 44px
 * target on the label row would cover the top of the field).
 */
export const HintedLink: React.FC<{ id: string; label: string; hint: string; onClick: () => void }> = ({ id, label, hint, onClick }) => (
  <div className="au-hinted">
    <Button variant="ghost" size="sm" className="au-link-btn" aria-describedby={`${id}-hint`} onClick={onClick}>
      {label}
    </Button>
    <InfoTip label={label}>{hint}</InfoTip>
    <HiddenHint id={`${id}-hint`} text={hint} />
  </div>
);

/**
 * One visible line (the short form of a longer text) with the whole text behind an InfoTip at its end (v4m R1): a note, a warning about a
 * file, what admins can do. `label` names the tip ("About {label}"). The tip follows the last word, also when the line wraps.
 */
export const TipLine: React.FC<{ className: 'au-note' | 'au-muted'; text: string; tip: string; label: string }> = ({
  className,
  text,
  tip,
  label
}) => (
  <p className={`${className} ui-tip-row`}>
    <span>{text}</span>
    <InfoTip label={label} size="sm">
      {tip}
    </InfoTip>
  </p>
);

/**
 * The end of a form: the main button in the bottom action bar (ui ActionBar, DESIGN-v4m R3: docked at the bottom of the window on a phone
 * or a touch screen, above the on-screen keyboard; `dock="always"` docks it on every window, for Setup's long form) and what follows the
 * button (`after`: a note, the quiet ways out). Docked, the bar is the last thing of the form, so `after` stands above it; undocked the
 * button is in the form's column as before (auth.css) and `after` follows it (the v3 order).
 */
export const AuthActions: React.FC<{ children: React.ReactNode; after?: React.ReactNode; dock?: 'phone' | 'always' }> = ({
  children,
  after,
  dock = 'phone'
}) => {
  const docked = useAuthDocked() || dock === 'always';
  const bar = (
    <ActionBar dock={dock} className="au-actionbar">
      {children}
    </ActionBar>
  );
  return docked ? (
    <>
      {after}
      {bar}
    </>
  ) : (
    <>
      {bar}
      {after}
    </>
  );
};

/** One quiet line at the foot of the sign-in and unlock forms: what protects the mail, with a lock (not an alert, not a badge, no rule over it). */
export const TrustLine: React.FC = () => {
  const tr = useT();
  return (
    <p className="au-trust">
      <Lock size={14} aria-hidden="true" />
      <span>{tr('auth.trust_line')}</span>
    </p>
  );
};

/** An error about a whole form (the server's answer, a wrong code): announced at once, faded in (never shaken). Field errors go under their field. */
export const ErrorLine: React.FC<{ t: ThemeTokens; id: string; text: string | null }> = ({ id, text }) =>
  text === null ? null : (
    <p id={id} role="alert" className="ui-error au-error">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );

/** A checkbox with a label and an explanation (the "shared device" choice): an InfoTip after the label, or one line under it (`hintMode`). */
export const CheckboxRow: React.FC<{
  t: ThemeTokens;
  id: string;
  label: string;
  /** What the choice does: behind an InfoTip after the label (v4m R1), or a line under it with `hintMode="inline"` (needed while choosing). */
  hint?: string;
  hintMode?: HintMode;
  /** One short line under the row that stays visible (what to remember once the box is ticked); the whole text is the hint's tip. */
  note?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The choice is not the person's to change here (the server knows this session is a shared-device one): ticked and disabled. */
  locked?: boolean;
  /** Pressing the form's button without ticking a box that must be ticked ("I have saved these codes"): what to do, under the row. */
  error?: string | null;
}> = ({ id, label, hint, hintMode, note, checked, onChange, locked = false, error = null }) => (
  // C-12: ui/Checkbox makes the whole row one label (a tap anywhere on it toggles the box), 44px high on touch. The box is named by the label text
  // alone and described by the hint.
  <>
    <Checkbox
      id={id}
      label={
        <span id={`${id}-label`} className="au-check-label">
          {label}
        </span>
      }
      tipLabel={label}
      hint={hint}
      hintMode={hintMode}
      checked={checked}
      disabled={locked}
      onChange={onChange}
      aria-labelledby={`${id}-label`}
      {...(error === null
        ? {}
        : { 'aria-invalid': true, 'aria-describedby': hint === undefined ? `${id}-error` : `${id}-hint ${id}-error` })}
    />
    {note === undefined ? null : <p className="au-check-note">{note}</p>}
    {error === null ? null : (
      <p id={`${id}-error`} className="ui-error au-error">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{error}</span>
      </p>
    )}
  </>
);
