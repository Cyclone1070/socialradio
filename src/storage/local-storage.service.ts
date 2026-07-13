import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { StorageService, WriteParams } from '../domain/types/storage.interface';

@Injectable()
export class LocalStorageService implements StorageService {
  async write(params: WriteParams): Promise<void> {
    const dir = path.dirname(params.key);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(params.key, params.content);
  }

  async read(filePath: string): Promise<Buffer> {
    return fs.promises.readFile(filePath);
  }

  exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  async delete(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  createReadStream(
    filePath: string,
    options?: Parameters<typeof fs.createReadStream>[1],
  ): fs.ReadStream {
    return fs.createReadStream(filePath, options);
  }
}
