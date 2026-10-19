import { QueueService } from './queue.service';
import { Channel } from './entities/channel.entity';
import { ChannelSchema } from '../infrastructure/database/schemas/channel.schema';

/**
 * The watchdog decides whether to fill a hole under the station lock and re-reads
 * the runway there. That decision is only worth anything if the write happens in
 * the same transaction: two instances that both see an empty station must not both
 * fill it, and the second one only learns the hole is gone if it can see the first
 * one's rows when it takes the lock.
 */
describe('the watchdog fills the hole in the transaction that found it', () => {
  function build() {
    const channel = Object.assign(new Channel(), { id: 'chan-1' });
    let inTransaction = false;
    let transactionCount = 0;
    const writtenInTransaction: boolean[] = [];
    const channelRepo = {
      findOne: jest.fn().mockResolvedValue(channel),
      nativeUpdate: jest.fn().mockResolvedValue(1),
    };
    const segmentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };

    interface MockEm {
      persist: jest.Mock;
      flush: jest.Mock;
      getReference: jest.Mock;
      getRepository: jest.Mock;
      transactional: jest.Mock;
    }

    const em: MockEm = {
      persist: jest.fn(() => {
        writtenInTransaction.push(inTransaction);
      }),
      flush: jest.fn().mockResolvedValue(undefined),
      getReference: jest.fn((_cls: unknown, id: string) => ({ id })),
      getRepository: jest.fn((cls: unknown) =>
        cls === ChannelSchema ? channelRepo : segmentRepo,
      ),
      transactional: jest.fn(<T>(cb: (em: unknown) => Promise<T>) => {
        transactionCount++;
        inTransaction = true;
        return Promise.resolve(cb(em)).finally(() => {
          inTransaction = false;
        });
      }),
    };

    const media = {
      getRandomMusic: jest.fn().mockResolvedValue({
        filePath: 'music/song.mp3',
        durationSeconds: 180,
        title: 'Song',
        artist: 'Artist',
      }),
      getRandomLiner: jest.fn().mockResolvedValue({
        filePath: 'liners/back-01.mp3',
        durationSeconds: 4,
        text: 'We will be right back.',
      }),
    };

    const service = new QueueService(
      channelRepo as never,
      segmentRepo as never,
      em as never,
      media as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return {
      service,
      em,
      writtenInTransaction,
      transactions: () => transactionCount,
    };
  }

  it('writes the filler before it lets go of the lock it decided under', async () => {
    const { service, writtenInTransaction, transactions } = build();

    await service.ensureFiller('chan-1');

    // One transaction: the runway the decision was made on is the same view the
    // write lands in, so a second instance taking the lock afterwards sees the rows
    // and finds no hole left to fill.
    expect(transactions()).toBe(1);
    expect(writtenInTransaction.length).toBeGreaterThan(0);
    expect(writtenInTransaction.every((inside) => inside)).toBe(true);
  });
});
