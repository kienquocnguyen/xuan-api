import { ApiProperty } from '@nestjs/swagger';
import type { ContactReceipt } from '../contact-submissions.service.js';

/**
 * The public answer to a submission (CF-3): when it was received, nothing else. A duplicate gets the first
 * submission's time. No id, status or admin field.
 */
export class ContactSubmissionReceiptDto {
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
}

export function toContactSubmissionReceiptDto(
  receipt: ContactReceipt,
): ContactSubmissionReceiptDto {
  return { receivedAt: receipt.receivedAt.toISOString() };
}
