import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { groupSecret, sixDigits } from '../../src/client/components/auth/TwoFactorEnrolment';
import { recoveryCodesFile } from '../../src/client/components/auth/RecoveryCodesPanel';
import { qrMatrix } from '../../src/client/lib/crypto/qr';
import { translatorFor } from '../../src/shared/i18n';
import { base32, otpauthUri } from '../../src/worker/auth/totp';

// The pure logic of the two-factor enrolment screen: the QR path, the manual key in groups of four, the six digits, the recovery codes file.

// What the server sends for a fixed secret (bytes 0..19), so the QR code carries a link of the real shape (about 150 characters).
const SECRET = Uint8Array.from({ length: 20 }, (_, index) => index);
const URI = otpauthUri('mai.nguyen@acme-corp.example', SECRET, 'Edging Mail');

// Bytes a QR code can hold in byte mode at error correction M, per version 1 to 12 (ISO/IEC 18004, table 7).
const BYTE_CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287];

interface Run {
  x: number;
  y: number;
  length: number;
}

const RUN = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;

/** The runs a path is made of; the path must be nothing but runs. */
function runsOf(path: string): Run[] {
  expect(path.replaceAll(RUN, '')).toBe('');
  return [...path.matchAll(RUN)].map((match) => {
    expect(match[3]).toBe(match[4]);
    return { x: Number(match[1]), y: Number(match[2]), length: Number(match[3]) };
  });
}

/** The set of dark modules a path draws, as "row,column" keys. */
function darkOf(path: string): Set<string> {
  const dark = new Set<string>();
  for (const run of runsOf(path)) {
    for (let offset = 0; offset < run.length; offset += 1) {
      dark.add(`${run.y},${run.x + offset}`);
    }
  }
  return dark;
}

/** The generator's own answer for the same text, to compare the path against. */
function reference(text: string): { size: number; dark: Set<string> } {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  const dark = new Set<string>();
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (code.isDark(row, column)) {
        dark.add(`${row},${column}`);
      }
    }
  }
  return { size, dark };
}

describe('qrMatrix', () => {
  it('makes a square of 17 + 4 x version modules, and the smallest version that holds the text at level M', async () => {
    const { size } = await qrMatrix(URI);
    expect((size - 17) % 4).toBe(0);
    const version = (size - 17) / 4;
    expect(size).toBe(21 + 4 * (version - 1));
    const smallest = BYTE_CAPACITY_M.findIndex((capacity) => capacity >= URI.length) + 1;
    expect(smallest).toBeGreaterThan(0);
    expect(version).toBe(smallest);
    // A text of 14 bytes fits version 1 (21 x 21); one more byte needs version 2 (25 x 25).
    expect((await qrMatrix('x'.repeat(14))).size).toBe(21);
    expect((await qrMatrix('x'.repeat(15))).size).toBe(25);
  });

  it('writes one path of "M<x> <y>h<n>v1h-<n>z" runs: only M h v z, digits, a space and a minus', async () => {
    const { path } = await qrMatrix(URI);
    expect(path).toMatch(/^M/);
    expect(path).toMatch(/^[Mhvz\d -]+$/);
    expect(path).not.toContain('<');
    expect(runsOf(path).length).toBeGreaterThan(100);
  });

  it('is deterministic, and another text gives another picture', async () => {
    const first = await qrMatrix(URI);
    const second = await qrMatrix(URI);
    expect(second).toEqual(first);
    const other = await qrMatrix(otpauthUri('mai.nguyen@acme-corp.example', SECRET.toReversed(), 'Edging Mail'));
    expect(other.size).toBe(first.size);
    expect(other.path).not.toBe(first.path);
  });

  it('draws exactly the dark modules of the generator: same cells, the unit squares add up to its dark count', async () => {
    const { size, path } = await qrMatrix(URI);
    const expected = reference(URI);
    expect(size).toBe(expected.size);
    const dark = darkOf(path);
    expect(dark.size).toBe(expected.dark.size);
    expect(dark).toEqual(expected.dark);
    // No module is drawn twice and no run leaves the square.
    const runs = runsOf(path);
    expect(runs.reduce((sum, run) => sum + run.length, 0)).toBe(expected.dark.size);
    expect(runs.every((run) => run.length > 0 && run.x >= 0 && run.y >= 0 && run.x + run.length <= size && run.y < size)).toBe(true);
  });

  it('merges every horizontal run completely: no two runs of a row touch', async () => {
    const { path } = await qrMatrix(URI);
    const byRow = Map.groupBy(runsOf(path), (run) => run.y);
    for (const runs of byRow.values()) {
      const ordered = runs.toSorted((a, b) => a.x - b.x);
      for (let index = 1; index < ordered.length; index += 1) {
        expect(ordered[index].x).toBeGreaterThan(ordered[index - 1].x + ordered[index - 1].length);
      }
    }
  });

  it('has the three finder patterns in the corners (7 x 7 ring, 3 x 3 centre), whatever the data', async () => {
    const { size, path } = await qrMatrix(URI);
    const dark = darkOf(path);
    const cell = (row: number, column: number): boolean => dark.has(`${row},${column}`);
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0]
    ]) {
      for (let row = 0; row < 7; row += 1) {
        for (let column = 0; column < 7; column += 1) {
          const ring = row === 0 || row === 6 || column === 0 || column === 6;
          const centre = row >= 2 && row <= 4 && column >= 2 && column <= 4;
          expect(cell(top + row, left + column), `${top + row},${left + column}`).toBe(ring || centre);
        }
      }
    }
  });

  it('refuses text that a scanner would read as garbage, or that does not fit', async () => {
    await expect(qrMatrix('')).rejects.toThrow('printable ASCII');
    await expect(qrMatrix('otpauth://totp/Mai Nguyễn')).rejects.toThrow('printable ASCII');
    await expect(qrMatrix('a\nb')).rejects.toThrow('printable ASCII');
    await expect(qrMatrix('a'.repeat(3000))).rejects.toThrow('does not fit');
  });
});

describe('groupSecret', () => {
  it('splits the manual key into groups of four, the last one shorter when needed', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toEqual(['JBSW', 'Y3DP', 'EHPK', '3PXP']);
    expect(groupSecret('ABCDEFGHIJ')).toEqual(['ABCD', 'EFGH', 'IJ']);
    expect(groupSecret('ABC')).toEqual(['ABC']);
    expect(groupSecret('')).toEqual([]);
  });

  it('gives eight groups for the 32 characters of a real secret, and joining them with spaces keeps every character', () => {
    const secret = base32(SECRET);
    expect(secret).toHaveLength(32);
    const groups = groupSecret(secret);
    expect(groups).toHaveLength(8);
    expect(groups.every((group) => group.length === 4)).toBe(true);
    expect(groups.join('')).toBe(secret);
    expect(URI).toContain(`secret=${secret}&`);
  });

  it('ignores spaces already in the text', () => {
    expect(groupSecret('ABCD EFGH\nIJ')).toEqual(['ABCD', 'EFGH', 'IJ']);
  });
});

describe('sixDigits', () => {
  it.each([
    ['123456', '123456'],
    ['123 456', '123456'],
    ['12a3-4b', '1234'],
    ['1234567', '123456'],
    ['', ''],
    ['abc', ''],
    ['\u0663\u0664\u0665', '']
  ])('turns %j into %j', (typed, digits) => {
    expect(sixDigits(typed)).toBe(digits);
  });
});

describe('recoveryCodesFile', () => {
  const en = translatorFor('en');
  const codes = ['ABCD-EFGH-JKLM', 'NPQR-STUV-WXYZ', '2345-6723-4567'];

  it('is a title line, the codes one per line in order, and one sentence about using each once', () => {
    const lines = recoveryCodesFile(codes, en).split('\n');
    expect(lines[0]).toBe('Edging Mail recovery codes');
    expect(lines[1]).toBe('');
    expect(lines.slice(2, 5)).toEqual(codes);
    expect(lines[5]).toBe('');
    expect(lines[6]).toMatch(/^Each recovery code works once\./);
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(8);
  });

  it('never calls the codes the recovery key', () => {
    expect(recoveryCodesFile(codes, en)).not.toMatch(/recovery key/i);
  });

  it('is still a title and a sentence when there are no codes', () => {
    expect(recoveryCodesFile([], en)).toBe(`${en('twofa.file_title')}\n\n\n\n${en('twofa.file_note')}\n`);
  });
});

describe('the English text of the screen', () => {
  const en = translatorFor('en');

  it('uses the glossary words and never "2FA" or "two-step"', () => {
    const keys = [
      'twofa.intro',
      'twofa.scan_lead',
      'twofa.qr_label',
      'twofa.qr_failed',
      'twofa.manual_title',
      'twofa.copy_failed',
      'twofa.code_label',
      'twofa.code_hint',
      'twofa.verify',
      'twofa.codes_title',
      'twofa.codes_lead',
      'twofa.codes_not_key',
      'twofa.codes_keep',
      'twofa.download',
      'twofa.saved_check',
      'twofa.saved_hint',
      'twofa.continue',
      'twofa.file_title',
      'twofa.file_note'
    ] as const;
    for (const key of keys) {
      expect(en(key), key).not.toMatch(/2FA|two-step|conversation/i);
    }
    expect(en('twofa.intro').toLowerCase()).toContain(en('term.two_factor').toLowerCase());
    expect(en('twofa.intro').toLowerCase()).toContain(en('term.authenticator_app').toLowerCase());
    expect(en('twofa.codes_not_key')).toMatch(/^Recovery codes /);
    expect(en('twofa.codes_not_key')).toMatch(/recovery key/);
    // Buttons are verb phrases without a final stop.
    for (const key of ['twofa.verify', 'twofa.download', 'twofa.continue'] as const) {
      expect(en(key), key).not.toMatch(/[.!?:]$/);
    }
  });
});
