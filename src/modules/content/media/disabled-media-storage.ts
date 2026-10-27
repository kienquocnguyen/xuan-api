import type { MediaStorage } from './media-storage.js';

/** `MEDIA_STORAGE=disabled` (owner Q1): an explicit off switch, never a fallback. The service answers 409 first. */
export class DisabledMediaStorage implements MediaStorage {
  readonly enabled = false;

  put(_key: string, _body: Buffer, _contentType: 'image/webp'): Promise<void> {
    return Promise.reject(new Error('Media storage is disabled.'));
  }
}
