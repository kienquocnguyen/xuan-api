import { ApiProperty } from '@nestjs/swagger';
import type { CoachingReceipt } from '../coaching-registrations.service.js';

/**
 * The public answer to a registration: when it was received, nothing else. A duplicate gets the first
 * registration's time. No id, status or admin field.
 */
export class CoachingRegistrationReceiptDto {
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
}

export function toCoachingRegistrationReceiptDto(
  receipt: CoachingReceipt,
): CoachingRegistrationReceiptDto {
  return { receivedAt: receipt.receivedAt.toISOString() };
}
