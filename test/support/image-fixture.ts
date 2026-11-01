import { crc32 } from 'node:zlib';
import sharp from 'sharp';

/** A valid PNG with an ancillary text chunk: vary file bytes without changing decoded pixels. */
export async function pngOfSize(bytes: number): Promise<Buffer> {
  const png = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#2a6' },
  })
    .png()
    .toBuffer();
  const padding = bytes - png.length - 12;
  if (padding < 8) throw new Error('Requested fixture is too small.');
  const chunk = Buffer.alloc(padding + 12, 0x20);
  chunk.writeUInt32BE(padding, 0);
  chunk.write('tEXt', 4, 'ascii');
  chunk.write('Padding\0', 8, 'ascii');
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}
