import { describe, expect, it } from 'vitest';
import {
  AvatarImageError,
  MAX_SOURCE_BYTES,
  QUALITIES,
  SIDES,
  TARGET_BYTES,
  checkFile,
  encodeWithinBudget,
  squareCrop,
  toBase64,
  type Encoder
} from '../../src/client/lib/avatarImage';

// Preparing a profile picture, the pure half: the checks before decoding, the square, the encode budget and base64, with a stand-in for the
// browser's canvas (there is none in Node).

/** A stand-in canvas: records each try, and answers `bytes(side, quality, mime)` bytes of the type it is told to make. */
function canvas(bytes: (side: number, quality: number, mime: string) => number, type: (mime: string) => string = (mime) => mime) {
  const calls: { side: number; mime: string; quality: number }[] = [];
  const encode: Encoder = (side, mime, quality) => {
    calls.push({ side, mime, quality });
    return Promise.resolve({ type: type(mime), bytes: new Uint8Array(bytes(side, quality, mime)) });
  };
  return { calls, encode };
}

describe('preparing the picture (the pure half)', () => {
  it('refuses, before decoding, a file that is not an image or is over 10 MB, and lets an unnamed type and exactly 10 MB through', () => {
    expect(() => {
      checkFile({ type: 'application/pdf', size: 1000 });
    }).toThrow(expect.objectContaining({ problem: 'not_image' }));
    expect(() => {
      checkFile({ type: 'image/jpeg', size: MAX_SOURCE_BYTES + 1 });
    }).toThrow(expect.objectContaining({ problem: 'too_large' }));
    expect(() => {
      checkFile({ type: 'text/plain', size: MAX_SOURCE_BYTES + 1 });
    }).toThrow(expect.objectContaining({ problem: 'not_image' }));
    expect(() => {
      checkFile({ type: 'image/png', size: 0 });
    }).toThrow(expect.objectContaining({ problem: 'cannot_read' }));
    expect(() => {
      checkFile({ type: 'image/png', size: MAX_SOURCE_BYTES });
    }).not.toThrow();
    expect(() => {
      checkFile({ type: '', size: 5000 });
    }).not.toThrow();
    expect(new AvatarImageError('too_large')).toBeInstanceOf(Error);
  });

  it('cuts the largest centred square', () => {
    expect(squareCrop(400, 300)).toEqual({ x: 50, y: 0, side: 300 });
    expect(squareCrop(300, 400)).toEqual({ x: 0, y: 50, side: 300 });
    expect(squareCrop(512, 512)).toEqual({ x: 0, y: 0, side: 512 });
    expect(squareCrop(101, 50)).toEqual({ x: 25, y: 0, side: 50 });
  });

  it('starts at 128 px, WebP, quality 0.85 and stops at the first result within 10000 bytes', async () => {
    expect(SIDES).toEqual([128, 96]);
    expect(QUALITIES[0]).toBe(0.85);
    expect(QUALITIES.at(-1)).toBe(0.4);
    expect(TARGET_BYTES).toBe(10_000);
    const stand = canvas(() => 6000);
    const done = await encodeWithinBudget(stand.encode);
    expect(done.mime).toBe('image/webp');
    expect(done.bytes).toHaveLength(6000);
    expect(stand.calls).toEqual([{ side: 128, mime: 'image/webp', quality: 0.85 }]);
  });

  it('lowers the quality step by step from 0.85 until the blob fits, at the same side', async () => {
    const stand = canvas((_side, quality) => Math.round(quality * 20_000));
    const done = await encodeWithinBudget(stand.encode);
    expect(stand.calls.map((call) => call.quality)).toEqual([0.85, 0.75, 0.65, 0.55, 0.45]);
    expect(new Set(stand.calls.map((call) => call.side))).toEqual(new Set([128]));
    expect(done.bytes).toHaveLength(9000);
  });

  it('accepts exactly the budget and refuses one byte more', async () => {
    const exact = canvas(() => TARGET_BYTES);
    expect((await encodeWithinBudget(exact.encode)).bytes).toHaveLength(TARGET_BYTES);
    const over = canvas((_side, quality) => (quality > 0.65 ? TARGET_BYTES + 1 : TARGET_BYTES));
    expect((await encodeWithinBudget(over.encode)).bytes).toHaveLength(TARGET_BYTES);
    expect(over.calls.map((call) => call.quality)).toEqual([0.85, 0.75, 0.65]);
  });

  it('repeats at 96 px, from the best quality again, when 0.4 is still too big at 128', async () => {
    const stand = canvas((side) => (side === 128 ? 15_000 : 8000));
    const done = await encodeWithinBudget(stand.encode);
    expect(done.bytes).toHaveLength(8000);
    const at128 = stand.calls.filter((call) => call.side === 128);
    expect(at128.map((call) => call.quality)).toEqual([...QUALITIES]);
    expect(stand.calls.find((call) => call.side === 96)).toEqual({ side: 96, mime: 'image/webp', quality: 0.85 });
    expect(stand.calls.at(-1)?.side).toBe(96);
  });

  it('turns to JPEG for good when the browser answers another type than WebP (Safari makes a PNG)', async () => {
    const stand = canvas(
      (_side, quality) => Math.round(quality * 20_000),
      (mime) => (mime === 'image/webp' ? 'image/png' : mime)
    );
    const done = await encodeWithinBudget(stand.encode);
    expect(done.mime).toBe('image/jpeg');
    // One WebP try, then JPEG from the same quality on, never WebP again.
    expect(stand.calls[0]).toEqual({ side: 128, mime: 'image/webp', quality: 0.85 });
    expect(stand.calls[1]).toEqual({ side: 128, mime: 'image/jpeg', quality: 0.85 });
    expect(stand.calls.filter((call) => call.mime === 'image/webp')).toHaveLength(1);
    expect(done.bytes).toHaveLength(9000);
  });

  it('gives up with `cannot_read` when nothing fits, when the type is neither WebP nor JPEG, or when the canvas makes nothing', async () => {
    const huge = canvas(() => 50_000);
    await expect(encodeWithinBudget(huge.encode)).rejects.toMatchObject({ problem: 'cannot_read' });
    expect(huge.calls).toHaveLength(SIDES.length * QUALITIES.length);
    const odd = canvas(
      () => 100,
      () => 'image/gif'
    );
    await expect(encodeWithinBudget(odd.encode)).rejects.toMatchObject({ problem: 'cannot_read' });
    const empty = canvas(() => 0);
    await expect(encodeWithinBudget(empty.encode)).rejects.toMatchObject({ problem: 'cannot_read' });
  });

  it('writes standard base64 with padding, in slices that do not break at the slice edge', () => {
    for (const length of [0, 1, 2, 3, 4, 100, 32_767, 32_768, 32_769, 70_001]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      // The reference builds the whole binary string at once (no slices), which is what the slicing must be equal to.
      const whole = [...bytes].map((byte) => String.fromCodePoint(byte)).join('');
      expect(toBase64(bytes), `${length} bytes`).toBe(btoa(whole));
    }
    expect(toBase64(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]))).toBe('//79/A==');
  });
});
