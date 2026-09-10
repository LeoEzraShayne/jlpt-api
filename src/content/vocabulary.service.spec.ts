const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
import { NotFoundException } from '@nestjs/common';
import { VocabularyService } from './vocabulary.service';
import { PrismaService } from '../database/prisma.service';

describe('vocabulary ownership and bookmark identity', () => {
  function setup() {
    const prisma = {
      vocabularyEntry: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      vocabularyBookmark: { upsert: jest.fn(), deleteMany: jest.fn() },
    };
    return {
      prisma,
      service: new VocabularyService(prisma as unknown as PrismaService),
    };
  }
  it('does not expose or bookmark private vocabulary belonging to another owner', async () => {
    const { prisma, service } = setup();
    prisma.vocabularyEntry.findFirst.mockResolvedValue(null);
    await expect(
      service.bookmark('other', 'private-word'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vocabularyEntry.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'private-word',
        validationStatus: 'VALIDATED',
        OR: [{ ownerId: null }, { ownerId: 'other' }],
      },
    });
    expect(prisma.vocabularyBookmark.upsert).not.toHaveBeenCalled();
  });
  it('repeated bookmark operations use owner+vocabulary unique identity', async () => {
    const { prisma, service } = setup();
    prisma.vocabularyEntry.findFirst.mockResolvedValue({ id: 'v' });
    await service.bookmark('u', 'v');
    expect(prisma.vocabularyBookmark.upsert).toHaveBeenCalledWith({
      where: { userId_vocabularyId: { userId: 'u', vocabularyId: 'v' } },
      create: { userId: 'u', vocabularyId: 'v', note: undefined },
      update: {},
    });
  });
  it('search retains the owner filter when query filters are present', async () => {
    const { prisma, service } = setup();
    await service.search('u', { query: '橋', level: 'N1', cursor: 'last' });
    expect(prisma.vocabularyEntry.findMany).toHaveBeenCalledWith(
      containing({
        where: containing({
          OR: [{ ownerId: null }, { ownerId: 'u' }],
          validationStatus: 'VALIDATED',
          level: 'N1',
          id: { gt: 'last' },
        }),
      }),
    );
  });
});
