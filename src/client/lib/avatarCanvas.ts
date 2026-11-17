import { AvatarImageError, checkFile, encodeWithinBudget, squareCrop, toBase64, type AvatarMime, type Encoder } from './avatarImage';

// Preparing a profile picture, the browser side: decode the chosen file, cut the largest centred square, draw it into a small canvas and
// let avatarImage.ts find the best encoding that fits the budget. Needs a browser (createImageBitmap or <img>, canvas); the rules it
// follows are the pure ones of avatarImage.ts, which test/client/avatar.test.ts runs in Node.

interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Lets go of the decoded pixels (an ImageBitmap holds memory until closed). */
  release: () => void;
}

/** createImageBitmap, with the orientation the photo's own metadata asks for (a phone's portrait is stored sideways). */
async function viaBitmap(file: Blob): Promise<Source> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  return {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => {
      bitmap.close();
    }
  };
}

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    });
    reader.addEventListener('error', () => {
      reject(new AvatarImageError('cannot_read'));
    });
    reader.readAsDataURL(file);
  });

/**
 * The fallback where createImageBitmap is missing or refuses the options: an <img> (it applies the photo's orientation itself). The file
 * goes in as a data: address, not a blob: one, because the page's `img-src` names data: and https: but not blob:.
 */
async function viaImage(file: Blob): Promise<Source> {
  const image = new Image();
  image.src = await readAsDataUrl(file);
  await image.decode();
  return {
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => {
      image.removeAttribute('src');
    }
  };
}

async function decode(file: Blob): Promise<Source> {
  let source: Source;
  try {
    source = typeof createImageBitmap === 'function' ? await viaBitmap(file).catch(() => viaImage(file)) : await viaImage(file);
  } catch (error) {
    throw error instanceof AvatarImageError ? error : new AvatarImageError('cannot_read');
  }
  if (source.width < 1 || source.height < 1) {
    source.release();
    throw new AvatarImageError('cannot_read');
  }
  return source;
}

/** The encoder of avatarImage.ts for one decoded picture: the centred square drawn into a `side` x `side` canvas, smoothed, then encoded. */
function canvasEncoder(source: Source): Encoder {
  const crop = squareCrop(source.width, source.height);
  return async (side, mime, quality) => {
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new AvatarImageError('cannot_read');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // Transparent parts of a PNG would turn black in a JPEG: the picture goes on plain white (these are pixels of the picture, not UI colour).
    context.fillStyle = 'white';
    context.fillRect(0, 0, side, side);
    context.drawImage(source.image, crop.x, crop.y, crop.side, crop.side, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, mime, quality);
    });
    if (blob === null) {
      throw new AvatarImageError('cannot_read');
    }
    return { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
  };
}

/**
 * A chosen file made into what the Worker takes: refused before decoding when it is not an image or over 10 MB, otherwise a centred square
 * of 128 px (96 when that cannot be made small enough), WebP or JPEG, 10 KB or less, as standard base64. Throws an `AvatarImageError`.
 */
export async function prepareAvatar(file: File): Promise<{ mime: AvatarMime; data: string }> {
  checkFile(file);
  const source = await decode(file);
  try {
    const prepared = await encodeWithinBudget(canvasEncoder(source));
    return { mime: prepared.mime, data: toBase64(prepared.bytes) };
  } finally {
    source.release();
  }
}
