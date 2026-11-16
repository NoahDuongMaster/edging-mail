import type React from 'react';
import { DURATION, EASING } from '../../shared/design/tokens';
import { motionReduced } from './motion';

// v3 signature H1 + H4 (DESIGN-v3 section 3): a message flies home to the folder it went to. A small "letter token" lifts off the row, flies
// along an arc to the folder (or label, or the phone's menu button) and the folder catches it; a dashed trail draws behind it and fades.
// It is pixels only: data, selection, focus and the Undo toast never wait for it, and nothing here throws. Under reduced motion (the
// system setting or the in-app choice, `motionReduced()`) nothing flies: the home only gets its short highlight (`catchHome`).
//
// The layer: one fixed overlay at the end of <body> (`.ui-homing`, `--z-float`, `pointer-events: none`, `aria-hidden`), created on the
// first flight. At most three tokens fly at once; a fourth finishes the oldest at once (it lands and is caught). Only `transform`,
// `opacity` and `stroke-dashoffset` are animated (WAAPI keyframes sampled along the curve, so the path is exact and nothing is measured per
// frame).
//
// Directions: `flyHome(row, 'archive')` flies from a row (or a rect) to a home; `flyFrom('archive', row)` is the way back (Undo, a row that
// comes back into the list): it leaves the home small and lands full size on the row, where the row's own entrance takes over.

/** The places a message can fly to: folders, labels ('label:<name>'), the phone menu button and the compose button. */
export type HomeId =
  'inbox' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'archive' | 'spam' | 'trash' | 'menu' | 'compose' | `label:${string}`;

/** What happened to the message: shapes the token (trash tilts and shrinks, spam is muted, send is a letter). */
export type HomingKind = 'archive' | 'trash' | 'spam' | 'snooze' | 'move' | 'restore' | 'send' | 'label';

export interface FlyHomeOptions {
  /** Initials of the sender, drawn on the token on their tint. Without them the token shows a small envelope. */
  initials?: string;
  /** The sender's hue (a LABEL_HUES value) for the token tint. */
  hue?: string;
  kind?: HomingKind;
  /** A bulk move: one token with this count as a badge. */
  count?: number;
}

/** Most tokens in the air at once; one more finishes the oldest flight at once. */
const MAX_TOKENS = 3;
/** The lift off the row before the flight (scale 1 -> 1.08). */
const LIFT_MS = 90;
/** The trail fades this long after the landing. */
const TRAIL_FADE_MS = 240;
/** Samples along the curve: enough for a smooth arc with linear steps between them. */
const SAMPLES = 24;
/** The control point of the arc sits this share of the distance away from the straight line (DESIGN: 18-28 %). */
const LIFT_SHARE = 0.24;
/** The edge the arc keeps from the viewport, in px. */
const EDGE = 12;
/** The token's size in px (a send letter is drawn at 120 x 80 and scaled down to its token size). */
const TOKEN = 28;
const LETTER = { width: 120, height: 80 } as const;
/** The letter's scale when it is a token (30 x 20 px on screen). */
const LETTER_TOKEN_SCALE = 0.25;

// ---------- Homes ----------

const homes = new Map<string, Set<Element>>();

function addHome(id: string, el: Element): void {
  const set = homes.get(id) ?? new Set<Element>();
  // The newest registration is the preferred home of that id (a drawer that opened over the rail).
  set.delete(el);
  set.add(el);
  homes.set(id, set);
}

function dropHome(id: string, el: Element | null): void {
  const set = homes.get(id);
  if (set === undefined) {
    return;
  }
  if (el === null) {
    // A plain `registerHome(id, null)` (a ref callback's null call) cannot say which element went: forget the ones that left the page.
    for (const item of set) {
      if (!item.isConnected) {
        set.delete(item);
      }
    }
  } else {
    set.delete(el);
  }
  if (set.size === 0) {
    homes.delete(id);
  }
}

/**
 * Registers the element a message flies to (with `null`: forgets the registered elements of `id` that left the page). Call it from a ref
 * callback or an effect; several elements may carry one id (the desktop rail and the phone drawer): the drawn one is used, the newest
 * first. Prefer `homeRef(id)`, a stable ref callback that also forgets its own element exactly.
 */
export function registerHome(id: HomeId, el: Element | null): void {
  if (el === null) {
    dropHome(id, null);
  } else {
    addHome(id, el);
  }
}

const homeRefs = new Map<string, React.RefCallback<Element>>();

/**
 * A stable ref callback (the same function on every render, so React never re-attaches it) that registers its element as the home `id`
 * and forgets exactly that element when it unmounts (a React 19 ref cleanup): `<button ref={homeRef('archive')}>`.
 */
export function homeRef(id: HomeId): React.RefCallback<Element> {
  let ref = homeRefs.get(id);
  if (ref === undefined) {
    ref = (el: Element | null) => {
      if (el === null) {
        return;
      }
      addHome(id, el);
      return () => {
        dropHome(id, el);
      };
    };
    homeRefs.set(id, ref);
  }
  return ref;
}

const drawn = (el: Element): boolean => el.isConnected && el.getClientRects().length > 0;

/** The registered element of a home that is in the document: the newest one that is drawn (has a box), else the newest connected one. */
export function homeElement(id: HomeId): Element | undefined {
  const set = homes.get(id);
  if (set === undefined) {
    return undefined;
  }
  const list = [...set].toReversed();
  return list.find((el) => drawn(el)) ?? list.find((el) => el.isConnected);
}

// ---------- Geometry (exported for the tests) ----------

export interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const centre = (rect: DOMRectReadOnly): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/** The point at `t` (0..1) of the quadratic Bezier s -> c -> e. */
export function arcPoint(s: Point, c: Point, e: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * s.x + 2 * u * t * c.x + t * t * e.x, y: u * u * s.y + 2 * u * t * c.y + t * t * e.y };
}

const tangent = (s: Point, c: Point, e: Point, t: number): Point => ({
  x: 2 * (1 - t) * (c.x - s.x) + 2 * t * (e.x - c.x),
  y: 2 * (1 - t) * (c.y - s.y) + 2 * t * (e.y - c.y)
});

/** How far `p` lies outside the viewport (minus the edge), in px; 0 inside. */
function overflow(p: Point, viewport: Size): number {
  const dx = Math.max(EDGE - p.x, p.x - (viewport.width - EDGE), 0);
  const dy = Math.max(EDGE - p.y, p.y - (viewport.height - EDGE), 0);
  return dx + dy;
}

/**
 * The control point of the quadratic arc from `from` to `to`: lifted perpendicular to the straight line by `share` of the distance, on the
 * upper side (for a vertical line: the side towards the middle of the screen). When that side would leave the viewport, the other side;
 * when both would, the one that leaves it least, lowered until it fits.
 */
export function arcControl(from: Point, to: Point, viewport: Size, share = LIFT_SHARE): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  if (distance < 1) {
    return mid;
  }
  let normal = { x: dy / distance, y: -dx / distance };
  const vertical = Math.abs(normal.y) < 0.05;
  if (vertical ? (viewport.width / 2 - mid.x) * normal.x < 0 : normal.y > 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  const lifted = (n: Point, k: number): Point => ({ x: mid.x + n.x * k * distance, y: mid.y + n.y * k * distance });
  // The top of the arc (t = 0.5) is half-way between the middle of the line and the control point.
  const apexOut = (n: Point, k: number): number => overflow(arcPoint(from, lifted(n, k), to, 0.5), viewport);
  const flipped = { x: -normal.x, y: -normal.y };
  if (apexOut(normal, share) === 0) {
    return lifted(normal, share);
  }
  if (apexOut(flipped, share) === 0) {
    return lifted(flipped, share);
  }
  const side = apexOut(normal, share) <= apexOut(flipped, share) ? normal : flipped;
  for (let k = share; k > 0.02; k -= 0.02) {
    if (apexOut(side, k) === 0) {
      return lifted(side, k);
    }
  }
  return mid;
}

/** The flight's duration in ms by its length: --dur-homing (620) for a typical row-to-folder distance, within 480-720. */
export function homingDuration(distance: number): number {
  return Math.round(clamp(DURATION.homing + (distance - 700) * 0.3, 480, 720));
}

/** One coordinate of a CSS cubic-bezier (control values a and b, ends 0 and 1) at parameter t. */
const curve = (a: number, b: number, t: number): number => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;

/** A CSS cubic-bezier as a function of progress (for the samples along the curve). */
function bezierEasing(css: string): (x: number) => number {
  const numbers = (css.match(/-?[\d.]+/g) ?? []).map(Number);
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = numbers;
  return (x: number) => {
    if (x <= 0 || x >= 1) {
      return clamp(x, 0, 1);
    }
    let low = 0;
    let high = 1;
    let t = x;
    for (let step = 0; step < 24; step++) {
      t = (low + high) / 2;
      if (curve(x1, x2, t) < x) {
        low = t;
      } else {
        high = t;
      }
    }
    return curve(y1, y2, t);
  };
}

const easeHoming = bezierEasing(EASING.homing);

/** The length of the arc from t = 0 to each of `steps + 1` evenly spaced t, for the trail that follows the token. */
function arcLengths(s: Point, c: Point, e: Point, steps = 64): number[] {
  const lengths = [0];
  let previous = s;
  for (let index = 1; index <= steps; index++) {
    const next = arcPoint(s, c, e, index / steps);
    lengths.push((lengths.at(-1) ?? 0) + Math.hypot(next.x - previous.x, next.y - previous.y));
    previous = next;
  }
  return lengths;
}

function lengthAt(lengths: readonly number[], t: number): number {
  const steps = lengths.length - 1;
  const at = clamp(t, 0, 1) * steps;
  const index = Math.floor(at);
  const low = lengths[index] ?? 0;
  const high = lengths[Math.min(steps, index + 1)] ?? low;
  return low + (high - low) * (at - index);
}

/** The angle in degrees between two directions, in -180..180. */
function angleBetween(a: Point, b: Point): number {
  const raw = ((Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)) * 180) / Math.PI;
  return ((((raw + 180) % 360) + 360) % 360) - 180;
}

// ---------- The overlay ----------

let overlay: HTMLDivElement | null = null;
let masks = 0;
// eslint-disable-next-line unicorn/prefer-https -- the SVG namespace is this exact URI
const SVG = 'http://www.w3.org/2000/svg';

function layer(): HTMLDivElement {
  if (overlay?.isConnected === true) {
    return overlay;
  }
  const root = document.createElement('div');
  root.className = 'ui-homing';
  root.setAttribute('aria-hidden', 'true');
  add(document.body, root);
  overlay = root;
  return root;
}

function svg<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

/** Appends the nodes to `parent` in order (insertBefore: the Worker types shadow Element#append in this project). */
function add(parent: Node, ...nodes: Node[]): void {
  for (const node of nodes) {
    parent.insertBefore(node, null);
  }
}

/** The small envelope drawn on a token without initials. */
function envelopeGlyph(): SVGSVGElement {
  const glyph = svg('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', class: 'ui-homing-glyph' });
  add(
    glyph,
    svg('rect', { x: 3, y: 5.5, width: 18, height: 13, rx: 2.5, stroke: 'currentColor', 'stroke-width': 2 }),
    svg('path', {
      d: 'm4 7.5 8 5.5 8-5.5',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  );
  return glyph;
}

/** The letter of a send (and of foldAndFly): an envelope with the airmail edge and a flap, drawn at 120 x 80 and scaled. */
function letterToken(): { element: HTMLElement; flap: SVGElement } {
  const element = document.createElement('div');
  element.className = 'ui-homing-letter';
  const art = svg('svg', { width: LETTER.width, height: LETTER.height, viewBox: `0 0 ${LETTER.width} ${LETTER.height}`, fill: 'none' });
  // The flap: a triangle hinged on the top edge; closing = from folded up (scaleY -1) to down.
  const flap = svg('path', { d: 'M12 12 L60 46 L108 12', class: 'ui-homing-flap' });
  add(art, svg('path', { d: 'M12 68 L48 40 M108 68 L72 40', class: 'ui-homing-fold' }), flap);
  add(element, art);
  return { element, flap };
}

function badge(count: number): HTMLElement {
  const element = document.createElement('span');
  element.className = 'ui-homing-count';
  element.textContent = count > 99 ? '99+' : String(count);
  return element;
}

interface Token {
  element: HTMLElement;
  size: Size;
  /** The scale at which the element is its token size (the letter is drawn large). */
  unit: number;
}

function makeToken(options: FlyHomeOptions): Token {
  if (options.kind === 'send') {
    const { element } = letterToken();
    if (options.count !== undefined && options.count > 1) {
      add(element, badge(options.count));
    }
    return { element, size: LETTER, unit: LETTER_TOKEN_SCALE };
  }
  const element = document.createElement('div');
  element.className = 'ui-homing-token';
  element.dataset.kind = options.kind ?? 'move';
  const initials = options.initials?.trim() ?? '';
  if (initials === '') {
    add(element, envelopeGlyph());
  } else {
    element.textContent = initials.slice(0, 2);
  }
  if (options.hue !== undefined && options.hue !== '') {
    element.dataset.tint = 'true';
    element.style.setProperty('--ui-hue', options.hue);
  }
  if (options.count !== undefined && options.count > 1) {
    add(element, badge(options.count));
  }
  return { element, size: { width: TOKEN, height: TOKEN }, unit: 1 };
}

/** A dashed trail along the arc, revealed by a mask that follows the token; returns the svg and the mask path. */
function makeTrail(s: Point, c: Point, e: Point, viewport: Size, total: number): { trail: SVGSVGElement; reveal: SVGPathElement } {
  masks += 1;
  const id = `ui-homing-mask-${masks}`;
  const d = `M${s.x.toFixed(1)} ${s.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
  const trail = svg('svg', {
    class: 'ui-homing-trail',
    width: viewport.width,
    height: viewport.height,
    viewBox: `0 0 ${viewport.width} ${viewport.height}`,
    fill: 'none'
  });
  const mask = svg('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: viewport.width, height: viewport.height });
  const reveal = svg('path', {
    d,
    class: 'ui-homing-reveal',
    'stroke-dasharray': `${total.toFixed(1)} ${total.toFixed(1)}`,
    'stroke-dashoffset': total.toFixed(1)
  });
  add(mask, reveal);
  const defs = svg('defs', {});
  add(defs, mask);
  add(trail, defs, svg('path', { d, class: 'ui-homing-dash', mask: `url(#${id})` }));
  return { trail, reveal };
}

// ---------- Where a flight ends ----------

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The part of `el` that is not clipped by a scrolling ancestor or the viewport (empty when it is scrolled out of view). */
function visibleBox(el: Element): Box {
  const rect = el.getBoundingClientRect();
  const clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let parent = el.parentElement; parent !== null && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const edge = parent.getBoundingClientRect();
      clip.left = Math.max(clip.left, edge.left);
      clip.top = Math.max(clip.top, edge.top);
      clip.right = Math.min(clip.right, edge.right);
      clip.bottom = Math.min(clip.bottom, edge.bottom);
    }
  }
  return {
    left: clamp(rect.left, clip.left, clip.right),
    top: clamp(rect.top, clip.top, clip.bottom),
    right: clamp(rect.right, clip.left, clip.right),
    bottom: clamp(rect.bottom, clip.top, clip.bottom)
  };
}

interface End {
  at: Point;
  /** The home that catches it on landing; null: it fades at an edge (the home is scrolled out of view). */
  catcher: HomeId | null;
}

/**
 * Where a flight to `id` ends: the centre of the home; when the home is scrolled out of its list, the nearest edge of what shows (it fades
 * there); when it is not drawn at all (a closed phone drawer), the menu button; else nowhere (no flight).
 */
function endOf(id: HomeId): End | null {
  const el = homeElement(id);
  if (el !== undefined && drawn(el)) {
    // It lands in the home's icon (what the catch pops), else in the middle of the home.
    const icon = el.querySelector(':scope > svg, [data-home-icon]');
    const mid = centre((icon !== null && drawn(icon) ? icon : el).getBoundingClientRect());
    const seen = visibleBox(el);
    if (seen.right - seen.left >= 4 && seen.bottom - seen.top >= 4) {
      return { at: { x: clamp(mid.x, seen.left, seen.right), y: clamp(mid.y, seen.top, seen.bottom) }, catcher: id };
    }
    return {
      at: { x: clamp(mid.x, seen.left + EDGE, Math.max(seen.left + EDGE, seen.right - EDGE)), y: clamp(mid.y, seen.top, seen.bottom) },
      catcher: null
    };
  }
  if (id !== 'menu') {
    const menu = homeElement('menu');
    if (menu !== undefined && drawn(menu)) {
      return { at: centre(menu.getBoundingClientRect()), catcher: 'menu' };
    }
  }
  return null;
}

function rectOf(from: Element | DOMRectReadOnly): DOMRectReadOnly | null {
  if (from instanceof Element) {
    return from.isConnected ? from.getBoundingClientRect() : null;
  }
  return from;
}

const empty = (rect: DOMRectReadOnly | null): rect is null => rect === null || rect.width <= 0 || rect.height <= 0;

// ---------- Flights ----------

/** A failed motion is no failure of the action: pixels only. */
function ignore(): void {
  // nothing to undo
}

interface Flight {
  finish: () => void;
}

const alive: Flight[] = [];

async function settled(animation: Animation): Promise<void> {
  try {
    await animation.finished;
  } catch {
    // cancelled: nothing to wait for
  }
}

interface Launch {
  from: Point;
  to: Point;
  token: Token;
  /** Scale of the token at the start and at the end, in units of its token size. */
  startScale: number;
  endScale: number;
  /** A lift off the row first (scale x1.08 in 90 ms). */
  lift: boolean;
  /** Extra tilt reached at the end, in degrees (trash). */
  tilt: number;
  /** The token fades out from this share of the way on (an arrival 0.86, an edge 0.6). */
  fadeFrom: number;
  /** The reverse flight fades in instead (it comes out of the home). */
  fadeIn: boolean;
  onLand?: () => void;
}

/** Runs one flight in the overlay; resolves when the token has landed (or was finished early). */
function launch(plan: Launch): Promise<void> {
  const root = layer();
  while (alive.length >= MAX_TOKENS) {
    alive.shift()?.finish();
  }
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const { from, to, token } = plan;
  const control = arcControl(from, to, viewport, Math.hypot(to.x - from.x, to.y - from.y) < 160 ? 0.28 : LIFT_SHARE);
  const flightMs = homingDuration(Math.hypot(to.x - from.x, to.y - from.y));
  const liftMs = plan.lift ? LIFT_MS : 0;
  const total = liftMs + flightMs;
  const lengths = arcLengths(from, control, to);
  const length = lengths.at(-1) ?? 0;
  const chord = { x: to.x - from.x, y: to.y - from.y };
  const { width, height } = token.size;
  const place = (p: Point, scale: number, rotate: number): string =>
    `translate(${(p.x - width / 2).toFixed(2)}px, ${(p.y - height / 2).toFixed(2)}px) rotate(${rotate.toFixed(2)}deg) scale(${(scale * token.unit).toFixed(4)})`;

  const tokenFrames: Keyframe[] = [];
  const trailFrames: Keyframe[] = [];
  const liftScale = plan.lift ? plan.startScale * 1.08 : plan.startScale;
  if (plan.lift) {
    tokenFrames.push({ offset: 0, transform: place(from, plan.startScale, 0), opacity: 1 });
    trailFrames.push({ offset: 0, strokeDashoffset: length });
  }
  for (let index = 0; index <= SAMPLES; index++) {
    const u = index / SAMPLES;
    const t = easeHoming(u);
    const at = arcPoint(from, control, to, t);
    const bank = clamp(angleBetween(tangent(from, control, to, t), chord) * 0.6, -24, 24);
    const scale = liftScale + (plan.endScale - liftScale) * t;
    const offset = (liftMs + u * flightMs) / total;
    const fadeOut = t <= plan.fadeFrom ? 1 : clamp(1 - (t - plan.fadeFrom) / (1 - plan.fadeFrom), 0, 1);
    const fade = plan.fadeIn ? clamp(t / 0.18, 0, 1) * fadeOut : fadeOut;
    tokenFrames.push({ offset, transform: place(at, scale, bank + plan.tilt * t), opacity: Number(fade.toFixed(3)) });
    trailFrames.push({ offset, strokeDashoffset: Number((length - lengthAt(lengths, t)).toFixed(1)) });
  }

  const { trail, reveal } = makeTrail(from, control, to, viewport, length);
  token.element.style.transform = place(from, plan.startScale, 0);
  add(root, trail, token.element);
  const timing: KeyframeAnimationOptions = { duration: total, easing: 'linear', fill: 'forwards' };
  const flying = token.element.animate(tokenFrames, timing);
  const drawing = reveal.animate(trailFrames, timing);

  const flight: Flight = {
    finish: () => {
      flying.finish();
      drawing.finish();
    }
  };
  alive.push(flight);
  return settled(flying).then(() => {
    const index = alive.indexOf(flight);
    if (index !== -1) {
      alive.splice(index, 1);
    }
    token.element.remove();
    reveal.setAttribute('stroke-dashoffset', '0');
    drawing.cancel();
    plan.onLand?.();
    const fading = trail.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TRAIL_FADE_MS, easing: EASING.standard, fill: 'forwards' });
    void settled(fading).then(() => {
      trail.remove();
    });
  });
}

/** Nothing flies: no document (the server), a background tab, or reduced motion. */
const grounded = (): boolean => typeof document === 'undefined' || document.hidden || motionReduced();

/**
 * Flies a letter token from `from` (a row, the reader's subject, or a rect) to the home `to`, along an arc, and the home catches it on
 * landing. Resolves when it landed (at once when nothing flies: reduced motion, where only the catch shows; a hidden tab; an empty rect;
 * no home on screen). Never blocks the UI and never throws. When the home is scrolled out of its list it flies to that list's edge and
 * fades; when it is not drawn (a closed phone drawer), to the 'menu' home. For the way back (Undo) use `flyFrom`.
 */
export function flyHome(from: Element | DOMRect, to: HomeId, options: FlyHomeOptions = {}): Promise<void> {
  try {
    if (typeof document === 'undefined' || document.hidden) {
      return Promise.resolve();
    }
    if (motionReduced()) {
      catchHome(to);
      return Promise.resolve();
    }
    const start = rectOf(from);
    const end = endOf(to);
    if (empty(start) || end === null) {
      return Promise.resolve();
    }
    const trash = options.kind === 'trash';
    return launch({
      from: centre(start),
      to: end.at,
      token: makeToken(options),
      startScale: 1,
      endScale: trash ? 0.45 : 0.55,
      lift: true,
      tilt: trash ? 12 : 0,
      fadeFrom: end.catcher === null ? 0.6 : 0.86,
      fadeIn: false,
      onLand: () => {
        if (end.catcher !== null) {
          catchHome(end.catcher);
        }
      }
    }).catch(ignore);
  } catch {
    return Promise.resolve();
  }
}

/**
 * The reverse flight (Undo, a restore back into the list): the token leaves the home `from` small and lands, full size, on `to` (the row in
 * its restored place, or its rect), where the row's own entrance takes over. Same rules as flyHome: resolves when it landed, never throws,
 * nothing flies under reduced motion or in a hidden tab.
 */
export function flyFrom(from: HomeId, to: Element | DOMRect, options: FlyHomeOptions = {}): Promise<void> {
  try {
    if (grounded()) {
      return Promise.resolve();
    }
    const start = endOf(from);
    const end = rectOf(to);
    if (start === null || empty(end)) {
      return Promise.resolve();
    }
    return launch({
      from: start.at,
      to: centre(end),
      token: makeToken(options),
      startScale: 0.55,
      endScale: 1,
      lift: false,
      tilt: 0,
      fadeFrom: 0.9,
      fadeIn: true
    }).catch(ignore);
  } catch {
    return Promise.resolve();
  }
}

/** How long the catch beat lasts at most (the CSS animations end sooner; this only clears a beat whose animationend never came). */
const CATCH_MS = 700;
const catchTimers = new WeakMap<Element, number>();

/**
 * The home catches a message: `data-catch` on its element for one beat (signature.css: its icon, the `svg` child or `[data-home-icon]`,
 * pops 1 -> 1.18 -> 1 with --ease-settle in 320 ms), and a soft accent ring pulses around it in the overlay. Under reduced motion: only a
 * 150 ms background highlight of the home (no ring, no scale). The folder's count rolls from the data, not from here.
 */
export function catchHome(id: HomeId): void {
  try {
    const el = homeElement(id);
    if (el === undefined || typeof window === 'undefined') {
      return;
    }
    const data = datasetOf(el);
    if (data === null) {
      return;
    }
    if (catchTimers.has(el)) {
      // A new beat restarts the CSS animation: the attribute goes and comes back in the next frame.
      window.clearTimeout(catchTimers.get(el));
      catchTimers.delete(el);
      delete data.catch;
      requestAnimationFrame(() => {
        beat(el);
      });
      return;
    }
    beat(el);
  } catch {
    // pixels only
  }
}

/** The data attributes of a home (an HTML or SVG element), or null for another kind of element. */
function datasetOf(el: Element): DOMStringMap | null {
  return el instanceof HTMLElement || el instanceof SVGElement ? el.dataset : null;
}

function beat(el: Element): void {
  const found = datasetOf(el);
  if (found === null) {
    return;
  }
  const data: DOMStringMap = found;
  data.catch = '';
  function clear(): void {
    window.clearTimeout(catchTimers.get(el));
    catchTimers.delete(el);
    delete data.catch;
    el.removeEventListener('animationend', onEnd);
  }
  function onEnd(event: Event): void {
    if (event instanceof AnimationEvent && event.animationName.startsWith('ui-catch')) {
      clear();
    }
  }
  el.addEventListener('animationend', onEnd);
  catchTimers.set(el, window.setTimeout(clear, CATCH_MS));
  if (!motionReduced() && drawn(el)) {
    ring(el);
  }
}

/** The soft accent ring of a catch, drawn in the overlay over the home (nothing is added to the home itself). */
function ring(el: Element): void {
  const rect = el.getBoundingClientRect();
  const halo = document.createElement('div');
  halo.className = 'ui-homing-ring';
  Object.assign(halo.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderRadius: getComputedStyle(el).borderRadius
  });
  add(layer(), halo);
  const pulse = halo.animate(
    [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.35 },
      { opacity: 0, transform: 'scale(1.05)' }
    ],
    { duration: 420, easing: EASING.standard, fill: 'forwards' }
  );
  void settled(pulse).then(() => {
    halo.remove();
  });
}

export interface FoldOptions {
  /** `windowEl` is already an inert copy made by the caller (it is moved into the overlay and removed); default: it is cloned. */
  ghost?: boolean;
  /** A bulk send badge (rare). */
  count?: number;
}

/** An inert copy of `el` at its place, in the overlay (or `el` itself when it already is one). */
function ghostOf(el: Element, rect: DOMRectReadOnly, reuse: boolean): HTMLElement | null {
  const copy = reuse ? el : el.cloneNode(true);
  if (!(copy instanceof HTMLElement)) {
    return null;
  }
  if (!reuse) {
    for (const element of [copy, ...copy.querySelectorAll('[id]')]) {
      element.removeAttribute('id');
    }
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.classList.add('ui-homing-ghost');
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    transform: 'none',
    translate: 'none',
    scale: 'none',
    transition: 'none',
    animation: 'none'
  });
  return copy;
}

/** The fold of the window and the closing of the flap, each. */
const FOLD_MS = 180;

/**
 * H4, send: the compose window folds into a letter that flies home to Sent. `windowEl` is the window (it is cloned into the overlay, so the
 * real one can close at once) or, with `{ ghost: true }` (or `data-homing-ghost` on it), an inert copy the caller made. The copy squashes
 * (scaleY .25) and shrinks to a 120 x 80 letter while it fades (180 ms), the letter's flap closes (180 ms), then the letter flies along
 * the arc to `to` with its trail and Sent catches it. Under reduced motion: no fold, no flight, only the catch. Resolves on landing.
 */
export async function foldAndFly(windowEl: Element, to: HomeId = 'sent', options: FoldOptions = {}): Promise<void> {
  const reuse = options.ghost === true || datasetOf(windowEl)?.homingGhost !== undefined;
  try {
    if (grounded()) {
      if (typeof document !== 'undefined' && !document.hidden) {
        catchHome(to);
      }
      return;
    }
    const rect = windowEl.getBoundingClientRect();
    const end = endOf(to);
    const ghost = empty(rect) || end === null ? null : ghostOf(windowEl, rect, reuse);
    if (ghost === null || end === null) {
      return;
    }
    const root = layer();
    add(root, ghost);
    const middle = centre(rect);
    const { element: letter, flap } = letterToken();
    if (options.count !== undefined && options.count > 1) {
      add(letter, badge(options.count));
    }
    const at = `translate(${(middle.x - LETTER.width / 2).toFixed(2)}px, ${(middle.y - LETTER.height / 2).toFixed(2)}px)`;
    letter.style.transform = at;
    letter.style.opacity = '0';
    flap.style.transform = 'scaleY(-1)';
    add(root, letter);
    const sx = LETTER.width / rect.width;
    const sy = LETTER.height / rect.height;
    const fold = ghost.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: `scale(${Math.max(sx, 0.6).toFixed(3)}, 0.25)`, opacity: 0.9, offset: 0.5 },
        { transform: `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, opacity: 0 }
      ],
      { duration: FOLD_MS, easing: EASING.emphExit, fill: 'forwards' }
    );
    const appear = letter.animate(
      [
        { transform: `${at} scale(1.25, 0.5)`, opacity: 0 },
        { transform: `${at} scale(1)`, opacity: 1 }
      ],
      { duration: FOLD_MS, delay: FOLD_MS * 0.4, easing: EASING.emphEnter, fill: 'forwards' }
    );
    await settled(fold);
    ghost.remove();
    await settled(appear);
    letter.style.opacity = '1';
    appear.cancel();
    const closing = flap.animate([{ transform: 'scaleY(-1)' }, { transform: 'scaleY(1)' }], {
      duration: FOLD_MS,
      easing: EASING.settle,
      fill: 'forwards'
    });
    await settled(closing);
    flap.style.transform = 'none';
    closing.cancel();
    await launch({
      from: middle,
      to: end.at,
      token: { element: letter, size: LETTER, unit: LETTER_TOKEN_SCALE },
      startScale: 1 / LETTER_TOKEN_SCALE,
      endScale: 0.55,
      lift: false,
      tilt: 0,
      fadeFrom: end.catcher === null ? 0.6 : 0.86,
      fadeIn: false,
      onLand: () => {
        if (end.catcher !== null) {
          catchHome(end.catcher);
        }
      }
    });
  } catch {
    // pixels only
  } finally {
    if (reuse && windowEl.isConnected) {
      windowEl.remove();
    }
  }
}
