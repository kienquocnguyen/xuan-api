import { S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../../../config/load-config.js';
import { DisabledMediaStorage } from './disabled-media-storage.js';
import { LocalMediaStorage } from './local-media-storage.js';
import { R2MediaStorage } from './r2-media-storage.js';

/**
 * The blog's storage gateway (C5, blog completion spec §5.3): where uploaded variants go. Adapters: local disk
 * (development, test), Cloudflare R2 (production), disabled (production before R2 exists, owner Q1).
 */
export interface MediaStorage {
  /** `false` only for the disabled adapter: uploads are answered with 409 before any processing. */
  readonly enabled: boolean;
  put(key: string, body: Buffer, contentType: 'image/webp'): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** A stored variant's key, `blog/<uuid>-<width>.webp`; the only shape any adapter accepts. */
export const VARIANT_KEY = /^blog\/[0-9a-f-]{36}-\d{1,4}\.webp$/;

export const variantKey = (storageKey: string, width: number) => `${storageKey}-${width}.webp`;

/** The public URL of one variant: base + `/` + `<storage_key>-<width>.webp` (spec §5.5, "Media URL"). */
export const mediaUrl = (publicBaseUrl: string, storageKey: string, width: number) =>
  `${publicBaseUrl}/${variantKey(storageKey, width)}`;

export function createMediaStorage(config: AppConfig): MediaStorage {
  const { storage, localDir, r2 } = config.media;
  if (storage === 'local' && localDir) return new LocalMediaStorage(localDir);
  if (storage === 'r2' && r2) {
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    });
    return new R2MediaStorage(client, r2.bucket);
  }
  return new DisabledMediaStorage();
}
