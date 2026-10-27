import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, type Repository } from 'typeorm';
import { APP_CONFIG } from '../../../config/app-config.module.js';
import type { AppConfig } from '../../../config/load-config.js';
import { AppError } from '../../../errors/app-error.js';
import { baselineErrors } from '../../../errors/baseline-errors.js';
import type { AuthenticatedUser } from '../../../http/auth/role.js';
import { contentErrors } from '../content.errors.js';
import { ImageRejectedError, toWebpVariants } from './image-processing.js';
import { MEDIA_CONTENT_TYPE, ContentMedia } from './media.entity.js';
import { MEDIA_STORAGE, type MediaStorage, mediaUrl, variantKey } from './media-storage.js';

/** The image a DTO shows: URLs built from the configured base (spec §5.5). */
export type MediaImage = Readonly<{
  id: string;
  url: string;
  width: number;
  height: number;
  variants: readonly Readonly<{ width: number; height: number; url: string }>[];
}>;

const PREFERRED_WIDTH = 1280;

/** Blog image uploads (blog completion spec §5.1, BD-4/5/11). */
@Injectable()
export class MediaService {
  constructor(
    @InjectRepository(ContentMedia) private readonly media: Repository<ContentMedia>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Re-encodes, stores every variant, then records the row. A failure after storing leaves orphan files, which
   * BD-5 accepts. The original filename is never used.
   */
  async uploadImage(actor: AuthenticatedUser, file: Express.Multer.File): Promise<MediaImage> {
    if (!this.storage.enabled) throw new AppError(contentErrors.MEDIA_STORAGE_DISABLED); // owner Q1
    let variants;
    try {
      variants = await toWebpVariants(file.buffer);
    } catch (error) {
      if (!(error instanceof ImageRejectedError)) throw error;
      throw new AppError(baselineErrors.VALIDATION_FAILED, {
        fields: [{ field: 'file', code: 'INVALID', message: 'This value is invalid.' }],
      });
    }
    const storageKey = `blog/${randomUUID()}`;
    await Promise.all(
      variants.map((variant) =>
        this.storage.put(variantKey(storageKey, variant.width), variant.data, MEDIA_CONTENT_TYPE),
      ),
    );
    const largest = variants[variants.length - 1];
    const row = {
      storageKey,
      width: largest.width,
      height: largest.height,
      variantWidths: variants.map((variant) => variant.width),
    };
    const result = await this.media.insert({
      ...row,
      uploaderId: actor.id,
      byteSize: variants.reduce((sum, variant) => sum + variant.data.length, 0),
    });
    const image = this.toImage({ ...row, id: (result.identifiers[0] as { id: string }).id });
    if (!image) throw new Error('Stored media without a public base URL.');
    return image;
  }

  /**
   * Body images must be our own variants (spec §5.5, "Media URL"): `base/<storage_key>-<width>.webp`. A wrong
   * shape → 400 INVALID at its path; an unknown key or a width the media lacks → 409 POST_MEDIA_NOT_FOUND.
   * One query for the whole body.
   */
  async assertLibrarySources(
    sources: readonly { path: string; src: string }[],
    manager?: EntityManager,
  ): Promise<void> {
    if (sources.length === 0) return;
    const base = this.config.media.publicBaseUrl;
    const parsed = sources.map(({ path, src }) => {
      const match =
        base && src.startsWith(`${base}/`)
          ? /^(blog\/[0-9a-f-]{36})-(\d{1,4})\.webp$/.exec(src.slice(base.length + 1))
          : null;
      return { path, key: match?.[1], width: Number(match?.[2]) };
    });
    const malformed = parsed.filter((source) => !source.key);
    if (malformed.length > 0) {
      throw new AppError(baselineErrors.VALIDATION_FAILED, {
        fields: malformed.map(({ path }) => ({
          field: path,
          code: 'INVALID',
          message: 'This value is invalid.',
        })),
      });
    }
    const keys = [...new Set(parsed.map((source) => source.key as string))];
    const rows = await (manager?.getRepository(ContentMedia) ?? this.media).find({
      select: { storageKey: true, variantWidths: true },
      where: { storageKey: In(keys) },
    });
    const widths = new Map(rows.map((row) => [row.storageKey, row.variantWidths]));
    if (parsed.some(({ key, width }) => !widths.get(key as string)?.includes(width))) {
      throw new AppError(contentErrors.POST_MEDIA_NOT_FOUND);
    }
  }

  /** Cover/OG ids must exist (spec §5.4); one query. */
  async assertExisting(ids: readonly (string | null | undefined)[], manager?: EntityManager) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;
    const found = await (manager?.getRepository(ContentMedia) ?? this.media).count({
      where: { id: In(wanted) },
    });
    if (found !== wanted.length) throw new AppError(contentErrors.POST_MEDIA_NOT_FOUND);
  }

  /** The images of a page of posts: one query, whatever the page size. */
  async findImages(ids: readonly (string | null)[]): Promise<Map<string, MediaImage>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await this.media.findBy({ id: In(wanted) });
    const images = new Map<string, MediaImage>();
    for (const row of rows) {
      const image = this.toImage(row);
      if (image) images.set(row.id, image);
    }
    return images;
  }

  /** URLs of a stored image; `null` when this server has no public media base (storage disabled). */
  toImage(
    row: Pick<ContentMedia, 'id' | 'storageKey' | 'width' | 'height' | 'variantWidths'>,
  ): MediaImage | null {
    const base = this.config.media.publicBaseUrl;
    if (!base) return null;
    // Heights follow the stored ratio (sharp rounds the same way when it resizes).
    const variants = [...row.variantWidths]
      .sort((a, b) => a - b)
      .map((width) => ({
        width,
        height: width === row.width ? row.height : Math.round((width * row.height) / row.width),
        url: mediaUrl(base, row.storageKey, width),
      }));
    const preferred =
      [...variants].reverse().find((variant) => variant.width <= PREFERRED_WIDTH) ?? variants[0];
    return { id: row.id, ...preferred, variants };
  }
}
