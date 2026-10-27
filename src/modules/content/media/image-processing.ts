import sharp from 'sharp';

/** Upload limits (blog completion spec §5.1). */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_PIXELS = 36_000_000;
const MAX_SIDE = 6000;
const VARIANT_WIDTHS = [640, 1280, 1920] as const;
const WEBP_QUALITY = 82;

export type ImageType = 'jpeg' | 'png' | 'webp' | 'avif';
export type WebpVariant = Readonly<{ width: number; height: number; data: Buffer }>;

/** What sharp's `metadata().format` reports for each accepted type (AVIF decodes through libheif). */
const DECODER_FORMAT: Readonly<Record<ImageType, string>> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'heif',
};

/** The upload is not an image we accept; the service answers 400 at `file`. */
export class ImageRejectedError extends Error {}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0) =>
  buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);
const ascii = (buffer: Buffer, start: number, end: number) =>
  buffer.length >= end ? buffer.toString('latin1', start, end) : '';

/** The type from the file's own bytes; the client's MIME type and filename are never trusted. */
export function sniffImageType(buffer: Buffer): ImageType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return 'webp';
  if (ascii(buffer, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(buffer, 8, 12))) {
    return 'avif';
  }
  return null;
}

/**
 * Decodes once under a pixel limit, refuses animations and oversized sides, then re-encodes each width of
 * 640/1280/1920 that fits (or the image's own width) to WebP. `rotate()` applies EXIF orientation; re-encoding
 * drops EXIF (GPS included), ICC and XMP.
 */
export async function toWebpVariants(input: Buffer): Promise<WebpVariant[]> {
  // Only our four formats reach the decoder: sharp would also rasterize SVG, GIF, TIFF… (spec §5.1 step 2, §8).
  const type = sniffImageType(input);
  if (!type) throw new ImageRejectedError('Not a JPEG, PNG, WebP or AVIF image.');
  const open = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  let width: number;
  let height: number;
  try {
    const meta = await open().metadata();
    // The decoder must agree with the magic bytes, so a polyglot can't pick another decoder.
    if (meta.format !== DECODER_FORMAT[type]) {
      throw new ImageRejectedError('Mismatched image type.');
    }
    if ((meta.pages ?? 1) > 1) throw new ImageRejectedError('Animated images are not accepted.');
    ({ width, height } = meta.autoOrient);
  } catch (error) {
    throw error instanceof ImageRejectedError ? error : new ImageRejectedError('Unreadable image.');
  }
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) {
    throw new ImageRejectedError('The image is too large.');
  }
  const widths = VARIANT_WIDTHS.filter((candidate) => candidate <= width);
  const targets = widths.length > 0 ? widths : [width];
  // Refusals above never wait; only the re-encode takes a slot, and its widths run one after another.
  return imagePipelines.run(async () => {
    const variants: WebpVariant[] = [];
    try {
      for (const target of targets) {
        const { data, info } = await open()
          .rotate()
          .resize({ width: target, withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer({ resolveWithObject: true });
        variants.push({ width: info.width, height: info.height, data });
      }
    } catch {
      throw new ImageRejectedError('Unreadable image.');
    }
    return variants;
  });
}

export type Limiter = Readonly<{
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}>;

/** At most `max` tasks at once; the rest wait in arrival order. A failed task frees its slot like any other. */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];
  // A freed slot passes straight to the next waiter, so an arrival in between can't take it as well.
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
      else active += 1;
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}

/**
 * Re-encodes running at once in this process. Peak memory grows with concurrent re-encodes, not with one upload:
 * measured on a 36 MP noisy PNG, one upload's three widths took ~235 MB in parallel and ~87 MB one after another,
 * and four parallel uploads ~300–350 MB either way. Two keeps the worst case near 175 MB.
 */
export const MAX_CONCURRENT_PIPELINES = 2;
export const imagePipelines = createLimiter(MAX_CONCURRENT_PIPELINES);
