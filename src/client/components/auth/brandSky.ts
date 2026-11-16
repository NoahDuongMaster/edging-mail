// The geometry of the brand panel's sky (authUi BrandPanel): where the hero flight trail enters and the curve it flies to the airmail
// letter. Pure numbers (px, the panel's own box: x from its left edge, y from its top), so a test can check the drawing without a browser.
//
// The story it draws: the letter leaves from the form's main button (Sign in, Continue, Unlock) and lands on the letter of the panel. So the
// trail enters at the panel's left edge level with that button, climbs over the panel's words (never through them) and arrives along the
// letter's own tilt at its back edge, where the letter covers its end.

export interface SkyLetter {
  /** The letter's centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Its tilt in degrees (negative: it rises to the right). */
  tilt: number;
}

export interface SkyCopy {
  left: number;
  top: number;
  right: number;
}

export interface SkyInput {
  width: number;
  height: number;
  /** The centre line of the form's main button, from the panel's top; null when there is none (the trail then enters low on the left). */
  entry: number | null;
  letter: SkyLetter;
  /** The box of the statement and its proof lines, which the trail flies over; null when it is not laid out. */
  copy: SkyCopy | null;
}

export interface SkyTrail {
  /** The curve from the panel's left edge to the letter (the mask that draws it in runs this way). */
  forward: string;
  /** The same curve from the letter back to the edge: the dashes are counted from the letter, so a whole dash meets it. */
  backward: string;
  /** Where it enters, from the panel's top. */
  entry: number;
}

/** The sky of a 1440 x 900 window before anything is measured (the server-side render, the first frame): the same shape the browser draws. */
export const DEFAULT_SKY: SkyInput = {
  width: 704,
  height: 868,
  entry: 650,
  letter: { x: 422, y: 286, width: 237, height: 158, tilt: -12 },
  copy: { left: 151, top: 512, right: 648 }
};

/** How far above the words (and left of their first letter) the trail keeps: 40px where it can, never under 24px. */
const ROOMY = 40;
const SNUG = 24;
/** The small gap between the trail's last dash and the letter's back edge (a trail, not a string tied to it). */
const LANDING_GAP = 14;

interface Point {
  x: number;
  y: number;
}

const round = (value: number): number => Math.round(value * 10) / 10;
const point = ({ x, y }: Point): string => `${round(x)} ${round(y)}`;
const radians = (degrees: number): number => (degrees * Math.PI) / 180;
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/** A point of the letter's own frame (its centre at 0 0, x along its long edge) in the panel. */
function onLetter(letter: SkyLetter, along: number, across: number): Point {
  const angle = radians(letter.tilt);
  return {
    x: letter.x + along * Math.cos(angle) - across * Math.sin(angle),
    y: letter.y + along * Math.sin(angle) + across * Math.cos(angle)
  };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

/** Whether the curve stays `room` px above the words (and inside the panel's top) wherever it passes over them. */
function clears(p0: Point, p1: Point, p2: Point, p3: Point, copy: SkyCopy | null, room: number): boolean {
  for (let step = 0; step <= 64; step += 1) {
    const at = cubicAt(p0, p1, p2, p3, step / 64);
    if (at.y < 8) {
      return false;
    }
    if (copy !== null && at.x >= copy.left - room && at.x <= copy.right && at.y > copy.top - room) {
      return false;
    }
  }
  return true;
}

interface Curve {
  start: Point;
  take: Point;
  before: Point;
  end: Point;
}

/** The curve from an entry height with a given first climb (degrees): it leaves along the climb and lands along the letter's tilt. */
function curve(sky: SkyInput, entry: number, climb: number): Curve {
  const { letter } = sky;
  const start: Point = { x: -6, y: entry };
  const end = onLetter(letter, -letter.width / 2 - LANDING_GAP, letter.height * 0.08);
  const reach = Math.hypot(end.x - start.x, end.y - start.y);
  const arrive = radians(letter.tilt - 14);
  const angle = radians(-climb);
  return {
    start,
    // Never wider than the panel: a letter far right still gets a curve that stays inside the sky.
    take: { x: Math.min(start.x + reach * 0.5 * Math.cos(angle), sky.width), y: start.y + reach * 0.5 * Math.sin(angle) },
    before: { x: end.x - reach * 0.4 * Math.cos(arrive), y: end.y - reach * 0.4 * Math.sin(arrive) },
    end
  };
}

/** The gentlest climb from 16 to 72 degrees that keeps `room` px over the words from this entry, or null when none does. */
function flight(sky: SkyInput, entry: number, room: number): Curve | null {
  for (let climb = 16; climb <= 72; climb += 4) {
    const tried = curve(sky, entry, climb);
    if (clears(tried.start, tried.take, tried.before, tried.end, sky.copy, room)) {
      return tried;
    }
  }
  return null;
}

/**
 * The hero trail: it enters just outside the panel's left edge at the button's height (kept between 45 % and 88 % of the panel, so it
 * always crosses the sky), takes off as gently as the words under it allow (the first climb angle from 16 to 72 degrees that keeps 40px
 * over them, else 24px), and arrives a little from below the letter's tilt, its last dash just short of the letter's back edge. Only when
 * no climb can clear the words from the button's height (a narrow, short sky) does it come in higher, 8px at a time, until it flies over.
 */
export function heroTrail(sky: SkyInput): SkyTrail {
  const { height } = sky;
  const low = height * 0.45;
  const wanted = clamp(sky.entry ?? height * 0.72, low, height * 0.88);
  let entry = wanted;
  let found = flight(sky, entry, ROOMY) ?? flight(sky, entry, SNUG);
  while (found === null && entry - 8 >= low) {
    entry -= 8;
    found = flight(sky, entry, SNUG);
  }
  // Nothing clears even from 45 % (the words fill the sky): the button's height, with the steepest climb.
  const { start, take, before, end } = found ?? curve(sky, wanted, 72);
  return {
    forward: `M${point(start)} C${point(take)} ${point(before)} ${point(end)}`,
    backward: `M${point(end)} C${point(before)} ${point(take)} ${point(start)}`,
    entry: round(start.y)
  };
}
