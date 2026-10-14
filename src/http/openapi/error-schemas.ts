import { ApiProperty } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({ example: 'address.city' }) field!: string;
  @ApiProperty() message!: string;
  @ApiProperty({
    enum: [
      'REQUIRED',
      'INVALID_TYPE',
      'INVALID_FORMAT',
      'TOO_SHORT',
      'TOO_LONG',
      'TOO_SMALL',
      'TOO_LARGE',
      'UNKNOWN_FIELD',
      'INVALID',
    ],
  })
  code!: string;
}

export class ValidationErrorDetailsDto {
  @ApiProperty({ type: [FieldErrorDto] }) fields!: FieldErrorDto[];
}

export class ErrorBodyDto {
  @ApiProperty({ example: 'NOT_FOUND' }) code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) details!: Record<string, unknown>;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ type: 'null', nullable: true, example: null }) data!: null;
  @ApiProperty({ type: ErrorBodyDto }) error!: ErrorBodyDto;
}
