import { Injectable, Inject } from '@nestjs/common';
import type { StorageService } from '../domain/types/storage.interface';

@Injectable()
export class ChunkerService {
  constructor(
    @Inject('StorageService')
    private readonly storageService: StorageService,
  ) {}

  getStorageKey(
    channelId: string,
    segmentId: string,
    chunkIndex: number,
  ): string {
    return `channels/${channelId}/chunks/${segmentId}_${chunkIndex}.mp3`;
  }

  getManifestUri(segmentId: string, chunkIndex: number): string {
    return `chunks/${segmentId}_${chunkIndex}.mp3`;
  }

  async sliceAndUpload(
    channelId: string,
    segmentId: string,
    sourceFilePath: string,
  ): Promise<number> {
    const fileBuffer = await this.storageService.read(sourceFilePath);
    const chunkSize = 160000; // 10s chunks at 128kbps CBR MP3 (16,000 bytes/sec)
    let index = 0;

    for (let offset = 0; offset < fileBuffer.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, fileBuffer.length);
      const chunkBuffer = fileBuffer.subarray(offset, end);
      const chunkPath = this.getStorageKey(channelId, segmentId, index);

      await this.storageService.write({
        key: chunkPath,
        content: chunkBuffer,
        contentType: 'audio/mpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      index++;
    }

    return index;
  }
}
