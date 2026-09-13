import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import type { Request } from 'express';
import type { AndroidClientId } from '../contracts/android-commerce';
import { SessionGuard } from '../auth/session.guard';
import { AndroidAuthService } from './android-auth.service';
import { AndroidSessionGuard } from './android-session.guard';
class StartDto {
  @IsIn(['android-release', 'android-test']) clientId!: AndroidClientId;
  @Matches(/^[A-Za-z0-9_-]{43}$/) codeChallenge!: string;
  @IsString() @Length(32, 128) state!: string;
}
class ExchangeDto {
  @IsIn(['android-release', 'android-test']) clientId!: AndroidClientId;
  @Matches(/^[A-Za-z0-9_-]{43}$/) code!: string;
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/) codeVerifier!: string;
}
@Controller('android/auth')
export class AndroidAuthController {
  constructor(private readonly auth: AndroidAuthService) {}
  @Post('bindings')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async start(@Body() input: StartDto) {
    return { data: await this.auth.start(input) };
  }
  @Get('bindings/:id')
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  async details(@Param('id') id: string) {
    return { data: await this.auth.details(id) };
  }
  @Post('bindings/:id/approve')
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async approve(@Param('id') id: string, @Req() req: Request) {
    return {
      data: await this.auth.approve(id, req.currentUser!.id, req.sessionId!),
    };
  }
  @Post('exchange')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async exchange(@Body() dto: ExchangeDto) {
    return {
      data: await this.auth.exchange(dto.clientId, dto.code, dto.codeVerifier),
    };
  }
  @Post('logout')
  @UseGuards(AndroidSessionGuard)
  async logout(@Req() req: Request) {
    return { data: await this.auth.logout(req.sessionId!) };
  }
}
