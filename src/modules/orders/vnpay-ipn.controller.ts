import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../http/auth/auth.decorators.js';
import { RawResponse } from '../../http/raw-response.decorator.js';
import { VnpayIpnService } from './vnpay-ipn.service.js';

/**
 * VNPAY's server-to-server IPN (course sales spec §5.6). A documented exception to I11/I13 (S5): it always answers
 * HTTP 200 with VNPAY's own `{ RspCode, Message }`, never our envelope, through the AD6 opt-out. A mutating GET:
 * the CSRF guard passes safe methods by design, and the HMAC is what protects it. Excluded from OpenAPI, like
 * Google's sign-in callback: it is VNPAY's contract, not xuan-web's.
 */
@Controller('payments/vnpay')
export class VnpayIpnController {
  constructor(private readonly ipn: VnpayIpnService) {}

  @Public()
  @Get('ipn')
  @RawResponse()
  @ApiExcludeEndpoint()
  async receive(@Req() request: Request, @Res() response: Response): Promise<void> {
    const ack = await this.ipn.handle(request.query as Record<string, unknown>);
    response.status(200).setHeader('Cache-Control', 'no-store').json(ack);
  }
}
