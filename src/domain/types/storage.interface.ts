import * as fs from 'fs';

export interface WriteParams {
  key: string;
  content: string | Buffer;
  contentType?: string;
  cacheControl?: string;
}

export interface StorageService {
  write(params: WriteParams): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): boolean;
  delete(key: string): Promise<void>;
  createReadStream(
    key: string,
    options?: Parameters<typeof fs.createReadStream>[1],
  ): fs.ReadStream;
}
