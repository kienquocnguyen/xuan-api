import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'http:rawResponse';

/**
 * The handler writes its own response through `@Res()` (e.g. an OAuth redirect), so the success envelope
 * interceptor leaves it alone (AD6's opt-out). Errors thrown before the response is written still go through
 * the global filter as JSON envelopes.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
