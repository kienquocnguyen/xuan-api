import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { type MediaStorage, VARIANT_KEY } from './media-storage.js';

/** Production storage: Cloudflare R2 through its S3 API. Keys are random, so files are cached forever. */
export class R2MediaStorage implements MediaStorage {
  readonly enabled = true;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: 'image/webp'): Promise<void> {
    if (!VARIANT_KEY.test(key)) throw new Error('Refusing to store an unexpected media key.');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }
}
