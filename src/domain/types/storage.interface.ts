import * as fs from 'fs';

export interface StorageService {
  write(key: string, content: string | Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): boolean;
  delete(key: string): Promise<void>;
  createReadStream(
    key: string,
    options?: Parameters<typeof fs.createReadStream>[1],
  ): fs.ReadStream;
}
