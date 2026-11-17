// Preparing a profile picture, the pure part: what a chosen file may be, the square it is cut to, and the encode loop that keeps the result
// under the Worker's limit (PUT /api/avatar refuses more than 12000 decoded bytes; this aims at 10000). Nothing here touches the DOM: the
// browser's canvas comes in as an `Encoder`, so test/client/avatar.test.ts runs all of it in Node. avatarCanvas.ts is the browser side.

/** The kinds of image the Worker accepts. */
export type AvatarMime = 'image/webp' | 'image/jpeg';

/** Why a picture was turned down; the person's own words for each are `avatar.<kind>` in the catalogue. */
export type AvatarProblem = 'too_large' | 'not_image' | 'cannot_read';

export class AvatarImageError extends Error {
  readonly problem: AvatarProblem;

  constructor(problem: AvatarProblem) {
    super(problem);
    this.name = 'AvatarImageError';
    this.problem = problem;
  }
}

/** A chosen file over this many bytes is refused before anything is decoded (a photo of a phone is 2 to 8 MB). */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** The encoded picture aims under this many bytes; the Worker's own limit is 12000, so there is room for it to be a little off. */
export const TARGET_BYTES = 10_000;
/** The side of the square in pixels: first 128 (sharp on a 56 px tile at 2x), then 96 when 128 does not fit even at the lowest quality. */
export const SIDES: readonly number[] = [128, 96];
/** The encoder qualities, best first: from 0.85 down in steps of 0.1, then the floor 0.4. */
export const QUALITIES: readonly number[] = [0.85, 0.75, 0.65, 0.55, 0.45, 0.4];

/** Checks a chosen file BEFORE it is decoded: an image type (an empty type is let through, some systems do not name one) and a size. */
export function checkFile(file: { type: string; size: number }): void {
  if (file.type !== '' && !file.type.startsWith('image/')) {
    throw new AvatarImageError('not_image');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarImageError('too_large');
  }
  if (file.size === 0) {
    throw new AvatarImageError('cannot_read');
  }
}

/** The largest centred square of a width x height picture: where it starts and its side. */
export function squareCrop(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

/** What the browser's canvas answered for one try: the type it really made (it may not be the one asked for) and the bytes. */
export interface Encoded {
  type: string;
  bytes: Uint8Array;
}

/** Draws the picture into a `side` x `side` square and encodes it as `mime` at `quality` (the browser side, avatarCanvas.ts). */
export type Encoder = (side: number, mime: AvatarMime, quality: number) => Promise<Encoded>;

export interface Prepared {
  mime: AvatarMime;
  bytes: Uint8Array;
}

/**
 * Finds the best picture that fits: WebP at the first quality of the first side; when the browser answers another type (Safari before 17
 * makes a PNG when it cannot do WebP) every later try is JPEG; a result over the budget lowers the quality, and when even the lowest quality
 * is over, the next, smaller side starts again at the best quality. Nothing fits: `cannot_read`.
 */
export async function encodeWithinBudget(
  encode: Encoder,
  limits: { sides?: readonly number[]; qualities?: readonly number[]; bytes?: number } = {}
): Promise<Prepared> {
  const sides = limits.sides ?? SIDES;
  const qualities = limits.qualities ?? QUALITIES;
  const budget = limits.bytes ?? TARGET_BYTES;
  let mime: AvatarMime = 'image/webp';
  for (const side of sides) {
    for (const quality of qualities) {
      let made = await encode(side, mime, quality);
      if (mime === 'image/webp' && made.type !== 'image/webp') {
        // WebP is not made here: JPEG from now on, starting again at this quality.
        mime = 'image/jpeg';
        made = await encode(side, mime, quality);
      }
      if (made.type !== mime) {
        throw new AvatarImageError('cannot_read');
      }
      if (made.bytes.length > 0 && made.bytes.length <= budget) {
        return { mime, bytes: made.bytes };
      }
    }
  }
  throw new AvatarImageError('cannot_read');
}

/** The standard base64 (with padding) of some bytes, in slices so a long array does not overflow the argument list of `fromCodePoint` (a byte is a code point below 256: a Latin-1 character, which is what `btoa` takes). */
export function toBase64(bytes: Uint8Array): string {
  const SLICE = 0x80_00;
  let binary = '';
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCodePoint(...bytes.subarray(at, at + SLICE));
  }
  return btoa(binary);
}
