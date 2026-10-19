import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type MediaStorage, VARIANT_KEY } from './media-storage.js';

/** Development and test storage: files under a git-ignored folder, served at `/media` by `configureApp()`. */
export class LocalMediaStorage implements MediaStorage {
  readonly enabled = true;

  constructor(private readonly directory: string) {}

  async put(key: string, body: Buffer, _contentType: 'image/webp'): Promise<void> {
    // The key shape alone rules out traversal and other file types.
    if (!VARIANT_KEY.test(key)) throw new Error('Refusing to store an unexpected media key.');
    const path = join(this.directory, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
}
