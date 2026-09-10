import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../database/prisma.service';
import {
  UpdateGrammarDto,
  UpdateGrammarStatusDto,
} from './dto/update-grammar.dto';

@Controller('admin/grammar-points')
@UseGuards(SessionGuard, AdminGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}
  @Patch(':id') async update(
    @Param('id') id: string,
    @Body() dto: UpdateGrammarDto,
  ) {
    return {
      data: await this.prisma.grammarPoint.update({ where: { id }, data: dto }),
    };
  }
  @Patch(':id/status') async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateGrammarStatusDto,
  ) {
    return {
      data: await this.prisma.grammarPoint.update({
        where: { id },
        data: { status: dto.status },
      }),
    };
  }
}
