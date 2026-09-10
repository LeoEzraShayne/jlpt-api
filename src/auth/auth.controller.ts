import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { GoogleProfile } from './google.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard('google'))
  startGoogleLogin() {}

  @Get('google/callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard('google'))
  async finishGoogleLogin(
    @Req() request: Request & { user: GoogleProfile },
    @Res() response: Response,
  ) {
    const session = await this.auth.loginWithGoogle(request.user);
    response.cookie('jlpt_session', session.rawToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
    return response.redirect(
      `${this.config.getOrThrow('FRONTEND_URL')}/?login=success`,
    );
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(request.cookies?.jlpt_session as string | undefined);
    response.clearCookie('jlpt_session', {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { data: { loggedOut: true } };
  }
}
