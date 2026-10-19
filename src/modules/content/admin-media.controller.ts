import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { baselineErrors } from '../../errors/baseline-errors.js';
import { CurrentUser, Roles } from '../../http/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../http/auth/role.js';
import { ApiEnvelopeResponse } from '../../http/openapi/api-envelope-response.js';
import { ApiErrorResponses } from '../../http/openapi/api-error-responses.js';
import { SingleFileUpload } from '../../http/upload/single-file-upload.interceptor.js';
import { contentErrors } from './content.errors.js';
import { MediaImageDto } from './dto/media.dto.js';
import { MAX_IMAGE_BYTES } from './media/image-processing.js';
import { MediaService } from './media/media.service.js';

const { VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN } = baselineErrors;

/** Image upload for authors (blog completion spec §5.1, BD-11): editors and admins. */
@Roles('editor', 'admin')
@ApiTags('admin')
@Controller('admin/media')
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  @Post('images')
  @UseInterceptors(SingleFileUpload('file', MAX_IMAGE_BYTES))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG, WebP or AVIF, at most 12 MiB and 6 000 px a side; never animated.',
        },
      },
    },
  })
  @ApiEnvelopeResponse(MediaImageDto, { status: 201 })
  @ApiErrorResponses(
    VALIDATION_FAILED,
    UNAUTHENTICATED,
    FORBIDDEN,
    contentErrors.MEDIA_STORAGE_DISABLED,
  )
  async upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<MediaImageDto> {
    const { id, url, width, height, variants } = await this.media.uploadImage(actor, file);
    return { id, url, width, height, variants: variants.map((variant) => ({ ...variant })) };
  }
}
