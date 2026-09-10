import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../database/prisma.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

@Controller('me')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getMe(@Req() request: Request): { data: object } {
    return { data: request.currentUser! };
  }

  @Put('preferences')
  async updatePreferences(
    @Req() request: Request,
    @Body() dto: UpdatePreferencesDto,
  ) {
    const { dailyNewLimit, ...userData } = dto;
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: request.currentUser!.id },
        data: userData,
      });
      if (dailyNewLimit)
        await tx.studyPlan.updateMany({
          where: { userId: updated.id, status: 'ACTIVE' },
          data: { dailyNewLimit },
        });
      return updated;
    });
    return { data: user };
  }
}
