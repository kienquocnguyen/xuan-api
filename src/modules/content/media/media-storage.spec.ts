import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { DisabledMediaStorage } from './disabled-media-storage.js';
import { LocalMediaStorage } from './local-media-storage.js';
import { mediaUrl } from './media-storage.js';
import { R2MediaStorage } from './r2-media-storage.js';

const KEY = 'blog/0190f2a4-0000-7000-8000-000000000000-640.webp';

describe('media storage adapters (blog completion spec §5.3)', () => {
  describe('LocalMediaStorage', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'xuan-media-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('writes the bytes under the folder, creating it', async () => {
      await new LocalMediaStorage(join(dir, 'nested')).put(KEY, Buffer.from('webp'), 'image/webp');
      expect(await readFile(join(dir, 'nested', KEY), 'utf8')).toBe('webp');
    });

    it.each(['../escape.webp', 'blog/../../x.webp', 'blog/abc-640.png', '/etc/passwd'])(
      'refuses the key %s and writes nothing',
      async (key) => {
        await expect(
          new LocalMediaStorage(dir).put(key, Buffer.from('x'), 'image/webp'),
        ).rejects.toThrow();
        await expect(stat(join(dir, 'blog'))).rejects.toThrow();
      },
    );
  });

  describe('R2MediaStorage', () => {
    it('puts one object with its type and an immutable cache header', async () => {
      const send = vi.fn().mockResolvedValue({});
      const storage = new R2MediaStorage({ send } as unknown as S3Client, 'xuan-media');
      await storage.put(KEY, Buffer.from('webp'), 'image/webp');
      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'xuan-media',
        Key: KEY,
        Body: Buffer.from('webp'),
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      });
    });
  });

  describe('DisabledMediaStorage', () => {
    it('is not enabled and refuses to store', async () => {
      const storage = new DisabledMediaStorage();
      expect(storage.enabled).toBe(false);
      await expect(storage.put(KEY, Buffer.from('x'), 'image/webp')).rejects.toThrow();
    });
  });

  it('builds the public URL of a variant', () => {
    expect(mediaUrl('https://media.example', 'blog/abc', 1280)).toBe(
      'https://media.example/blog/abc-1280.webp',
    );
  });
});
