import sharp from 'sharp';
import { ImageRejectedError, sniffImageType, toWebpVariants } from './image-processing.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c33' } });

describe('image processing (blog completion spec §5.1)', () => {
  describe('sniffImageType', () => {
    it.each([
      ['jpeg', () => solid(8, 8).jpeg().toBuffer()],
      ['png', () => solid(8, 8).png().toBuffer()],
      ['webp', () => solid(8, 8).webp().toBuffer()],
      ['avif', () => solid(8, 8).avif().toBuffer()],
    ] as const)('recognizes %s by its magic bytes', async (type, make) => {
      expect(sniffImageType(await make())).toBe(type);
    });

    it.each([
      ['text', Buffer.from('hello, not an image')],
      ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['gif', Buffer.from('GIF89a\x01\x00\x01\x00')],
      ['empty', Buffer.alloc(0)],
    ])('rejects %s', (_name, buffer) => {
      expect(sniffImageType(buffer)).toBeNull();
    });
  });

  describe('toWebpVariants', () => {
    it('makes 640, 1280 and 1920 WebP variants of a large image, keeping its ratio', async () => {
      const variants = await toWebpVariants(await solid(2400, 1600).jpeg().toBuffer());
      expect(variants.map(({ width, height }) => [width, height])).toEqual([
        [640, 427],
        [1280, 853],
        [1920, 1280],
      ]);
      for (const variant of variants) {
        expect((await sharp(variant.data).metadata()).format).toBe('webp');
      }
    });

    it('never enlarges: a narrow image gets one variant at its own width', async () => {
      const variants = await toWebpVariants(await solid(500, 300).png().toBuffer());
      expect(variants.map(({ width, height }) => [width, height])).toEqual([[500, 300]]);
    });

    it('applies EXIF orientation and strips every metadata block', async () => {
      const rotated = await solid(800, 400)
        .jpeg()
        .withMetadata({ orientation: 6 })
        .withExif({ IFD3: { GPSLatitudeRef: 'N' } })
        .toBuffer();
      const [variant] = await toWebpVariants(rotated);
      expect([variant.width, variant.height]).toEqual([400, 800]);
      const meta = await sharp(variant.data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
    });

    it.each([
      ['an animated image', () => animated()],
      ['more than 6 000 pixels on a side', () => solid(6100, 10).png().toBuffer()],
      [
        'more than 36 million pixels',
        () => solid(6000, 6001).png({ compressionLevel: 9 }).toBuffer(),
      ],
      ['a truncated file', async () => (await solid(64, 64).jpeg().toBuffer()).subarray(0, 40)],
    ])('rejects %s', async (_name, make) => {
      await expect(toWebpVariants(await make())).rejects.toBeInstanceOf(ImageRejectedError);
    });
  });
});

async function animated(): Promise<Buffer> {
  const frame = (background: string) =>
    sharp({ create: { width: 10, height: 10, channels: 4, background } })
      .png()
      .toBuffer();
  return sharp([await frame('#f00'), await frame('#0f0')], { join: { animated: true } })
    .webp({ loop: 0 })
    .toBuffer();
}
