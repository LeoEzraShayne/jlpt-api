import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      data: {
        status: 'ok',
        service: 'jlpt-api',
        database: 'ok',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
