// The QR code of the two-factor enrolment, as data a component can draw without innerHTML: the number of modules on a side and ONE svg path
// that covers every dark module. The generator (qrcode-generator, exact-pinned) is imported when this runs, so it is a chunk of its own that
// loads on the enrolment screen only, never with the mailbox.

export interface QrMatrix {
  /** Modules per side; the quiet zone is NOT included (the viewBox draws it). A QR code of version v has 17 + 4v of them. */
  size: number;
  /** A path `d` string in module units: one `M<x> <y>h<n>v1h-<n>z` rectangle for every horizontal run of n dark modules. */
  path: string;
}

// The generator turns each UTF-16 unit into one byte, so anything outside printable ASCII would come out as a code that scans as garbage.
// An otpauth link is percent-encoded and always inside this range.
const PRINTABLE_ASCII = /^[\u0020-\u007E]+$/;

/** The QR code of `text`: error correction M, the smallest version that holds it. Rejects when the text cannot be carried by a QR code. */
export async function qrMatrix(text: string): Promise<QrMatrix> {
  if (!PRINTABLE_ASCII.test(text)) {
    throw new Error('the text for a QR code must be printable ASCII');
  }
  const { default: qrcode } = await import('qrcode-generator');
  const code = qrcode(0, 'M');
  code.addData(text);
  try {
    code.make();
  } catch {
    // The generator throws a bare string when the text is longer than version 40 can hold.
    throw new Error('the text does not fit in a QR code');
  }
  const size = code.getModuleCount();
  const runs: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let column = 0;
    while (column < size) {
      if (code.isDark(row, column)) {
        const start = column;
        while (column < size && code.isDark(row, column)) {
          column += 1;
        }
        runs.push(`M${start} ${row}h${column - start}v1h-${column - start}z`);
      } else {
        column += 1;
      }
    }
  }
  return { size, path: runs.join('') };
}
