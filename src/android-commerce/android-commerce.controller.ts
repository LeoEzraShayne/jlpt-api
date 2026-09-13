import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { QuotaService } from '../billing/quota.service';
import { presentOrder } from '../billing/billing.service';
import { billingError, catalogFor } from '../billing/billing.policy';
import { GOOGLE_PRODUCTS } from '../contracts/android-commerce';
import { AndroidPolicy } from './android.policy';
import {
  AndroidScopeRequired,
  AndroidSessionGuard,
} from './android-session.guard';
import { GooglePurchaseService } from './google-purchase.service';
import { GoogleNotificationsService } from './google-notifications.service';
import { AdmobRewardService } from './admob-reward.service';
class PurchaseDto {
  @IsString() @Length(1, 8192) purchaseToken!: string;
  @IsString() @Length(1, 200) productId!: string;
}
class TicketDto {
  @IsUUID() requestKey!: string;
}
class OrdersDto {
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
@Controller('android/commerce')
@UseGuards(AndroidSessionGuard)
@AndroidScopeRequired('commerce:read')
export class AndroidCommerceController {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: AndroidPolicy,
    private readonly quota: QuotaService,
    private readonly purchases: GooglePurchaseService,
    private readonly rewards: AdmobRewardService,
  ) {}
  @Get('catalog')
  @Header('Cache-Control', 'no-store')
  async catalog() {
    const config = await this.db.billingConfig.findUnique({
      where: { id: 'default' },
    });
    const now = new Date();
    const catalog = catalogFor(config, 'GLOBAL', now);
    const launchEnd = catalog.launchEndsAt
      ? Date.parse(catalog.launchEndsAt)
      : null;
    // Play requires whole-minute offer expiry. Pause annual sales in the
    // remaining fraction of the shared launch window instead of charging $99 early.
    const yearPaused =
      launchEnd !== null &&
      now.getTime() >= Math.floor(launchEnd / 60_000) * 60_000 &&
      now.getTime() < launchEnd;
    return {
      data: {
        packageName: this.policy.packageName,
        environment: this.policy.environment,
        salesEnabled:
          !!config?.androidSalesEnabled &&
          !!config.launchAt &&
          config.launchAt <= now &&
          this.policy.enabled('ANDROID_GOOGLE_ENABLED'),
        launchAt: catalog.launchAt,
        launchEndsAt: catalog.launchEndsAt,
        products: catalog.products
          .filter(
            (product) => !(yearPaused && product.productCode === 'YEAR_PASS'),
          )
          .map((product) => ({
            productCode: product.productCode,
            ...GOOGLE_PRODUCTS[product.productCode],
            offerId: product.launchPrice ? 'launch-64' : null,
            durationSeconds: product.durationSeconds,
            launchPrice: product.launchPrice,
          })),
      },
    };
  }
  @Get('entitlements')
  @Header('Cache-Control', 'no-store')
  async entitlements(@Req() req: Request) {
    const summary = await this.quota.summary(req.currentUser!.id);
    const config = await this.db.billingConfig.findUnique({
      where: { id: 'default' },
    });
    return {
      data: {
        ...summary,
        salesEnabled: (await this.catalog()).data.salesEnabled,
        rewardsEnabled:
          !summary.isMember &&
          !!config?.androidRewardsEnabled &&
          this.policy.enabled('ANDROID_ADMOB_ENABLED'),
      },
    };
  }
  @Get('orders')
  async orders(@Req() req: Request, @Query() input: OrdersDto) {
    const where = {
      userId: req.currentUser!.id,
      environment: this.policy.environment,
    };
    if (
      input.cursor &&
      !(await this.db.paymentOrder.findFirst({
        where: { ...where, id: input.cursor },
      }))
    )
      billingError('ORDER_NOT_FOUND', 404);
    const rows = await this.db.paymentOrder.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    return {
      data: rows.slice(0, input.limit).map(presentOrder),
      meta: {
        nextCursor: rows.length > input.limit ? rows[input.limit - 1].id : null,
      },
    };
  }
  @Post('google/purchases/verify')
  @AndroidScopeRequired('google:purchase')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(@Req() req: Request, @Body() input: PurchaseDto) {
    // This verifies already purchased goods; closing new sales must not forfeit them.
    const queue = await this.purchases.enqueue(input.purchaseToken);
    await this.purchases.reconcile(queue.id);
    const result = await this.db.googlePlayPurchase.findUniqueOrThrow({
      where: { id: queue.id },
    });
    if (result.userId && result.userId !== req.currentUser!.id)
      billingError('GOOGLE_OWNER_MISMATCH', 409);
    if (result.productId && result.productId !== input.productId)
      billingError('GOOGLE_PRODUCT_MISMATCH', 409);
    if (result.state === 'CANCELLED')
      billingError('GOOGLE_PURCHASE_CANCELLED', 409);
    return {
      data: {
        status: result.orderId
          ? result.state === 'REFUNDED'
            ? 'REFUNDED'
            : 'VERIFIED'
          : 'PENDING',
        orderId: result.userId ? result.orderId : null,
        consumption:
          result.consumeState === 'CONSUMED'
            ? 'CONSUMED'
            : result.consumeState === 'NOT_APPLICABLE'
              ? 'NOT_APPLICABLE'
              : 'PENDING',
        membership: (await this.entitlements(req)).data,
      },
    };
  }
  @Post('reward-tickets')
  @AndroidScopeRequired('admob:reward')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async ticket(@Req() req: Request, @Body() input: TicketDto) {
    return {
      data: await this.rewards.create(req.currentUser!.id, input.requestKey),
    };
  }
  @Get('reward-tickets/:id')
  @AndroidScopeRequired('admob:reward')
  async ticketStatus(@Req() req: Request, @Param('id') id: string) {
    return { data: await this.rewards.status(req.currentUser!.id, id) };
  }
}
@Controller('android/commerce')
export class AndroidCallbacksController {
  constructor(
    private readonly notifications: GoogleNotificationsService,
    private readonly rewards: AdmobRewardService,
  ) {}
  @Post('google/rtdn')
  @HttpCode(200)
  async rtdn(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    return this.notifications.receive(auth, body);
  }
  @Get('admob/ssv')
  @HttpCode(200)
  async ssv(@Req() req: Request) {
    const index = req.originalUrl.indexOf('?');
    return this.rewards.receive(
      index < 0 ? '' : req.originalUrl.slice(index + 1),
    );
  }
}
