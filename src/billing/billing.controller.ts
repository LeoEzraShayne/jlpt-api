import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SessionGuard } from '../auth/session.guard';
import { BillingService } from './billing.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { QuotaService } from './quota.service';
import { billingError } from './billing.policy';
import type { BillingMarket, ProductCode } from '../contracts/sentence-lab';

class CatalogQuery {
  @IsIn(['JP', 'GLOBAL']) market: BillingMarket = 'GLOBAL';
}
class OrdersQuery {
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
class CheckoutDto {
  @IsIn(['DAY_PASS', 'YEAR_PASS']) productCode!: ProductCode;
  @IsIn(['JP', 'GLOBAL']) market!: BillingMarket;
  @IsUUID() requestKey!: string;
  @IsIn(['zh', 'en']) locale: 'zh' | 'en' = 'zh';
}
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly webhook: StripeWebhookService,
  ) {}
  @Get('catalog') async catalog(@Query() query: CatalogQuery) {
    return { data: await this.billing.catalog(query.market) };
  }
  @Get('orders') @UseGuards(SessionGuard) orders(
    @Req() req: Request,
    @Query() query: OrdersQuery,
  ) {
    return this.billing.orders(req.currentUser!.id, query.cursor, query.limit);
  }
  @Get('orders/:id') @UseGuards(SessionGuard) async order(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.billing.order(req.currentUser!.id, id) };
  }
  @Post('checkout') @UseGuards(SessionGuard) async checkout(
    @Req() req: Request,
    @Body() dto: CheckoutDto,
  ) {
    return { data: await this.billing.checkout(req.currentUser!.id, dto) };
  }
  @Post('webhooks/stripe') async stripe(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!req.rawBody || !signature)
      billingError('INVALID_STRIPE_SIGNATURE', 400);
    return this.webhook.receive(req.rawBody, signature);
  }
}
@Controller('me/entitlements')
@UseGuards(SessionGuard)
export class EntitlementsController {
  constructor(private readonly quota: QuotaService) {}
  @Get() async get(@Req() req: Request) {
    return { data: await this.quota.summary(req.currentUser!.id) };
  }
}
