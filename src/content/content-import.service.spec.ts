const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContentImportService } from './content-import.service';
import { PrismaService } from '../database/prisma.service';

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contentImport: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    contentCandidate: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    vocabularyEntry: { upsert: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  };
  return {
    tx,
    service: new ContentImportService(prisma as unknown as PrismaService),
  };
}
const payload = {
  kind: 'VOCABULARY',
  word: '橋',
  reading: 'はし',
  gloss: '桥',
};

describe('private content import', () => {
  it('stages deduplicated rows as private PENDING even if structurally clean', async () => {
    const { tx, service } = setup();
    tx.contentImport.upsert.mockResolvedValue({
      id: 'batch',
      status: 'PREVIEW',
    });
    tx.contentCandidate.createMany.mockResolvedValue({ count: 1 });
    const result = await service.preview('owner', {
      fileName: 'local.xls',
      sourceName: 'User notes',
      sourceVersion: 'hash',
      rows: [payload, payload],
    });
    expect(result).toMatchObject({ inserted: 1, duplicates: 1 });
    expect(tx.contentCandidate.createMany).toHaveBeenCalledTimes(1);
    expect(tx.contentCandidate.createMany).toHaveBeenCalledWith(
      containing({
        skipDuplicates: true,
        data: [
          containing({
            userId: 'owner',
            validationStatus: 'PENDING',
          }),
        ],
      }),
    );
    expect(tx.vocabularyEntry.upsert).not.toHaveBeenCalled();
  });
  it('returns not found for another users import and never commits', async () => {
    const { tx, service } = setup();
    tx.contentImport.findFirst.mockResolvedValue(null);
    await expect(service.commit('intruder', 'batch')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(tx.contentImport.findFirst).toHaveBeenCalledWith({
      where: { id: 'batch', userId: 'intruder' },
    });
    expect(tx.vocabularyEntry.upsert).not.toHaveBeenCalled();
  });
  it('requires source confirmation and rejects missing readings', async () => {
    const { tx, service } = setup();
    tx.contentCandidate.findFirst.mockResolvedValue({
      payload: { ...payload, reading: '' },
    });
    await expect(
      service.validate('owner', 'candidate', {
        status: 'VALIDATED',
        note: 'reviewed',
        checkedAgainstSource: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    tx.contentCandidate.findFirst.mockResolvedValue({ payload });
    await expect(
      service.validate('owner', 'candidate', {
        status: 'VALIDATED',
        note: 'reviewed',
        checkedAgainstSource: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.contentCandidate.update).not.toHaveBeenCalled();
  });
  it('commits only approved entries and keeps Chinese gloss separate', async () => {
    const { tx, service } = setup();
    tx.contentImport.findFirst.mockResolvedValue({
      id: 'batch',
      sourceName: 'private',
      sourceVersion: 'v1',
    });
    tx.contentCandidate.findMany.mockResolvedValue([
      {
        id: 'c',
        kind: 'VOCABULARY',
        word: '橋',
        reading: 'はし',
        senseKey: 'bridge',
        fingerprint: 'abc',
        payload,
      },
    ]);
    tx.vocabularyEntry.upsert.mockResolvedValue({ id: 'v' });
    await service.commit('owner', 'batch');
    expect(tx.contentCandidate.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner',
        importId: 'batch',
        validationStatus: 'VALIDATED',
      },
    });
    expect(tx.vocabularyEntry.upsert).toHaveBeenCalledWith(
      containing({
        create: containing({
          ownerId: 'owner',
          glosses: [],
          chineseGloss: '桥',
          validationStatus: 'VALIDATED',
        }),
      }),
    );
  });
  it('revokes already imported content when its validation is withdrawn', async () => {
    const { tx, service } = setup();
    tx.contentCandidate.findFirst.mockResolvedValue({
      payload,
      vocabularyId: 'v',
    });
    await service.validate('owner', 'c', {
      status: 'REJECTED',
      note: 'wrong meaning',
      checkedAgainstSource: false,
    });
    expect(tx.vocabularyEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'v', ownerId: 'owner' },
      data: { validationStatus: 'REJECTED' },
    });
  });
});
