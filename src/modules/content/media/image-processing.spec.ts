import sharp from 'sharp';
import {
  createLimiter,
  ImageRejectedError,
  imagePipelines,
  MAX_CONCURRENT_PIPELINES,
  sniffImageType,
  toWebpVariants,
} from './image-processing.js';

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
    it.each([
      ['jpeg', () => solid(700, 500).jpeg().toBuffer()],
      ['png', () => solid(700, 500).png().toBuffer()],
      ['webp', () => solid(700, 500).webp().toBuffer()],
      ['avif', () => solid(700, 500).avif().toBuffer()],
    ])('accepts %s, whose decoder agrees with its magic bytes', async (_name, make) => {
      const variants = await toWebpVariants(await make());
      expect(variants.map(({ width }) => width)).toEqual([640]);
    });

    // Each of these decodes in sharp; only the magic-byte allow-list refuses them (spec §5.1 step 2, §8).
    it.each([
      [
        'a sized SVG',
        async () =>
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="red"/></svg>',
          ),
      ],
      ['a GIF', () => solid(700, 500).gif().toBuffer()],
      ['a TIFF', () => solid(700, 500).tiff().toBuffer()],
    ])('refuses %s that sharp could decode', async (_name, make) => {
      const input = await make();
      expect((await sharp(input).metadata()).width).toBeGreaterThan(0); // decodable: the guard is the sniff
      await expect(toWebpVariants(input)).rejects.toBeInstanceOf(ImageRejectedError);
    });

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

// Memory is bounded by how many re-encodes run at once, not by one upload (measured: workflow ledger).
describe('bounded image pipelines', () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it('runs at most its limit at once, in arrival order, and frees a slot when a task fails', async () => {
    const limiter = createLimiter(2);
    const tasks = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = tasks.map((task, i) =>
      limiter.run(async () => {
        started.push(i);
        await task.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    expect([limiter.active, limiter.waiting]).toEqual([2, 2]);

    tasks[1].reject(new Error('decode failed'));
    await expect(results[1]).rejects.toThrow('decode failed');
    await tick();
    expect(started).toEqual([0, 1, 2]);

    tasks[0].resolve();
    tasks[2].resolve();
    tasks[3].resolve();
    expect(await Promise.all([results[0], results[2], results[3]])).toEqual([0, 2, 3]);
    expect([limiter.active, limiter.waiting]).toEqual([0, 0]);
  });

  it("encodes one upload's widths one after another (final review)", async () => {
    const proto = Object.getPrototypeOf(sharp()) as { toBuffer: (...args: unknown[]) => unknown };
    const original = proto.toBuffer;
    let inFlight = 0;
    let peak = 0;
    const spy = vi.spyOn(proto, 'toBuffer').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await (original.apply(this, args) as Promise<unknown>);
      } finally {
        inFlight -= 1;
      }
    });
    try {
      const input = await solid(2000, 1000).png().toBuffer();
      peak = 0;
      const variants = await toWebpVariants(input);
      expect(variants.map(({ width }) => width)).toEqual([640, 1280, 1920]);
      expect(peak).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 8])(
    'never exceeds its limit when a task arrives %i microtasks after a release (final review)',
    async (depth) => {
      const limiter = createLimiter(1);
      let running = 0;
      let peak = 0;
      const body = (wait: Promise<void>) => async () => {
        running += 1;
        peak = Math.max(peak, running);
        await wait;
        running -= 1;
      };
      const first = deferred();
      const runs = [limiter.run(body(first.promise)), limiter.run(body(Promise.resolve()))];
      await tick();
      first.resolve();
      let chain = Promise.resolve();
      for (let i = 0; i < depth; i += 1) chain = chain.then(() => undefined);
      runs.push(chain.then(() => limiter.run(body(Promise.resolve()))));
      await Promise.all(runs);
      expect(peak).toBe(1);
      expect([limiter.active, limiter.waiting]).toEqual([0, 0]);
    },
  );

  it('shares one limit across uploads; refusals never wait for a slot', async () => {
    expect(MAX_CONCURRENT_PIPELINES).toBe(2);
    const holds = [deferred(), deferred()];
    const held = holds.map((hold) => imagePipelines.run(() => hold.promise));
    await tick();
    expect(imagePipelines.active).toBe(MAX_CONCURRENT_PIPELINES);

    let done = false;
    const valid = toWebpVariants(await solid(700, 500).png().toBuffer()).then((variants) => {
      done = true;
      return variants;
    });
    await expect(toWebpVariants(Buffer.from('not an image'))).rejects.toBeInstanceOf(
      ImageRejectedError,
    );
    await expect(toWebpVariants(await animated())).rejects.toBeInstanceOf(ImageRejectedError);
    await vi.waitFor(() => expect(imagePipelines.waiting).toBe(1), { timeout: 10_000 });
    expect(done).toBe(false); // the valid upload queues behind the held slots

    holds.forEach((hold) => hold.resolve());
    await Promise.all(held);
    expect((await valid).map(({ width }) => width)).toEqual([640]);
    expect([imagePipelines.active, imagePipelines.waiting]).toEqual([0, 0]);
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
