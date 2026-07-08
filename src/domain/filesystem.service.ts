import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class FilesystemService {
  async write(filePath: string, content: string | Buffer): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(filePath, content);
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

  createReadStream(filePath: string, options?: any): fs.ReadStream {
    return fs.createReadStream(filePath, options);
  }
}
